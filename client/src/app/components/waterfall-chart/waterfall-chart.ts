import { Component, computed, DestroyRef, ElementRef, inject, input, signal } from '@angular/core';
import {
  BarController,
  BarElement,
  CategoryScale,
  ChartData,
  ChartOptions,
  LinearScale,
  Plugin,
  Tooltip,
} from 'chart.js';
import { BaseChartDirective, provideCharts } from 'ng2-charts';
import { pageFont, prefersReducedMotion } from '../../shared/charts';

// One bar of the waterfall: where the money stood before it and after it.
// A `total` (Nyitó, Záró) stands on zero; an `in` or `out` hangs between
// the two amounts.
export interface WaterfallStep {
  label: string;
  from: number;
  to: number;
  kind: 'total' | 'in' | 'out';
}

const COLORS = { total: '#a9b4ba', in: '#32a48d', out: '#efa46f' };

// A grid line at every 10 thousand - or, once that would be more than
// this many lines, at every 20, 50, 100... thousand.
const GRID_STEP = 10_000;
const MAX_GRID_LINES = 12;

// A phone is too narrow for the names side by side under the bars: there
// each name stays on one line and tilts as far as it needs to fit.
const PHONE_QUERY = '(max-width: 580px)';

const forints = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 });
const money = (amount: number) => `${forints.format(amount)} Ft`;

// In thousands, as on the y axis: 21 350 is '21,4e'.
const thousands = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 1 });
const inThousands = (amount: number) => `${thousands.format(amount / 1000)}e`;

// What is written above a bar: how much it added (+) or took (−) - a
// total is its plain amount.
function barLabel(step: WaterfallStep): string {
  if (step.kind === 'total') return inThousands(step.to);
  const change = step.to - step.from;
  return (change < 0 ? '−' : '+') + inThousands(Math.abs(change));
}

// A waterfall of money (Klub → Pénzügyek): from the opening amount through
// each kind of income and expense to the closing one. The y axis is in
// thousands of forints ("45e").
@Component({
  selector: 'app-waterfall-chart',
  imports: [BaseChartDirective],
  // Just the Chart.js pieces this chart is made of (see shared/charts.ts).
  providers: [
    provideCharts({
      registerables: [BarController, BarElement, CategoryScale, LinearScale, Tooltip],
    }),
  ],
  templateUrl: './waterfall-chart.html',
  styleUrl: './waterfall-chart.scss',
})
export class WaterfallChart {
  private host: ElementRef<HTMLElement> = inject(ElementRef);

  steps = input.required<WaterfallStep[]>();
  label = input('');

  private phoneQuery = window.matchMedia?.(PHONE_QUERY);
  private onPhone = signal(!!this.phoneQuery?.matches);

  constructor() {
    const onChange = () => this.onPhone.set(!!this.phoneQuery?.matches);
    this.phoneQuery?.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => this.phoneQuery?.removeEventListener('change', onChange));
  }

  // Chart.js has no labels on its bars: this writes each one above its
  // bar, after the bars are drawn (so on every frame as they grow).
  readonly plugins: Plugin<'bar'>[] = [
    {
      id: 'barLabels',
      afterDatasetsDraw: (chart) => {
        const steps = this.steps();
        const { ctx } = chart;
        ctx.save();
        ctx.font = `600 11px ${pageFont(this.host.nativeElement)}`;
        ctx.fillStyle = '#4a5b63';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        chart.getDatasetMeta(0).data.forEach((bar, i) => {
          if (!steps[i]) return;
          const { x, y, base } = bar.getProps(['x', 'y', 'base']);
          ctx.fillText(barLabel(steps[i]), x, Math.min(y, base) - 4);
        });
        ctx.restore();
      },
    },
  ];

  // Floating bars: each one's data is its [from, to].
  readonly data = computed<ChartData<'bar', [number, number][], string | string[]>>(() => ({
    // A word a line, so the long names fit under their bars - on a phone
    // a name is one line, tilted (see the x axis below).
    labels: this.steps().map((s) => (this.onPhone() ? s.label : s.label.split(' '))),
    datasets: [
      {
        data: this.steps().map((s) => [s.from, s.to]),
        backgroundColor: this.steps().map((s) => COLORS[s.kind]),
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 32,
        // An amount of zero still leaves a sliver to see (and to hover).
        minBarLength: 2,
      },
    ],
  }));

  readonly options = computed<ChartOptions<'bar'>>(() => {
    const steps = this.steps();
    const amounts = steps.flatMap((s) => [s.from, s.to]);
    const range = Math.max(0, ...amounts) - Math.min(0, ...amounts);
    let stepSize = GRID_STEP;
    for (const factor of [2, 2.5, 2, 2, 2.5, 2, 2, 2.5, 2]) {
      if (range / stepSize <= MAX_GRID_LINES) break;
      stepSize *= factor;
    }
    const font = { family: pageFont(this.host.nativeElement), size: 11 };
    return {
      responsive: true,
      maintainAspectRatio: false,
      // Room for the label above the tallest bar.
      layout: { padding: { top: 18 } },
      animation: prefersReducedMotion() ? false : { duration: 900, easing: 'easeOutQuart' },
      scales: {
        x: {
          grid: { display: false },
          border: { color: '#e8eeea' },
          // On a phone Chart.js tilts the names just as far as they need
          // not to overlap - at most standing upright.
          ticks: {
            color: '#56666e',
            font,
            maxRotation: this.onPhone() ? 90 : 0,
            autoSkip: false,
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: '#e8eeea' },
          border: { display: false },
          ticks: {
            stepSize,
            color: '#56666e',
            font,
            // Thousands: 45 000 is "45e".
            callback: (value) => (Number(value) === 0 ? '0' : `${Number(value) / 1000}e`),
          },
        },
      },
      plugins: {
        tooltip: {
          displayColors: false,
          padding: 10,
          titleFont: { ...font, size: 12, weight: 'bold' },
          bodyFont: { ...font, size: 12 },
          callbacks: {
            // A total (Nyitó, Záró) is headed Egyenleg, with its own name
            // before the amount: 'Nyitó: 45 000 Ft'. An income or expense
            // says where the money stood before it and after it.
            title: (items) => {
              const step = steps[items[0].dataIndex];
              return step.kind === 'total' ? 'Egyenleg' : step.label;
            },
            label: (item) => {
              const step = steps[item.dataIndex];
              return step.kind === 'total'
                ? `${step.label}: ${money(step.to)}`
                : `${money(step.from)} → ${money(step.to)}`;
            },
          },
        },
      },
    };
  });
}
