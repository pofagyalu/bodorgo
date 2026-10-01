import { Component, computed, input } from '@angular/core';
import {
  ChartData,
  ChartOptions,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  ScatterController,
  Tooltip,
  TooltipItem,
} from 'chart.js';
import { BaseChartDirective, provideCharts } from 'ng2-charts';
import { AgeFigures, AttendeeAges } from '../../services/tour';
import { cssColor, pageFont, prefersReducedMotion } from '../../shared/charts';

// A point of either dataset: a tour's dot or a year of the line. `title`
// and `figures` are what its tooltip says.
interface AgePoint {
  x: number;
  y: number;
  title: string;
  figures: AgeFigures;
  // A year only: how many tours its average is over.
  tourCount?: number;
}

// Where a tour's dot sits beside its year (in years, on the x axis): at
// least YEAR_GAP off, clear of the year's own dot on the line, at most
// MAX_SPREAD, and neighbors on the same side no more than DOT_STEP apart.
const YEAR_GAP = 0.15;
const MAX_SPREAD = 0.42;
const DOT_STEP = 0.12;

const oneDecimal = new Intl.NumberFormat('hu-HU', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

// The homepage's age chart: the attendees' average age over the years -
// a line for the yearly average, a dot for each tour (see
// tourController.js's attendeeAgeStats for what the numbers are).
@Component({
  selector: 'app-age-chart',
  standalone: true,
  imports: [BaseChartDirective],
  // Just the Chart.js pieces this chart is made of (see shared/charts.ts).
  providers: [
    provideCharts({
      registerables: [
        LineController,
        ScatterController,
        LineElement,
        PointElement,
        LinearScale,
        Tooltip,
      ],
    }),
  ],
  templateUrl: './age-chart.html',
  styleUrl: './age-chart.scss',
})
export class AgeChart {
  ages = input.required<AttendeeAges>();

  private readonly lineColor = cssColor('--logo-blue');
  private readonly dotColor = cssColor('--logo-orange');

  // Two datasets on one linear x axis (years as numbers): the line and,
  // drawn under it, the tours' dots.
  readonly data = computed<ChartData<'line' | 'scatter', AgePoint[]>>(() => ({
    datasets: [
      {
        type: 'line',
        label: 'Éves átlag',
        data: this.ages().years.map((y) => ({
          x: y.year,
          y: y.averageAge,
          title: `${y.year} – éves átlag`,
          figures: y,
          tourCount: this.ages().tours.filter((t) => t.year === y.year).length,
        })),
        order: 1,
        borderColor: this.lineColor,
        backgroundColor: this.lineColor,
        borderWidth: 2.5,
        tension: 0.3,
        // A year with no known age isn't in the data at all - the line
        // just runs on to the next one.
        spanGaps: true,
        // A dot on the line for each year's average, ringed like the
        // tours' dots.
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBorderColor: '#f7f7f7',
        pointBorderWidth: 1.5,
        pointHoverBorderColor: '#f7f7f7',
      },
      {
        type: 'scatter',
        label: 'Egy-egy túra',
        data: this.tourDots(),
        order: 2,
        backgroundColor: this.dotColor,
        // A ring in the card's own color, so dots on top of each other
        // (or under the line) still read as separate.
        borderColor: '#f7f7f7',
        borderWidth: 1.5,
        pointRadius: 5,
        pointHoverRadius: 7,
        hoverBorderColor: '#f7f7f7',
      },
    ],
  }));

  readonly options = computed<ChartOptions<'line' | 'scatter'>>(() => {
    const years = this.ages().years.map((y) => y.year);
    const font = { family: pageFont(), size: 12 };
    return {
      responsive: true,
      maintainAspectRatio: false,
      // Every point starts on the bottom of the chart (Chart.js's own
      // starting point for a first draw) and rises to its place.
      animation: prefersReducedMotion() ? false : { duration: 1600, easing: 'easeOutQuart' },
      // The nearest point answers, wherever the pointer (or finger) is.
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: {
          type: 'linear',
          min: Math.min(...years) - 0.5,
          max: Math.max(...years) + 0.5,
          grid: { display: false },
          border: { color: '#ddd' },
          // A label under each whole year only - the axis itself starts
          // and ends half a year off, where Chart.js would put its ticks.
          afterBuildTicks: (axis) => {
            axis.ticks = [];
            for (let year = Math.min(...years); year <= Math.max(...years); year++) {
              axis.ticks.push({ value: year });
            }
          },
          ticks: {
            color: '#777',
            font,
            // Plain years - not "2 019".
            callback: (value) => String(value),
          },
        },
        y: {
          // A line at every 5 years from 15 to 35 (further only if an
          // average ever falls outside).
          suggestedMin: 15,
          suggestedMax: 35,
          grid: { color: '#e6e6e6' },
          border: { display: false },
          ticks: { stepSize: 5, color: '#777', font, callback: (value) => `${value} év` },
        },
      },
      plugins: {
        tooltip: {
          displayColors: false,
          padding: 10,
          titleFont: { ...font, weight: 'bold' },
          bodyFont: font,
          callbacks: {
            title: (items) => point(items[0]).title,
            // "10/14 fő": the ones with a known age, of everyone there -
            // a year adds its tours, "(18/20 fő alapján, 2 tábor)", and
            // a second line with its youngest and oldest.
            label: (item) => {
              const { figures: f, tourCount } = point(item);
              const tours = tourCount ? `, ${tourCount} tábor` : '';
              const average = `Átlag: ${oneDecimal.format(f.averageAge)} év (${f.count}/${f.total} fő alapján${tours})`;
              return tourCount ? [average, `Tartomány: ${f.minAge}–${f.maxAge} év`] : average;
            },
          },
        },
      },
    };
  });

  // The tours of a year sit on its two sides, in time order, so they
  // cover neither each other nor the year's dot.
  private tourDots(): AgePoint[] {
    const tours = this.ages().tours;
    return tours.map((tour, i) => {
      const sameYear = tours.filter((t) => t.year === tour.year).length;
      const place = tours.slice(0, i).filter((t) => t.year === tour.year).length;
      // The first half goes left of the year, the rest right (a lone tour
      // left) - each side counted outwards from the year's own dot.
      const onLeft = Math.ceil(sameYear / 2);
      const stepsOut = place < onLeft ? onLeft - 1 - place : place - onLeft;
      const step = Math.min(DOT_STEP, (MAX_SPREAD - YEAR_GAP) / Math.max(1, onLeft - 1));
      const offset = YEAR_GAP + stepsOut * step;
      return {
        x: tour.year + (place < onLeft ? -offset : offset),
        y: tour.averageAge,
        title: `${tour.title} (${tour.year})`,
        figures: tour,
      };
    });
  }
}

function point(item: TooltipItem<'line' | 'scatter'>): AgePoint {
  return item.raw as AgePoint;
}
