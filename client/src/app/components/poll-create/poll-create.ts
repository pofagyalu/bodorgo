import { Component, HostListener, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { PollService, PollVisibility } from '../../services/poll';
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

// "Új szavazás" from a tour's chat (the 📊 button): a question, answers
// ("Igen / Nem" to start with), a deadline, Nyílt/Titkos, and optionally
// "at least N on the first answer". The poll then shows up in the chat as
// a live card (the server posts it - see pollController.createTourPoll).
@Component({
  selector: 'app-poll-create',
  imports: [FormsModule, MatIconModule],
  templateUrl: './poll-create.html',
  styleUrl: './poll-create.scss',
})
export class PollCreate {
  private pollService = inject(PollService);
  private notifications = inject(NotificationsService);

  tourId = input.required<string>();
  closed = output<void>();

  question = signal('');
  options = signal<string[]>(['Igen', 'Nem']);
  closesAt = signal(defaultDeadline());
  visibility = signal<PollVisibility>('open');
  useMinimum = signal(false);
  minimumCount = signal(5);
  saving = signal(false);
  error = signal<string | null>(null);

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
    const options = this.options().map((o) => o.trim()).filter(Boolean);
    if (!this.question().trim()) return this.error.set('Írd be a kérdést.');
    if (options.length < 2) return this.error.set('Legalább 2 válasz kell.');
    const closes = new Date(this.closesAt());
    if (Number.isNaN(closes.getTime()) || closes.getTime() <= Date.now()) {
      return this.error.set('A lezárás időpontja a jövőben legyen.');
    }

    this.saving.set(true);
    this.error.set(null);
    this.pollService
      .createTourPoll(this.tourId(), {
        question: this.question().trim(),
        options,
        closesAt: closes.toISOString(),
        visibility: this.visibility(),
        minimumCount: this.useMinimum() ? this.minimumCount() : null,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.closed.emit();
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(err?.error?.message ?? 'Nem sikerült elindítani a szavazást.');
        },
      });
  }
}
