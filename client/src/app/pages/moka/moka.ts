import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../auth/auth.service';

// A darts game's own page (moka/darts/<id>) - not the list, not "uj".
const isGameUrl = (url: string) => /^\/moka\/darts\/(?!uj\b)[^/?#]+/.test(url);

// Outer shell for moka/* - the games: Darts, Futókörök (the running
// race), the quiz later. Same
// sidebar layout as the Klub and Média shells.
@Component({
  selector: 'app-moka',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, MatIconModule],
  templateUrl: './moka.html',
  styleUrl: './moka.scss',
})
export class Moka {
  private router = inject(Router);
  private auth = inject(AuthService);

  // Futókörök's own pages, under it in the menu (on a phone: a second row
  // of tabs) - the club's cards only for admins.
  futokorPages = computed(() => [
    { link: 'futokor', label: 'Futás', icon: 'directions_run', exact: true },
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
