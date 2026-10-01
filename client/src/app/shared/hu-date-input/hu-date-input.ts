import { Component, computed, effect, input, model, signal } from '@angular/core';

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

const pad = (n: number) => String(n).padStart(2, '0');

// A date as year, month, day - in that (Hungarian) order, with the months'
// Hungarian names - whatever language the browser or the computer is set
// to. (A plain <input type="date"> shows the date the browser's way: on an
// English one, month/day/year.) The value is "YYYY-MM-DD", or '' until all
// three are chosen.
@Component({
  selector: 'app-hu-date-input',
  templateUrl: './hu-date-input.html',
  styleUrl: './hu-date-input.scss',
})
export class HuDateInput {
  value = model('');
  // The earliest and the latest day that can be chosen ("YYYY-MM-DD").
  min = input('1900-01-01');
  max = input('2100-12-31');
  // What the three are called together, for a screen reader.
  label = input('Dátum');

  readonly months = MONTHS;

  // What the three selects say (0 = not chosen) - ahead of `value` while
  // the date is only partly chosen.
  year = signal(0);
  month = signal(0);
  day = signal(0);

  // Newest first: a birthday's year is nearer to the list's start that way.
  years = computed(() => {
    const first = Number(this.min().slice(0, 4));
    const last = Number(this.max().slice(0, 4));
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => last - i);
  });

  days = computed(() => {
    const count =
      this.year() && this.month() ? new Date(this.year(), this.month(), 0).getDate() : 31;
    return Array.from({ length: count }, (_, i) => i + 1);
  });

  constructor() {
    // The value from outside (loaded, or reset) shows in the selects.
    effect(() => {
      const [y, m, d] = this.value().split('-').map(Number);
      if (y && m && d) {
        this.year.set(y);
        this.month.set(m);
        this.day.set(d);
      } else if (!this.value() && this.year() && this.month() && this.day()) {
        // Emptied from outside while a whole date was shown.
        this.year.set(0);
        this.month.set(0);
        this.day.set(0);
      }
    });
  }

  choose(part: 'year' | 'month' | 'day', chosen: string) {
    this[part].set(Number(chosen));
    // A day the month doesn't have (31 → February): its last day.
    if (this.day() > this.days().length) this.day.set(this.days().length);

    if (!this.year() || !this.month() || !this.day()) {
      this.value.set('');
      return;
    }
    const date = `${this.year()}-${pad(this.month())}-${pad(this.day())}`;
    // Kept between the two ends.
    this.value.set(date < this.min() ? this.min() : date > this.max() ? this.max() : date);
  }
}
