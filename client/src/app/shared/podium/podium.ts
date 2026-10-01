import { Component, computed, input, signal } from '@angular/core';
import { Avatar } from '../../components/avatar/avatar';
import { CelebrationEffect, playCelebration } from '../celebration-effects';

// Someone on the podium.
export interface PodiumWinner {
  place: 1 | 2 | 3;
  userId: string;
  name: string;
  // The profile photo's version, if they have one (see app-avatar).
  photoVersion?: string | null;
}

// Each place is celebrated its own way.
const EFFECT_OF: Record<number, CelebrationEffect> = {
  1: 'confetti',
  2: 'fireworks',
  3: 'cannons',
};
const CELEBRATION_MS = 5000;
// How long a step keeps its "just arrived" look.
const ARRIVAL_MS = 2500;

// A winners' podium for any game: three steps - 2nd, 1st (the tallest, in
// the middle), 3rd - each empty until its winner is given. It only shows
// what it's handed (`winners`); a game calls celebrate(place) the moment a
// place is taken: that winner rises onto their step and the place's own
// effect plays for five seconds (confetti rain for the 1st, fireworks for
// the 2nd, side cannons for the 3rd). Without celebrate() - e.g. opened
// later - the winners are simply there.
@Component({
  selector: 'app-podium',
  imports: [Avatar],
  templateUrl: './podium.html',
  styleUrl: './podium.scss',
})
export class Podium {
  winners = input.required<PodiumWinner[]>();
  // A line above the steps, e.g. the game's name.
  title = input('');
  // On a step nobody stands on yet.
  emptyText = input('?');

  // The steps left to right: 2nd, 1st, 3rd.
  steps = computed(() =>
    ([2, 1, 3] as const).map((place) => ({
      place,
      winner: this.winners().find((w) => w.place === place) ?? null,
    })),
  );

  // The place that has just been taken (its step is lit up for a moment).
  arrived = signal<number | null>(null);
  private arrivalTimer?: ReturnType<typeof setTimeout>;

  celebrate(place: number) {
    this.arrived.set(place);
    clearTimeout(this.arrivalTimer);
    this.arrivalTimer = setTimeout(() => this.arrived.set(null), ARRIVAL_MS);
    void playCelebration(EFFECT_OF[place] ?? 'confetti', CELEBRATION_MS);
  }
}
