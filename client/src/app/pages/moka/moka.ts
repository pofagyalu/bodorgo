import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { canSeeFutokor } from '../../auth/futokor.guard';
import { TabOption, TabStrip } from '../../components/tab-strip/tab-strip';

// A game's own page: a darts game (moka/darts/<id> - not the list, not
// "uj", not "szabalyok") or a quiz being played (moka/kviz/jatekok/<id>).
const isGameUrl = (url: string) =>
  /^\/moka\/(darts\/(?!(uj|szabalyok)\b)|kviz\/jatekok\/)[^/?#]+/.test(url);

// Outer shell for moka/* - the games: Darts, Futókörök (the running
// race), Kvíz. Same
// sidebar layout as the Klub and Média shells.
@Component({
  selector: 'app-moka',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, MatIconModule, TabStrip],
  templateUrl: './moka.html',
  styleUrl: './moka.scss',
})
export class Moka {
  private router = inject(Router);
  private auth = inject(AuthService);

  // Darts' own pages, under it in the menu (on a phone: a second row of
  // tabs, after the games themselves).
  readonly dartsPages = [{ link: 'darts/szabalyok', label: 'Szabályok', icon: 'menu_book' }];

  // Futókörök's own pages, under it in the menu (on a phone: a second row
  // of tabs) - the club's cards only for admins.
  futokorPages = computed(() => [
    { link: 'futokor/futas', label: 'Futás', icon: 'directions_run', exact: false },
    { link: 'futokor/eredmenyek', label: 'Eredmények', icon: 'emoji_events', exact: false },
    { link: 'futokor/utmutato', label: 'Útmutató', icon: 'help', exact: false },
    { link: 'futokor/palyaszerkeszto', label: 'Pályaszerkesztő', icon: 'route', exact: false },
    ...(this.auth.user()?.role === 'admin'
      ? [{ link: 'futokor/kartyak', label: 'Kártyák', icon: 'qr_code_2', exact: false }]
      : []),
  ]);

  private url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );
  inDarts = computed(() => this.url().startsWith('/moka/darts'));
  inFutokor = computed(() => this.url().startsWith('/moka/futokor'));
  inQuiz = computed(() => this.url().startsWith('/moka/kviz'));

  // Kvíz's own pages: the games (to join, and the ones played), the
  // quizzes themselves with their editor, and what an answer is worth.
  readonly quizPages = [
    { link: 'kviz/jatekok', label: 'Játékszoba', icon: 'meeting_room' },
    { link: 'kviz/szerkeszto', label: 'Alkotóműhely', icon: 'handyman' },
    { link: 'kviz/pontozas', label: 'Pontozás', icon: 'calculate' },
  ];

  // The phone's second row of tabs: the pages of the game one is in - a
  // tab's value is its page's link. Futókörök's opening page is the first
  // of its tabs there (on a wide screen the menu's Futókörök itself leads to
  // it), so one of them is always the open one - and so is Darts' (its
  // games: the leaderboards, a new game, one's own games).
  subTabs = computed<TabOption[]>(() => {
    if (this.inDarts()) {
      return [
        { value: 'darts', label: 'Játékok' },
        ...this.dartsPages.map((p) => ({ value: p.link, label: p.label })),
      ];
    }
    if (this.inFutokor()) {
      return [
        { value: 'futokor', label: 'Bemelegítés' },
        ...this.futokorPages().map((p) => ({ value: p.link, label: p.label })),
      ];
    }
    return this.inQuiz() ? this.quizPages.map((p) => ({ value: p.link, label: p.label })) : [];
  });
  // What the row of tabs is, for a screen reader.
  subLabel = computed(() => {
    if (this.inDarts()) return 'Darts menü';
    return this.inQuiz() ? 'Kvíz menü' : 'Futókörök menü';
  });
  // The open one: the tab whose page the address is, or is under - the
  // deepest such (every page of Futókörök is under its opening page).
  subTab = computed(() => {
    const path = this.url().split(/[?#]/)[0];
    return (
      this.subTabs()
        .filter((t) => path === `/moka/${t.value}` || path.startsWith(`/moka/${t.value}/`))
        .sort((x, y) => y.value.length - x.value.length)[0]?.value ?? ''
    );
  });

  openSub(link: string) {
    void this.router.navigateByUrl(`/moka/${link}`);
  }

  // Futókörök is for whoever futokor.guard.ts lets in (everyone logged
  // in) - and for someone running a race already on their phone.
  seesRace = computed(() => canSeeFutokor(this.auth.user()) || this.inFutokor());

  // During a game the phone's tabs go away: the whole screen is the game's.
  inGame = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => isGameUrl(this.router.url)),
      startWith(isGameUrl(this.router.url)),
    ),
    { initialValue: false },
  );
}
