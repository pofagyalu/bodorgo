import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TourService, Tour } from '../../services/tour';
import { environment } from '../../../environments/environment';
import { MatIconModule } from '@angular/material/icon';
import { NgOptimizedImage } from '@angular/common';

@Component({
  selector: 'app-tours',
  standalone: true,
  imports: [CommonModule, MatIconModule, NgOptimizedImage],
  templateUrl: './tours.html',
  styleUrl: './tours.scss',
})
export class Tours implements OnInit {
  private tourService = inject(TourService);
  environment = environment;

  tours = signal<Tour[]>([]);
  showingAll = signal(false);

  searchInput = signal(''); // instant changes
  searchTerm = signal(''); // debounced version
  private debounceTimer: any = null;
  duration = signal('');
  year = signal('');
  sort = signal('');

  ngOnInit() {
    this.loadLast3(); // <-- Load only last 3 tours initially
  }

  /** Load last 3 tours */
  loadLast3() {
    this.showingAll.set(false);

    this.tourService.getLast3Tours().subscribe({
      next: (res) => this.tours.set(res.data.tours),
      error: (err) => console.error(err),
    });
  }

  loadAllTours() {
    this.showingAll.set(true);

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
