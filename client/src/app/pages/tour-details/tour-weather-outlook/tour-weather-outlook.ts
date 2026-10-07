import { Component, computed, input } from '@angular/core';
import { OutlookPackIcon, OutlookTier, Tour } from '../../../services/tour';

const ASSETS = 'assets/images/weather-outlook';

// The score bar's five stretches, worst first - each as wide as its mood's
// share of the 0-100 scale (server utils/weatherOutlookSettings.js's tiers).
const METER: { tier: OutlookTier; width: number }[] = [
  { tier: 'rough', width: 30 },
  { tier: 'gloomy', width: 20 },
  { tier: 'mixed', width: 20 },
  { tier: 'great', width: 15 },
  { tier: 'perfect', width: 15 },
];

// A tour's "Hogy készüljünk az időjárásra?" (tour-details, above the Programterv): the
// mood of the whole tour's weather as a little scene, a headline not to be
// taken too seriously, and what to pack. Everything shown comes ready from
// the server (tour.weatherOutlook) - it exists only once every day of the
// tour has a forecast, and until then this renders nothing at all. From
// the start date it is frozen: what was promised, kept for good.
@Component({
  selector: 'app-tour-weather-outlook',
  templateUrl: './tour-weather-outlook.html',
  styleUrl: './tour-weather-outlook.scss',
})
export class TourWeatherOutlook {
  tour = input.required<Tour>();

  readonly meter = METER;

  outlook = computed(() => this.tour().weatherOutlook ?? null);
  roundedScore = computed(() => Math.round(this.outlook()?.score ?? 0));

  scenePath(tier: OutlookTier): string {
    return `${ASSETS}/scenes/scene-${tier}.svg`;
  }

  badgePath(tier: OutlookTier): string {
    return `${ASSETS}/badges/badge-${tier}.svg`;
  }

  // The packing icons are line drawings in the text's colour - used as a
  // mask, so the stylesheet decides that colour.
  packIconMask(icon: OutlookPackIcon): string {
    return `url(${ASSETS}/icons/${icon}.svg)`;
  }
}
