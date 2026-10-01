import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { filter, map, startWith } from 'rxjs';

// A darts game's own page (moka/darts/<id>) - not the list, not "uj".
const isGameUrl = (url: string) => /^\/moka\/darts\/(?!uj\b)[^/?#]+/.test(url);

// Outer shell for moka/* - the games: Darts first, the quiz later. Same
// sidebar layout as the Klub and Média shells.
@Component({
  selector: 'app-moka',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, MatIconModule],
  templateUrl: './moka.html',
  styleUrl: './moka.scss',
})
export class Moka {
  private router = inject(Router);

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
