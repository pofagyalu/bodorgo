import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { canSeeFutokor } from '../../auth/futokor.guard';
import { TabOption, TabStrip } from '../../components/tab-strip/tab-strip';

// A game's own page: a darts game (moka/darts/<id> - not the list, not
// "uj") or a quiz being played (moka/kviz/jatekok/<id>).
const isGameUrl = (url: string) => /^\/moka\/(darts\/(?!uj\b)|kviz\/jatekok\/)[^/?#]+/.test(url);

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
  // tab's value is its page's link. None is open on a page above them
  // (Futókörök's first one).
  subTabs = computed<TabOption[]>(() => {
    const pages = this.inFutokor() ? this.futokorPages() : this.inQuiz() ? this.quizPages : [];
    return pages.map((p) => ({ value: p.link, label: p.label }));
  });
  subTab = computed(() => {
    const path = this.url().split(/[?#]/)[0];
    return (
      this.subTabs().find(
        (t) => path === `/moka/${t.value}` || path.startsWith(`/moka/${t.value}/`),
      )?.value ?? ''
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
