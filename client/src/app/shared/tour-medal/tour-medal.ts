import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

// The tour medals - how many tours someone has been on (already started
// ones, see server/src/utils/toursAttended.js): 10 bronz, 20 ezüst,
// 30 arany, 40 platina, 50 gyémánt.
export const MEDALS = [
  { min: 50, key: 'diamond', name: 'Gyémánt', icon: 'diamond' },
  { min: 40, key: 'platinum', name: 'Platina', icon: 'workspace_premium' },
  { min: 30, key: 'gold', name: 'Arany', icon: 'workspace_premium' },
  { min: 20, key: 'silver', name: 'Ezüst', icon: 'workspace_premium' },
  { min: 10, key: 'bronze', name: 'Bronz', icon: 'workspace_premium' },
] as const;

export type Medal = (typeof MEDALS)[number];

export function medalFor(tours: number): Medal | null {
  return MEDALS.find((m) => tours >= m.min) ?? null;
}

// The next medal up and how many tours are still missing - null at the top.
export function nextMedal(tours: number): { medal: Medal; missing: number } | null {
  const next = [...MEDALS].reverse().find((m) => tours < m.min);
  return next ? { medal: next, missing: next.min - tours } : null;
}

// Hungarian suffixes for "az aranyig" / "a bronzig" etc.
const UNTIL: Record<Medal['key'], string> = {
  bronze: 'a bronzig',
  silver: 'az ezüstig',
  gold: 'az aranyig',
  platinum: 'a platináig',
  diamond: 'a gyémántig',
};

// A small medal icon for a tour count (nothing below 10) - next to the
// Táborok number in the Felhasználók tables; with `withLabel` also the
// medal's name and how far the next one is (Profilom).
@Component({
  selector: 'app-tour-medal',
  imports: [MatIconModule],
  template: `
    @if (medal(); as m) {
      <span class="medal" [class]="'medal medal--' + m.key" [title]="title()">
        <mat-icon>{{ m.icon }}</mat-icon>
        @if (withLabel()) {
          <span class="medal-label">
            <strong>{{ m.name }} bódorgó</strong><span class="medal-sep"> – </span
            ><span class="medal-detail"
              >{{ tours() }} tábor
              @if (next(); as n) {
                · még {{ n.missing }} {{ until(n.medal.key) }}
              }
            </span>
          </span>
        }
      </span>
    } @else if (withLabel() && next(); as n) {
      <span class="medal medal--none">
        <span class="medal-label"
          >{{ tours() }} tábor · még {{ n.missing }} {{ until(n.medal.key) }}</span
        >
      </span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      vertical-align: middle;
    }
    .medal {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    /* The colour of wherever it sits (white on the dark Profilom banner). */
    .medal-label {
      font-size: 13px;
      color: inherit;
    }
    /* A narrow screen: the rank on the first line, the tour count and the
       next rank's distance on the second. */
    @media (max-width: 580px) {
      .medal-sep {
        display: none;
      }
      .medal-detail {
        display: block;
      }
    }
    .medal--bronze mat-icon {
      color: #b87333;
    }
    .medal--silver mat-icon {
      color: #95a3ab;
    }
    .medal--gold mat-icon {
      color: #e0a92b;
    }
    .medal--platinum mat-icon {
      color: #6fa8c2;
    }
    .medal--diamond mat-icon {
      color: #1fb5c9;
      filter: drop-shadow(0 0 3px #7fe3ee);
    }
  `,
})
export class TourMedal {
  tours = input.required<number>();
  withLabel = input(false);

  medal = computed(() => medalFor(this.tours()));
  next = computed(() => nextMedal(this.tours()));

  title = computed(() => {
    const m = this.medal();
    return m ? `${m.name} bódorgó – ${m.min}+ tábor` : '';
  });

  until(key: Medal['key']): string {
    return UNTIL[key];
  }
}
