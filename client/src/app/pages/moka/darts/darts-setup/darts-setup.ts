import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { MatIconModule } from '@angular/material/icon';
import { Avatar } from '../../../../components/avatar/avatar';
import { AuthService } from '../../../../auth/auth.service';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { errorMessage } from '../../../../shared/errors';
import { DartsOutMode, DartsPerson, DartsService, DartsType } from '../../../../services/darts';

// Someone in the new game: a user of the app, or a guest who is only named.
interface Chosen {
  key: string;
  userId: string | null;
  name: string;
  photoUpdatedAt: string | null;
}

const MAX_PLAYERS = 16;

// Each game's rules in short - the "Szabályok" box.
const RULES: Record<DartsType, { title: string; lines: string[] }> = {
  x01: {
    title: '301 (201, 101)',
    lines: [
      'Mindenki 301 pontról indul, és a dobott pontokat levonjuk – az nyer, aki először ér pontosan nullára.',
      'Egy kör három nyíl. A dupla gyűrű kétszer, a tripla háromszor annyit ér; a tábla közepe 25, a legbelső kör (Bull) 50.',
      'Besokallás: ha többet dobsz, mint amennyi hátravan, a kör nem számít, és onnan folytatod, ahol a kör elején álltál.',
      'Sima kiszállónál bármelyik mezővel nullázhatsz. Dupla kiszállónál az utolsó nyílnak duplának (vagy Bullnak) kell lennie, és 1 ponton sem állhatsz meg.',
      'A győztes után a többiek tovább játszanak a 2. és 3. helyért. Aki ugyanabban a körben száll ki, azok közül az a jobb, akinek kevesebb nyíl kellett.',
    ],
  },
  cricket: {
    title: 'Cricket',
    lines: [
      'Csak a 20, 19, 18, 17, 16, 15 és a tábla közepe (Bull) számít.',
      'Minden számot háromszor kell eltalálni, hogy „lezárd”. A dupla két találat, a tripla három; a Bull külső köre egy, a belső kettő.',
      'Ha egy számot már lezártál, a további találatok pontot érnek (a szám értékét) – de csak addig, amíg van olyan játékos, aki még nem zárta le.',
      'Az nyer, aki mindent lezárt, és neki van a legtöbb pontja (vagy ugyanannyi, mint a legjobbnak).',
      'A győztes után a többiek tovább játszanak a 2. és 3. helyért.',
    ],
  },
};

// Móka → Darts → Új játék: what is played (301 / 201 / 101 or Cricket, how
// to finish) and by whom, in what order. The game starts when it's created.
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
  ];

  type = signal<DartsType>('x01');
  startScore = signal(301);
  outMode = signal<DartsOutMode>('single');
  rulesOpen = signal(false);
  rules = computed(() => RULES[this.type()]);

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
