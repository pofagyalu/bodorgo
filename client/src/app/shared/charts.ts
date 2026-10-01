// Chart.js for the app's charts (through ng2-charts' baseChart directive).
// A component with a chart gives provideCharts() in its own `providers`,
// listing just the Chart.js pieces that chart needs (its controller,
// elements, scales, the tooltip) - not in app.config.ts and not one shared
// list, so Chart.js only loads with the charts themselves and each chart
// brings only its own pieces (keep such a component behind @defer on an
// eagerly loaded page). See components/age-chart and
// components/waterfall-chart. What they share is below.

// A canvas can't take var(--logo-blue) - this is the color behind it.
export function cssColor(variable: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

// The page's own font, for the texts drawn on the canvas - or that of an
// element whose page sets its own.
export function pageFont(element: Element = document.body): string {
  return getComputedStyle(element).fontFamily;
}

// Their system asks for less motion: the chart just appears.
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
