import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { MatIconModule } from '@angular/material/icon';
import { Avatar } from '../../../../components/avatar/avatar';
import { AuthService } from '../../../../auth/auth.service';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { errorMessage } from '../../../../shared/errors';
import { DartsOutMode, DartsPerson, DartsService, DartsType } from '../../../../services/darts';
import { DARTS_RULES } from '../darts-rules/rules';

// Someone in the new game: a user of the app, or a guest who is only named.
interface Chosen {
  key: string;
  userId: string | null;
  name: string;
  photoUpdatedAt: string | null;
}

const MAX_PLAYERS = 16;

// Móka → Darts → Új játék: what is played (301 / 201 / 101, Cricket or High
// Score - how to finish, how many rounds) and by whom, in what order. The game starts when it's created.
@Component({
  selector: 'app-darts-setup',
  imports: [RouterLink, MatIconModule, Avatar, CdkDropList, CdkDrag, CdkDragHandle],
  templateUrl: './darts-setup.html',
  styleUrl: './darts-setup.scss',
})
export class DartsSetup {
  private darts = inject(DartsService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private notifications = inject(NotificationsService);

  readonly startScores = [301, 201, 101];
  // High Score: how many rounds are played.
  readonly roundChoices = [5, 8, 10, 15, 20];
  readonly outModes: { value: DartsOutMode; label: string; hint: string }[] = [
    { value: 'single', label: 'Sima kiszálló', hint: 'Bármelyik mezővel nullára érhetsz' },
    {
      value: 'double',
      label: 'Dupla kiszálló',
      hint: 'Csak duplával (vagy Bull-lal) lehet nullázni',
    },
  ];
  readonly types: { value: DartsType; label: string }[] = [
    { value: 'x01', label: '301 · 201 · 101' },
    { value: 'cricket', label: 'Cricket' },
    { value: 'highscore', label: 'High Score' },
  ];

  type = signal<DartsType>('x01');
  startScore = signal(301);
  outMode = signal<DartsOutMode>('single');
  rounds = signal(8);
  rulesOpen = signal(false);
  rules = computed(() => DARTS_RULES[this.type()]);

  people = signal<DartsPerson[]>([]);
  chosen = signal<Chosen[]>([]);
  search = signal('');
  guestName = signal('');
  starting = signal(false);

  // Who can still be added: not in the game yet, matching what's typed.
  available = computed(() => {
    const taken = new Set(this.chosen().map((c) => c.userId));
    const q = this.search().trim().toLocaleLowerCase('hu');
    return this.people().filter(
      (p) => !taken.has(p._id) && (!q || p.name.toLocaleLowerCase('hu').includes(q)),
    );
  });

  isFull = computed(() => this.chosen().length >= MAX_PLAYERS);
  outHint = computed(() => this.outModes.find((m) => m.value === this.outMode())!.hint);

  constructor() {
    this.darts.getPeople().subscribe({
      next: (people) => {
        this.people.set(people);
        // Whoever sets the game up is most likely playing.
        const me = people.find((p) => p._id === this.auth.user()?.id);
        if (me && !this.chosen().length) this.add(me);
      },
      error: (err) =>
        this.notifications.addError(errorMessage(err, 'Nem sikerült betölteni a játékosokat.')),
    });
  }

  add(person: DartsPerson) {
    if (this.isFull()) return;
    this.chosen.update((list) => [
      ...list,
      {
        key: person._id,
        userId: person._id,
        name: person.name,
        photoUpdatedAt: person.photoUpdatedAt,
      },
    ]);
    this.search.set('');
  }

  addGuest() {
    const name = this.guestName().trim();
    if (!name || this.isFull()) return;
    this.chosen.update((list) => [
      ...list,
      { key: `guest-${Date.now()}`, userId: null, name, photoUpdatedAt: null },
    ]);
    this.guestName.set('');
  }

  remove(key: string) {
    this.chosen.update((list) => list.filter((c) => c.key !== key));
  }

  reorder(event: CdkDragDrop<Chosen[]>) {
    this.chosen.update((list) => {
      const next = [...list];
      next.splice(event.currentIndex, 0, ...next.splice(event.previousIndex, 1));
      return next;
    });
  }

  shuffle() {
    this.chosen.update((list) => {
      const next = [...list];
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    });
  }

  start() {
    if (!this.chosen().length || this.starting()) return;
    this.starting.set(true);
    this.darts
      .createGame({
        type: this.type(),
        startScore: this.startScore(),
        outMode: this.outMode(),
        ...(this.type() === 'highscore' && { rounds: this.rounds() }),
        players: this.chosen().map((c) =>
          c.userId ? { userId: c.userId } : { guestName: c.name },
        ),
      })
      .subscribe({
        next: (game) => this.router.navigate(['/moka/darts', game._id]),
        error: (err) => {
          this.starting.set(false);
          this.notifications.addError(errorMessage(err, 'Nem sikerült elindítani a játékot.'));
        },
      });
  }
}
