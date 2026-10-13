import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import Quill from 'quill';
import { firstValueFrom } from 'rxjs';
import { ExtraDocument, MailingsResponse, SentMailing, TourService } from '../../../services/tour';
import { NotificationsService } from '../../../notifications/notifications.service';
import { errorMessage } from '../../../shared/errors';
import { lazyStyle } from '../../../shared/lazy-style';

const SAVE_DELAY_MS = 1500;

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

// Admin-only "Levél a résztvevőknek": a letter to everyone on this tour,
// written in a small rich-text editor (Quill), saved as it's typed,
// test-sent to yourself, then mass-mailed - optionally with each
// attendee's own Programfüzet attached, and any of the tour's Extrák
// documents (a map, a hike's GPX track...). Sent letters stay listed below,
// read-only. The server does the real work (see mailingController.js).
@Component({
  selector: 'app-tour-mail-panel',
  imports: [FormsModule, MatIconModule, DatePipe],
  templateUrl: './tour-mail-panel.html',
  styleUrl: './tour-mail-panel.scss',
})
export class TourMailPanel implements AfterViewInit, OnDestroy {
  private tourService = inject(TourService);
  private notifications = inject(NotificationsService);
  private sanitizer = inject(DomSanitizer);

  tourId = input.required<string>();
  // The tour's Extrák documents - any of them can go along attached.
  documents = input<ExtraDocument[]>([]);
  closed = output<void>();

  @ViewChild('editor', { static: true }) private editorEl!: ElementRef<HTMLDivElement>;
  private quill?: Quill;

  loading = signal(true);
  subject = signal('');
  private defaultSubject = '';
  withPdf = signal(false);
  // The ticked documents' ids - none to begin with.
  private tickedDocuments = signal<string[]>([]);
  // Those of them the tour still has, in the tour's order.
  chosenDocuments = computed(() =>
    this.documents().filter((d) => this.tickedDocuments().includes(d._id)),
  );
  // What the e-mail will say about its attachments (the server writes the
  // real line - mailingController.js's attachmentLine); '' without any.
  attachmentLine = computed(() => {
    const names = this.chosenDocuments()
      .map((d) => `„${d.title}”${this.isGpx(d) ? ' (GPX útvonal)' : ''}`)
      .join(', ');
    if (this.withPdf()) {
      return `Csatolva küldjük a tábor programfüzetét${names ? `, valamint: ${names}` : ''}.`;
    }
    return names ? `Csatolva küldjük: ${names}.` : '';
  });
  recipients = signal<MailingsResponse['data']['recipients']>({ eligible: [], skipped: [] });
  sent = signal<SentMailing[]>([]);
  isEmpty = signal(true);

  saveState = signal<SaveState>('idle');
  savedAt = signal<Date | null>(null);
  private saveTimer?: ReturnType<typeof setTimeout>;
  private saving?: Promise<void>;

  showPreview = signal(false);
  previewHtml = signal<SafeHtml>('');
  showSkipped = signal(false);
  confirming = signal(false);
  sendingTest = signal(false);
  sending = signal(false);
  openSentId = signal<string | null>(null);

  busy = computed(() => this.sending() || this.sendingTest());

  // The page behind the dialog stays put while it's open (restored in
  // ngOnDestroy) - it scrolls in app.component's .page-body, not the window.
  private pageBody = document.querySelector<HTMLElement>('.page-body');
  private previousBodyOverflow = '';

  ngAfterViewInit() {
    if (this.pageBody) {
      this.previousBodyOverflow = this.pageBody.style.overflow;
      this.pageBody.style.overflow = 'hidden';
    }

    // The editor's stylesheet comes with it (shared/lazy-style) - asked for
    // already when the tour page showed an admin the button (tour-extras).
    void lazyStyle('quill');
    this.quill = new Quill(this.editorEl.nativeElement, {
      theme: 'snow',
      placeholder:
        'Írd ide a levelet… (pl. hideg lesz, hozz meleg ruhát; a maradékot csak készpénzben lehet fizetni)',
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
    this.quill.enable(false);
    this.quill.on('text-change', (_delta, _old, source) => {
      this.isEmpty.set(this.quill!.getText().trim().length === 0);
      if (source === 'user') this.scheduleSave();
    });

    this.tourService.getMailings(this.tourId()).subscribe({
      next: (res) => {
        const { draft, sent, recipients, defaults } = res.data;
        this.sent.set(sent);
        this.recipients.set(recipients);
        this.withPdf.set(defaults.withPdf);
        this.defaultSubject = defaults.subject;
        this.subject.set(draft?.subject || defaults.subject);
        if (draft?.delta) {
          this.quill!.setContents(draft.delta as never, 'silent');
        } else if (draft?.html) {
          this.quill!.clipboard.dangerouslyPasteHTML(draft.html, 'silent');
        }
        if (draft) this.savedAt.set(new Date(draft.updatedAt));
        this.isEmpty.set(this.quill!.getText().trim().length === 0);
        this.quill!.enable(true);
        this.loading.set(false);
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'A levelek betöltése nem sikerült.');
        this.loading.set(false);
      },
    });
  }

  isGpx(doc: { mimeType: string }): boolean {
    return doc.mimeType === 'application/gpx+xml';
  }

  isChosen(doc: ExtraDocument): boolean {
    return this.tickedDocuments().includes(doc._id);
  }

  toggleDocument(doc: ExtraDocument, on: boolean) {
    this.tickedDocuments.update((ids) =>
      on ? [...ids.filter((id) => id !== doc._id), doc._id] : ids.filter((id) => id !== doc._id),
    );
  }

  private chosenIds(): string[] {
    return this.chosenDocuments().map((d) => d._id);
  }

  // A sent letter's attached documents, for its paperclip's tooltip.
  sentDocumentNames(m: SentMailing): string {
    return (m.documents ?? []).map((d) => d.name).join(', ');
  }

  onSubjectChange(value: string) {
    this.subject.set(value);
    this.scheduleSave();
  }

  // Saved about 1.5 s after the last keystroke.
  private scheduleSave() {
    this.saveState.set('pending');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), SAVE_DELAY_MS);
  }

  // Saves right away (also used before sending, so nothing typed is lost).
  private async saveNow(): Promise<void> {
    clearTimeout(this.saveTimer);
    if (!this.quill) return;
    if (this.saving) await this.saving;
    this.saveState.set('saving');
    this.saving = firstValueFrom(
      this.tourService.saveMailDraft(this.tourId(), {
        subject: this.subject(),
        html: this.quill.getSemanticHTML(),
        delta: this.quill.getContents(),
      }),
    )
      .then((res) => {
        this.savedAt.set(new Date(res.data.updatedAt));
        this.saveState.set('saved');
      })
      .catch(() => this.saveState.set('error'))
      .finally(() => (this.saving = undefined));
    return this.saving;
  }

  private async flush() {
    if (this.saveState() === 'pending' || this.saveState() === 'error') await this.saveNow();
    else if (this.saving) await this.saving;
  }

  togglePreview() {
    if (!this.showPreview() && this.quill) {
      this.previewHtml.set(this.sanitizer.bypassSecurityTrustHtml(this.quill.getSemanticHTML()));
    }
    this.showPreview.update((v) => !v);
  }

  sentHtml(m: SentMailing): SafeHtml {
    // Cleaned by the server before it was saved (see utils/mailHtml.js).
    return this.sanitizer.bypassSecurityTrustHtml(m.html);
  }

  toggleSent(m: SentMailing) {
    this.openSentId.update((id) => (id === m._id ? null : m._id));
  }

  async sendTest() {
    if (this.busy() || this.isEmpty()) return;
    this.sendingTest.set(true);
    try {
      await this.flush();
      const res = await firstValueFrom(
        this.tourService.sendMailTest(this.tourId(), this.withPdf(), this.chosenIds()),
      );
      this.notifications.addSuccess(`Próbalevél elküldve: ${res.data.sentTo}`);
    } catch (err) {
      this.notifications.addError(errorMessage(err, 'A próbalevél küldése nem sikerült.'));
    } finally {
      this.sendingTest.set(false);
    }
  }

  askSend() {
    if (this.busy() || this.isEmpty()) return;
    this.confirming.set(true);
  }

  async send() {
    if (this.busy()) return;
    this.sending.set(true);
    try {
      await this.flush();
      const res = await firstValueFrom(
        this.tourService.sendMailing(this.tourId(), this.withPdf(), this.chosenIds()),
      );
      const m = res.data.mailing;
      this.sent.update((list) => [m, ...list]);
      this.notifications.addSuccess(`Levél elküldve ${m.recipientCount} résztvevőnek.`);
      // A fresh, empty letter for next time; the Programfüzet is no
      // longer ticked by default once it has gone out, nor the documents.
      this.tickedDocuments.set([]);
      this.quill?.setContents([], 'silent');
      this.subject.set(this.defaultSubject);
      this.isEmpty.set(true);
      if (m.withPdf) this.withPdf.set(false);
      this.savedAt.set(null);
      this.saveState.set('idle');
      this.showPreview.set(false);
      this.confirming.set(false);
      this.openSentId.set(m._id);
    } catch (err) {
      this.notifications.addError(errorMessage(err, 'A levél küldése nem sikerült.'));
    } finally {
      this.sending.set(false);
    }
  }

  // A click on the dark area around the window closes it - but only one
  // that began there too: a text selection dragged out of the window and
  // let go outside it ends in a click on that area as well.
  pressedOutside = false;

  backdropClick(event: MouseEvent) {
    const outside = this.pressedOutside && event.target === event.currentTarget;
    this.pressedOutside = false;
    if (outside) void this.close();
  }

  async close() {
    if (this.busy()) return;
    await this.flush();
    this.closed.emit();
  }

  ngOnDestroy() {
    clearTimeout(this.saveTimer);
    if (this.pageBody) this.pageBody.style.overflow = this.previousBodyOverflow;
  }
}
