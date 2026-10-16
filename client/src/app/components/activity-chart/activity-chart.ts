import { Component, computed, input } from '@angular/core';
import {
  BarController,
  BarElement,
  CategoryScale,
  ChartData,
  ChartOptions,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { BaseChartDirective, provideCharts } from 'ng2-charts';
import { pageFont, prefersReducedMotion } from '../../shared/charts';

export interface ActivityPoint {
  label: string; // YYYY-MM-DD, or YYYY-MM for a month
  people: number;
}

const BAR_COLOR = '#1a796c';
const MONTHS = [
  'jan.',
  'febr.',
  'márc.',
  'ápr.',
  'máj.',
  'jún.',
  'júl.',
  'aug.',
  'szept.',
  'okt.',
  'nov.',
  'dec.',
];

// "10. 16." for a day, "2026. okt." for a month.
export function activityLabel(label: string): string {
  const [year, month, day] = label.split('-');
  return day ? `${month}. ${day}.` : `${year}. ${MONTHS[Number(month) - 1]}`;
}

// Klub → Statisztika: how many people used the app, a bar a day (or a
// month, for every day).
@Component({
  selector: 'app-activity-chart',
  imports: [BaseChartDirective],
  // Just the Chart.js pieces this chart is made of (see shared/charts.ts).
  providers: [
    provideCharts({
      registerables: [BarController, BarElement, CategoryScale, LinearScale, Tooltip],
    }),
  ],
  templateUrl: './activity-chart.html',
  styleUrl: './activity-chart.scss',
})
export class ActivityChart {
  points = input.required<ActivityPoint[]>();

  readonly data = computed<ChartData<'bar', number[]>>(() => ({
    labels: this.points().map((p) => activityLabel(p.label)),
    datasets: [
      {
        data: this.points().map((p) => p.people),
        backgroundColor: BAR_COLOR,
        borderRadius: 4,
        maxBarThickness: 28,
      },
    ],
  }));

  private readonly font = { family: pageFont(), size: 12 };
  readonly options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: prefersReducedMotion() ? false : { duration: 900, easing: 'easeOutQuart' },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#777', font: this.font, maxRotation: 0, autoSkipPadding: 12 },
      },
      y: {
        beginAtZero: true,
        ticks: { color: '#777', font: this.font, precision: 0 },
      },
    },
    plugins: {
      tooltip: {
        titleFont: { ...this.font, weight: 'bold' },
        bodyFont: this.font,
        callbacks: { label: (item) => `${item.parsed.y} fő` },
      },
    },
  };
}
