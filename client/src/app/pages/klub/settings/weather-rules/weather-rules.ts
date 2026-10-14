import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { SettingsService, WeatherOutlookRules } from '../../../../services/settings';
import { OutlookPackIcon, WeatherCondition } from '../../../../services/tour';

const MONTHS = [
  'január',
  'február',
  'március',
  'április',
  'május',
  'június',
  'július',
  'augusztus',
  'szeptember',
  'október',
  'november',
  'december',
];

// 0.6 -> 60
const percent = (share: number) => Math.round(share * 100);

// Klub → Beállítások → Bódorgó jóléti index (a tab of its own): how a
// tour's "Életviteli tanácsok" (the
// weather outlook) comes about - when there is a forecast, how the
// Jóléti-index is worked out, what decides the packing list. Only the
// sentences are written here: every number is the server's own, read from
// its settings (GET /settings/weather-outlook), so a retuned formula shows
// here by itself.
@Component({
  selector: 'app-weather-rules',
  templateUrl: './weather-rules.html',
  styleUrl: './weather-rules.scss',
})
export class WeatherRules implements OnInit {
  private settingsService = inject(SettingsService);

  rules = signal<WeatherOutlookRules | null>(null);

  ngOnInit() {
    this.settingsService.getWeatherOutlookRules().subscribe({
      next: (res) => this.rules.set(res.data),
      error: () => {},
    });
  }

  // The kinds of day, best first, each with its points.
  conditions = computed(() => {
    const rules = this.rules();
    if (!rules) return [];
    const scores = rules.settings.conditionScore;
    return (Object.keys(scores) as WeatherCondition[])
      .map((condition) => ({
        name: rules.conditionNames[condition],
        score: scores[condition],
        wet: rules.settings.wetConditions.includes(condition),
      }))
      .sort((a, b) => b.score - a.score);
  });

  // The comfortable daytime temperature, month by month.
  months = computed(() =>
    (this.rules()?.settings.comfortByMonth ?? []).map(([low, high], i) => ({
      name: MONTHS[i],
      low,
      high,
    })),
  );

  // The shares of the two sums, as percentages.
  shares = computed(() => {
    const weights = this.rules()?.settings.weights;
    if (!weights) return null;
    return {
      condition: percent(weights.condition),
      temperature: percent(weights.temperature),
      average: percent(weights.average),
      worstDay: percent(weights.worstDay),
    };
  });

  // Mit pakoljunk?: each thing, and what puts it on the list.
  packing = computed(() => {
    const rules = this.rules();
    if (!rules) return [];
    const p = rules.settings.packing;
    const when: Record<OutlookPackIcon, string> = {
      tshirt: `a legmelegebb nap legalább ${p.tshirtFromMaxC} °C`,
      sweater: `a leghidegebb éjszaka ${p.sweaterBelowMinC} °C alatt van`,
      jacket: `a leghidegebb éjszaka ${p.jacketBelowMinC} °C alatt van`,
      beanie: `a leghidegebb éjszaka ${p.beanieFromMinC} °C vagy annál hidegebb`,
      umbrella: `van csapadékos nap, vagy az eső esélye valamelyik napon legalább ${rules.settings.wetRainChance}%`,
      wind: `a legszelesebb napon a szél legalább ${p.windFromKmh} km/h`,
      sun: `van legalább ${p.sunnyDayFromMaxC} °C-os napsütéses nap, és a legmelegebb nap legalább ${p.sunFromMaxC} °C`,
      layers: `valamelyik napon éjjel és nappal között legalább ${p.layersFromSpreadC} fok a különbség`,
    };
    return (Object.keys(when) as OutlookPackIcon[]).map((icon) => ({
      name: rules.packNames[icon],
      when: when[icon],
    }));
  });
}
