import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PollService, Poll } from '../../services/poll';
import { TourService, Tour } from '../../services/tour';
import { AuthService } from '../../auth/auth.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PollCard } from '../../components/poll-card/poll-card';
import { PollCreate } from '../../components/poll-create/poll-create';

// Every poll, open ones first: the ones started in a tour's chat (with a
// link back to it) and the ones an admin creates here. Each is the same
// card as in the chat (components/poll-card) - voting, results, Nyílt /
// Titkos, minimum, close/delete for whoever started it. Admins can also
// create and edit polls here - in the same dialog as the chat's
// (components/poll-create), with "Hol?" (Általános or a tour).
@Component({
  selector: 'app-szavazasok',
  imports: [MatIconModule, PollCard, PollCreate],
  templateUrl: './szavazasok.html',
  styleUrl: './szavazasok.scss',
})
export class Szavazasok implements OnInit {
  private pollService = inject(PollService);
  private tourService = inject(TourService);
  private notifications = inject(NotificationsService);
  auth = inject(AuthService);

  loading = signal(true);
  polls = signal<Poll[]>([]);
  tours = signal<Tour[]>([]);

  sections = computed(() => [
    // Exactly what the Voks badge counts - see Poll.awaitsMyVote.
    { title: 'Rád vár', polls: this.polls().filter((p) => p.awaitsMyVote) },
    { title: 'Nyitott', polls: this.polls().filter((p) => !p.isClosed && !p.awaitsMyVote) },
    { title: 'Lezárt', polls: this.polls().filter((p) => p.isClosed) },
  ]);

  // The poll dialog: open, and the poll being edited (null: a new one).
  showForm = signal(false);
  editingPoll = signal<Poll | null>(null);

  ngOnInit() {
    this.loadPolls();
    this.pollService.refreshPending();
  }

  private loadPolls() {
    this.loading.set(true);
    this.pollService.getPolls().subscribe({
      next: (res) => {
        this.polls.set(res.data.polls);
        this.loading.set(false);
      },
      error: () => {
        this.notifications.addError('A voks betöltése nem sikerült.');
        this.loading.set(false);
      },
    });
  }

  // Only fetched once, and only once an admin actually opens the form -
  // nobody else on this page ever needs the full tour list.
  private loadTours() {
    if (this.tours().length) return;
    this.tourService.getTours().subscribe({
      next: (res) => this.tours.set(res.data.tours),
      error: () => this.notifications.addError('A táborok betöltése nem sikerült.'),
    });
  }

  isAdmin(): boolean {
    return this.auth.user()?.role === 'admin';
  }

  // A vote (or a close) moves the poll between the sections, and the
  // badge's number follows.
  onChanged(poll: Poll) {
    this.polls.update((list) => list.map((p) => (p._id === poll._id ? poll : p)));
    this.pollService.refreshPending();
  }

  onRemoved(id: string) {
    this.polls.update((list) => list.filter((p) => p._id !== id));
  }

  openCreate() {
    this.editingPoll.set(null);
    this.loadTours();
    this.showForm.set(true);
  }

  openEdit(poll: Poll) {
    this.editingPoll.set(poll);
    this.loadTours();
    this.showForm.set(true);
  }

  onSaved(poll: Poll) {
    if (this.editingPoll()) {
      this.polls.update((list) => list.map((p) => (p._id === poll._id ? poll : p)));
      this.notifications.addSuccess('Szavazás mentve');
    } else {
      this.polls.update((list) => [poll, ...list]);
      this.notifications.addSuccess('Szavazás létrehozva');
    }
  }
}
