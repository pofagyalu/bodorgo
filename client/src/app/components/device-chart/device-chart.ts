import { Component, computed, input } from '@angular/core';
import { ArcElement, ChartData, ChartOptions, DoughnutController, Tooltip } from 'chart.js';
import { BaseChartDirective, provideCharts } from 'ng2-charts';
import { pageFont, prefersReducedMotion } from '../../shared/charts';

export interface DeviceCounts {
  phone: number;
  tablet: number;
  desktop: number;
}

const SLICES: { key: keyof DeviceCounts; label: string; color: string }[] = [
  { key: 'phone', label: 'Telefon', color: '#1a796c' },
  { key: 'desktop', label: 'Számítógép', color: '#f07827' },
  { key: 'tablet', label: 'Tablet', color: '#096396' },
];

// Klub → Statisztika: what the app was used on - a ring of the person-days
// on a phone, a computer and a tablet, with its own legend in percents.
@Component({
  selector: 'app-device-chart',
  imports: [BaseChartDirective],
  // Just the Chart.js pieces this chart is made of (see shared/charts.ts).
  providers: [provideCharts({ registerables: [DoughnutController, ArcElement, Tooltip] })],
  templateUrl: './device-chart.html',
  styleUrl: './device-chart.scss',
})
export class DeviceChart {
  devices = input.required<DeviceCounts>();

  private total = computed(() => SLICES.reduce((sum, s) => sum + this.devices()[s.key], 0));

  readonly legend = computed(() =>
    SLICES.map((s) => ({
      ...s,
      percent: this.total() ? Math.round((this.devices()[s.key] / this.total()) * 100) : 0,
    })),
  );

  readonly data = computed<ChartData<'doughnut', number[]>>(() => ({
    labels: SLICES.map((s) => s.label),
    datasets: [
      {
        data: SLICES.map((s) => this.devices()[s.key]),
        backgroundColor: SLICES.map((s) => s.color),
        borderWidth: 0,
      },
    ],
  }));

  private readonly font = { family: pageFont(), size: 12 };
  readonly options: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '62%',
    animation: prefersReducedMotion() ? false : { duration: 900, easing: 'easeOutQuart' },
    plugins: {
      tooltip: {
        titleFont: { ...this.font, weight: 'bold' },
        bodyFont: this.font,
        callbacks: { label: (item) => `${item.parsed} nap` },
      },
    },
  };
}
