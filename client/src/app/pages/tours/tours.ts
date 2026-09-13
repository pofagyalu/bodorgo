import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { TourService, Tour } from '../../services/tour';
import { TourCard } from './tour-card/tour-card';

@Component({
  selector: 'app-tours',
  standalone: true,
  imports: [TourCard],
  templateUrl: './tours.html',
  styleUrl: './tours.scss',
})
export class Tours implements OnInit {
  private tourService = inject(TourService);

  tours = signal<Tour[]>([]);
  showingAll = signal(false);

  searchInput = signal(''); // instant changes
  searchTerm = signal(''); // debounced version
  private debounceTimer: any = null;
  duration = signal('');
  year = signal('');
  sort = signal('');

  ngOnInit() {
    // Restores whatever "last 3" vs "all" choice was last made, instead of
    // always resetting to "last 3" on every visit to this page.
    if (this.tourService.showAllPreference) {
      this.loadAllTours();
    } else {
      this.loadLast3();
    }
  }

  /** Load last 3 tours */
  loadLast3() {
    this.showingAll.set(false);
    this.tourService.showAllPreference = false;

    this.tourService.getLast3Tours().subscribe({
      next: (res) => this.tours.set(res.data.tours),
      error: (err) => console.error(err),
    });
  }

  loadAllTours() {
    this.showingAll.set(true);
    this.tourService.showAllPreference = true;

    this.tourService.getTours().subscribe({
      next: (res) => this.tours.set(res.data.tours),
      error: (err) => console.error(err),
    });
  }

  onSearch(value: string) {
    this.searchInput.set(value);

    clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      this.searchTerm.set(value);
    }, 300); // 300 ms debounce
  }
  // Extract available years from tours
  availableYears = computed(() => {
    const years = this.tours().map((t) => t.startDate.substring(0, 4));
    return [...new Set(years)].sort(); // remove duplicates
  });

  // Filtering using computed
  filteredTours = computed(() => {
    let list = this.tours();

    const search = this.searchTerm().toLowerCase();
    const duration = this.duration();
    const year = this.year();
    const sort = this.sort();

    // SEARCH filter (safe)
    if (search) {
      list = list.filter((t) => {
        const title = (t.title || '').toLowerCase();
        const summary = (t.summary || '').toLowerCase();
        return title.includes(search) || summary.includes(search);
      });
    }

    // YEAR filter
    if (year) {
      list = list.filter((t) => t.startDate.startsWith(year));
    }

    // DURATION filter
    if (duration) {
      list = list.filter((t) => t.duration === Number(duration));
    }

    // --- SORTING ---
    if (sort) {
      list.sort((a, b) => {
        const field = sort.replace('-', ''); // e.g. title
        const direction = sort.startsWith('-') ? -1 : 1;

        let A = (a as any)[field];
        let B = (b as any)[field];

        // convert dates
        if (field === 'startDate') {
          A = new Date(a.startDate.split(',')[0]).getTime();
          B = new Date(b.startDate.split(',')[0]).getTime();
        }

        // convert strings to lowercase
        if (typeof A === 'string') A = A.toLowerCase();
        if (typeof B === 'string') B = B.toLowerCase();

        if (A < B) return -1 * direction;
        if (A > B) return 1 * direction;
        return 0;
      });
    }

    return list;
  });
}
