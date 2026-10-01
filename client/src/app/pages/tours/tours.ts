import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { TourService, Tour } from '../../services/tour';
import { TourCard } from './tour-card/tour-card';
import { AuthService } from '../../auth/auth.service';
import { PeriodBand, PeriodOption } from '../../components/period-band/period-band';

@Component({
  selector: 'app-tours',
  standalone: true,
  imports: [TourCard, RouterLink, MatIconModule, PeriodBand],
  templateUrl: './tours.html',
  styleUrl: './tours.scss',
})
export class Tours implements OnInit {
  private tourService = inject(TourService);
  auth = inject(AuthService);

  // The page opens with one year's tours - the latest year that has any -
  // so it never loads every card at once. Another year is loaded when it's
  // chosen; every tour only for "Összes" or a search (which looks through
  // all of them).
  private toursByYear = signal<Record<string, Tour[]>>({});
  private allTours = signal<Tour[] | null>(null);
  private requested = new Set<string>();

  // Every year that has a tour (its own light request), newest first -
  // a year without one isn't in the selector at all.
  years = signal<number[]>([]);
  // What the selector says: a year ("2026") or 'all'; '' until the years
  // have arrived.
  period = signal('');

  // The wheel's items: the years, newest first, then "Összes".
  periodOptions = computed<PeriodOption[]>(() => [
    ...this.years().map((y) => ({ value: String(y), label: String(y) })),
    { value: 'all', label: 'Összes' },
  ]);

  searchInput = signal(''); // instant changes
  searchTerm = signal(''); // debounced version
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // The one order there is: by date - newest first, or (true) oldest first.
  ascending = signal(false);

  ngOnInit() {
    this.tourService.getTourYears().subscribe({
      next: (res) => {
        const years = [...res.data.years].reverse();
        this.years.set(years);
        // Back on the page: what was chosen last time (see TourService) -
        // otherwise the latest year with a tour.
        const remembered = this.tourService.toursPeriod;
        const known = remembered === 'all' || years.some((y) => String(y) === remembered);
        this.choosePeriod(known ? remembered : years.length ? String(years[0]) : 'all');
      },
      error: (err) => console.error(err),
    });
  }

  choosePeriod(period: string) {
    this.period.set(period);
    this.tourService.toursPeriod = period;
    this.load(period);
  }

  // A year's tours, or ('all') every tour - each asked for once.
  private load(period: string) {
    if (this.requested.has(period)) return;
    this.requested.add(period);
    const request =
      period === 'all'
        ? this.tourService.getTours()
        : this.tourService.getToursOfYear(Number(period));
    request.subscribe({
      next: (res) => {
        if (period === 'all') this.allTours.set(res.data.tours);
        else this.toursByYear.update((byYear) => ({ ...byYear, [period]: res.data.tours }));
      },
      error: (err) => {
        console.error(err);
        this.requested.delete(period);
      },
    });
  }

  onSearch(value: string) {
    this.searchInput.set(value);

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      this.searchTerm.set(value);
      if (value.trim()) this.load('all');
    }, 300); // 300 ms debounce
  }

  // The tours to show from, or null while they're still on their way: a
  // search and "Összes" need every tour, a year only its own (taken from
  // the full list once that is here anyway).
  private source = computed<Tour[] | null>(() => {
    const period = this.period();
    const all = this.allTours();
    if (period === 'all' || this.searchTerm().trim()) return all;
    if (all) return all.filter((t) => t.startDate.startsWith(period));
    return this.toursByYear()[period] ?? null;
  });

  loadingAll = computed(() => this.source() === null);

  // What the cards are made from: the source - and while the next one (a
  // newly chosen year) is still on its way, the one before it stays, so
  // the page doesn't empty and jump in between.
  private shown = signal<Tour[] | null>(null);
  private keepShown = effect(() => {
    const source = this.source();
    if (source) this.shown.set(source);
  });

  // What's on screen, by date: the chosen year's tours or every tour -
  // or, with something searched for, the matches among ALL tours (a search
  // isn't held to the chosen year).
  filteredTours = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();
    const direction = this.ascending() ? 1 : -1;
    const source = this.shown() ?? [];

    return source
      .filter((t) => {
        if (!search) return true;
        const title = (t.title || '').toLowerCase();
        const summary = (t.summary || '').toLowerCase();
        return title.includes(search) || summary.includes(search);
      })
      .sort(
        (a, b) => direction * (new Date(a.startDate).getTime() - new Date(b.startDate).getTime()),
      );
  });
}
