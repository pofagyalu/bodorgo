import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Poll, PollService } from '../../services/poll';
import { TourSocketService } from '../../services/tour-socket';
import { NotificationsService } from '../../notifications/notifications.service';

// One poll, the same in the chat and on the Voks page: tap an answer
// to vote (tap another to change it), counts and bars, who voted what on
// an open ('Nyílt') poll, progress towards a minimum ("3 / 5 fő"), the
// deadline, and close/delete for whoever started it (or an admin).
// In the chat (`live`) it also follows everyone else's votes as they
// happen (the server's 'poll-updated' socket event).
@Component({
  selector: 'app-poll-card',
  imports: [MatIconModule, RouterLink],
  templateUrl: './poll-card.html',
  styleUrl: './poll-card.scss',
})
export class PollCard implements OnInit, OnDestroy {
  private pollService = inject(PollService);
  private tourSocket = inject(TourSocketService);
  private notifications = inject(NotificationsService);

  pollId = input.required<string>();
  // Already loaded (the Voks list) - no extra request then.
  initial = input<Poll | null>(null);
  // In a tour chat: follow votes live, link to Voks.
  live = input(false);
  // On Voks: which tour it belongs to, and a link to its chat.
  showTour = input(false);

  // Deleted - the parent drops it from its list.
  removed = output<string>();

  poll = signal<Poll | null>(null);
  busy = signal(false);
  confirmDelete = signal(false);
  private stopListening?: () => void;

  resultFor = (optionId: string) => this.poll()?.results?.find((r) => r._id === optionId) ?? null;

  // "Anna, Béla, Zoli" - open polls only.
  voterNames(r: { voters?: { name: string }[] }): string {
    return (r.voters ?? []).map((v) => v.name).join(', ');
  }

  minimumText = computed(() => {
    const p = this.poll();
    if (!p?.minimum) return '';
    const answer = p.options.find((o) => o._id === p.minimum!.optionId)?.text ?? '';
    const missing = p.minimum.count - p.minimum.current;
    return p.minimum.reached
      ? `Összejött! ${p.minimum.current} fő – „${answer}”`
      : `„${answer}”: ${p.minimum.current} / ${p.minimum.count} fő – még ${missing} kell`;
  });

  minimumPercent = computed(() => {
    const m = this.poll()?.minimum;
    return m ? Math.min(100, Math.round((m.current / m.count) * 100)) : 0;
  });

  constructor() {
    // A new `initial` (e.g. the Voks page saved an edit) replaces it.
    effect(() => {
      const initial = this.initial();
      if (initial) this.poll.set(initial);
    });
  }

  ngOnInit() {
    if (!this.initial()) this.load();

    if (this.live()) {
      this.stopListening = this.tourSocket.on<{ pollId: string }>('poll-updated', (e) => {
        if (e.pollId === this.pollId()) this.load();
      });
    }
  }

  ngOnDestroy() {
    this.stopListening?.();
  }

  private load() {
    this.pollService.getPoll(this.pollId()).subscribe({
      next: (res) => this.poll.set(res.data.poll),
      error: () => {},
    });
  }

  vote(optionId: string) {
    const p = this.poll();
    if (!p || p.isClosed || this.busy() || p.myOptionId === optionId) return;
    this.busy.set(true);
    this.pollService.vote(p._id, optionId).subscribe({
      next: (res) => {
        this.poll.set(res.data.poll);
        this.busy.set(false);
      },
      error: (err) => {
        this.busy.set(false);
        this.notifications.addError(err?.error?.message ?? 'Nem sikerült szavazni.');
      },
    });
  }

  close() {
    const p = this.poll();
    if (!p || this.busy()) return;
    this.busy.set(true);
    this.pollService.closePoll(p._id).subscribe({
      next: (res) => {
        this.poll.set(res.data.poll);
        this.busy.set(false);
      },
      error: (err) => {
        this.busy.set(false);
        this.notifications.addError(err?.error?.message ?? 'Nem sikerült lezárni.');
      },
    });
  }

  remove() {
    const p = this.poll();
    if (!p || this.busy()) return;
    this.busy.set(true);
    this.pollService.deletePoll(p._id).subscribe({
      next: () => {
        this.busy.set(false);
        this.removed.emit(p._id);
      },
      error: (err) => {
        this.busy.set(false);
        this.notifications.addError(err?.error?.message ?? 'Nem sikerült törölni.');
      },
    });
  }

  // "péntek 20:00" this week, otherwise "okt. 12. 20:00".
  deadline(iso: string): string {
    const d = new Date(iso);
    const days = (d.getTime() - Date.now()) / 86400000;
    const time = d.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
    const day =
      days >= 0 && days < 6
        ? d.toLocaleDateString('hu-HU', { weekday: 'long' })
        : d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
    return `${day} ${time}`;
  }
}
