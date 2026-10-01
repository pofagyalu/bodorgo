import { Component, computed, effect, input, signal, untracked } from '@angular/core';
import { ArcElement, ChartData, ChartOptions, DoughnutController } from 'chart.js';
import { BaseChartDirective, provideCharts } from 'ng2-charts';
import { prefersReducedMotion } from '../../shared/charts';

const DONE_COLOR = '#32a48d';
const REST_COLOR = '#e3eae7';

// How the ring draws itself - and the number in its middle counts up on
// the very same curve (Chart.js's easeOutQuart: fast, then settling).
const ANIMATION_MS = 1200;
const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;

// A ring of two slices: how many of the total are done, and the rest. In
// its middle (an HTML layer over the canvas) the share done, in percent,
// counting up as the ring fills; whatever the page puts inside the
// element goes under that number (Klub → Áttekintés: the share of this
// year's fees paid). Just a picture: nothing happens on hover.
@Component({
  selector: 'app-ring-chart',
  imports: [BaseChartDirective],
  // Just the Chart.js pieces this chart is made of (see shared/charts.ts).
  providers: [provideCharts({ registerables: [DoughnutController, ArcElement] })],
  templateUrl: './ring-chart.html',
  styleUrl: './ring-chart.scss',
})
export class RingChart {
  done = input.required<number>();
  total = input.required<number>();
  label = input('');

  readonly percent = computed(() =>
    this.total() ? Math.round((this.done() / this.total()) * 100) : 0,
  );

  // The number on screen right now: on its way from where it stood when
  // the ring last started moving (`countFrom`) to `percent`.
  readonly shownPercent = signal(0);
  private countFrom = 0;

  readonly data = computed<ChartData<'doughnut', number[]>>(() => {
    const rest = Math.max(0, this.total() - this.done());
    return {
      datasets: [
        {
          // Nothing to count yet: one full, empty ring rather than no ring.
          data: this.total() ? [this.done(), rest] : [0, 1],
          backgroundColor: [DONE_COLOR, REST_COLOR],
          borderWidth: 0,
          // The done slice ends round, like a progress ring.
          borderRadius: [20, 0],
        },
      ],
    };
  });

  readonly options: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    // Thin: a ring, with room for the text in the middle.
    cutout: '76%',
    animation: prefersReducedMotion()
      ? false
      : {
          duration: ANIMATION_MS,
          easing: 'easeOutQuart',
          // Each frame of the ring moves the number along with it.
          onProgress: ({ currentStep, numSteps }) => {
            const eased = easeOutQuart(numSteps ? Math.min(1, currentStep / numSteps) : 1);
            this.shownPercent.set(
              Math.round(this.countFrom + (this.percent() - this.countFrom) * eased),
            );
          },
          onComplete: () => this.shownPercent.set(this.percent()),
        },
    // No hovering, no tooltip.
    events: [],
  };

  constructor() {
    // New numbers: the ring sets off again, the count from where it stands
    // (with no animation, straight to the new number).
    effect(() => {
      const percent = this.percent();
      this.countFrom = untracked(this.shownPercent);
      if (prefersReducedMotion()) this.shownPercent.set(percent);
    });
  }
}
