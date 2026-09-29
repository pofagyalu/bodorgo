import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnInit,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type Quill from 'quill';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Poll, PollPayload, PollService, PollVisibility } from '../../services/poll';
import { Tour } from '../../services/tour';
import { NotificationsService } from '../../notifications/notifications.service';

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Tomorrow 20:00 - a sensible default deadline for "shall we go...?".
function defaultDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(20, 0, 0, 0);
  return toLocalInput(d);
}

// The one poll dialog, everywhere: a question, answers ("Igen / Nem" to
// start with), optional "Részletek" (a small rich-text editor - the tour
// mailing's, compact: a few sentences, links, lists), a deadline,
// Nyílt/Titkos. (The server can also take "at
// least N on the first answer" - not offered here; an edited poll keeps
// the one it had.)
// - From a chat (the 📊 button; tourId, or none for the general
//   Kotyogó): the poll shows up in that chat as a live card (the server
//   posts it - see pollController.startChatPoll).
// - On Voks (tours given): "Hol?" - Általános or a tour - and with `poll`
//   it edits that one instead of making a new one.
@Component({
  selector: 'app-poll-create',
  imports: [FormsModule, MatIconModule],
  templateUrl: './poll-create.html',
  styleUrl: './poll-create.scss',
})
export class PollCreate implements OnInit, AfterViewInit {
  private pollService = inject(PollService);
  private notifications = inject(NotificationsService);

  // The tour's chat it's started in - null: the general Kotyogó.
  tourId = input<string | null>(null);
  // Voks: the tours to choose from ("Hol?"), and the poll being edited.
  tours = input<Tour[] | null>(null);
  poll = input<Poll | null>(null);
  closed = output<void>();
  saved = output<Poll>();

  // Voks's "Hol?": '' - Általános, or a tour's id.
  place = signal('');

  // Részletek: only when its box is ticked - then Quill is loaded (it's
  // big) and the editor opens. Unticked, the poll has no details.
  private detailsEl = viewChild.required<ElementRef<HTMLDivElement>>('details');
  private quill?: Quill;
  withDetails = signal(false);

  // An edited poll that has details starts with them open.
  ngAfterViewInit() {
    if (this.poll()?.details) this.setWithDetails(true);
  }

  setWithDetails(on: boolean) {
    this.withDetails.set(on);
    if (on && !this.quill) void this.openEditor();
  }

  private async openEditor() {
    const { default: QuillEditor } = await import('quill');
    this.quill = new QuillEditor(this.detailsEl().nativeElement, {
      theme: 'snow',
      placeholder: 'Részletek, linkek, felsorolás… (nem kötelező)',
      modules: {
        toolbar: [
          ['bold', 'italic', 'underline', 'strike'],
          [{ color: [] }, { background: [] }],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['link'],
          ['clean'],
        ],
      },
    });
    const details = this.poll()?.details;
    if (details) this.quill.clipboard.dangerouslyPasteHTML(details, 'silent');
    this.quill.focus();
  }

  // '' when unticked, or nothing's written.
  private detailsHtml(): string {
    if (!this.withDetails() || !this.quill || !this.quill.getText().trim()) return '';
    return this.quill.getSemanticHTML();
  }

  question = signal('');
  options = signal<string[]>(['Igen', 'Nem']);
  closesAt = signal(defaultDeadline());
  visibility = signal<PollVisibility>('open');
  saving = signal(false);
  error = signal<string | null>(null);

  // Editing: the form starts from the poll.
  ngOnInit() {
    const p = this.poll();
    if (!p) return;
    this.place.set(p.tour?._id ?? '');
    this.question.set(p.question);
    this.options.set(p.options.map((o) => o.text));
    this.closesAt.set(toLocalInput(new Date(p.closesAt)));
    this.visibility.set(p.visibility);
  }

  setOption(i: number, value: string) {
    this.options.update((list) => list.map((o, j) => (j === i ? value : o)));
  }

  addOption() {
    this.options.update((list) => [...list, '']);
  }

  removeOption(i: number) {
    this.options.update((list) => (list.length > 2 ? list.filter((_, j) => j !== i) : list));
  }

  @HostListener('document:keydown.escape')
  cancel() {
    if (!this.saving()) this.closed.emit();
  }

  submit(event: Event) {
    event.preventDefault();
    const options = this.options()
      .map((o) => o.trim())
      .filter(Boolean);
    if (!this.question().trim()) return this.error.set('Írd be a kérdést.');
    if (options.length < 2) return this.error.set('Legalább 2 válasz kell.');
    const closes = new Date(this.closesAt());
    if (Number.isNaN(closes.getTime()) || closes.getTime() <= Date.now()) {
      return this.error.set('A lezárás időpontja a jövőben legyen.');
    }

    this.saving.set(true);
    this.error.set(null);
    const payload: PollPayload = {
      question: this.question().trim(),
      details: this.detailsHtml(),
      options,
      closesAt: closes.toISOString(),
      visibility: this.visibility(),
      minimumCount: this.poll()?.minimum?.count ?? null,
    };
    const editing = this.poll();
    const tourId = this.tourId();
    const request = editing
      ? this.pollService.updatePoll(editing._id, { ...payload, tour: this.place() })
      : this.tours()
        ? this.pollService.createPoll({ ...payload, tour: this.place() })
        : tourId
          ? this.pollService.createTourPoll(tourId, payload)
          : this.pollService.createGeneralPoll(payload);
    request.subscribe({
      next: (res) => {
        this.saving.set(false);
        this.saved.emit(res.data.poll);
        this.closed.emit();
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err?.error?.message ?? 'Nem sikerült menteni a szavazást.');
      },
    });
  }
}
