import {
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  ScatterController,
  Tooltip,
} from 'chart.js';
import { provideCharts } from 'ng2-charts';

// Chart.js for the app's charts (through ng2-charts' baseChart directive).
// A component with a chart lists this in its own `providers` - not in
// app.config.ts, so Chart.js only loads with the charts themselves (keep
// such a component behind @defer on an eagerly loaded page). Only the
// pieces listed here are bundled: a new kind of chart (bar, doughnut, a
// category axis, the built-in legend...) has to add its own to the list.
export const chartProviders = provideCharts({
  registerables: [
    LineController,
    ScatterController,
    LineElement,
    PointElement,
    LinearScale,
    Tooltip,
  ],
});

// A canvas can't take var(--logo-blue) - this is the color behind it.
export function cssColor(variable: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

// The page's own font, for the texts drawn on the canvas.
export function pageFont(): string {
  return getComputedStyle(document.body).fontFamily;
}

// Their system asks for less motion: the chart just appears.
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
