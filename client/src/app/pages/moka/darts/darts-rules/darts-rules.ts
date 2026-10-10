import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Masonry } from '../../../../shared/masonry/masonry.directive';
import { DARTS_RULES, DARTS_RULES_ORDER } from './rules';

// Móka → Darts → Szabályok: every game's rules in short, and how a game is
// scored in the app - one phone keeps the score, the others follow.
@Component({
  selector: 'app-darts-rules',
  imports: [RouterLink, MatIconModule, Masonry],
  templateUrl: './darts-rules.html',
  styleUrl: './darts-rules.scss',
})
export class DartsRules {
  readonly games = DARTS_RULES_ORDER.map((type) => DARTS_RULES[type]);
}
