import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import {
  CATEGORIES,
  MarketItem,
  MarketService,
  categoryLabel,
  personName,
} from '../../services/market';
import { NotificationsService } from '../../notifications/notifications.service';
import { TabOption, TabStrip } from '../../components/tab-strip/tab-strip';
import { PeriodOption, PeriodPicker } from '../../components/period-picker/period-picker';
import { errorMessage } from '../../shared/errors';
import { MarketCard } from './market-card/market-card';
import { MarketItemDialog } from './market-item/market-item';
import { MarketForm } from './market-form/market-form';

// The tabs, each a filter on the items (after the search).
type MarketFilter = 'all' | 'free' | 'dibs' | 'mine' | 'gone';
const FILTERS: { value: MarketFilter; label: string; test: (i: MarketItem) => boolean }[] = [
  { value: 'all', label: 'Mind', test: (i) => i.status !== 'gone' },
  {
    value: 'free',
    label: 'Ingyenes',
    test: (i) => i.status !== 'gone' && (i.price.kind === 'ingyen' || i.price.kind === 'joszo'),
  },
  { value: 'dibs', label: 'Lestipistopiztam', test: (i) => i.iReserved },
  { value: 'mine', label: 'Az én kacataim', test: (i) => i.mine },
  { value: 'gone', label: 'Elvitték', test: (i) => i.status === 'gone' },
];

// "lekvar" finds "Lekvár": lower case, no accents.
function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const searchText = (i: MarketItem) =>
  plain(`${i.title} ${i.description} ${categoryLabel(i.category)} ${personName(i.owner)}`);

// Ócskapiac: what we don't need any more - left-over screws, outgrown kids'
// clothes, home-made jam - free, for a few beers, or for cheap money.
// Anyone logged in may put something up (Új kacat), press Kérem! or
// Stipistopi! (7 days' hold) and leave a one-liner. An item opens over the
// page (market-item); its address keeps it (?kacat=), so a push
// notification leads straight to it. The tab is kept as ?szuro=, the
// category (the picker beside the search, as on Voks) as ?kategoria=.
@Component({
  selector: 'app-ocskapiac',
  imports: [MatIconModule, TabStrip, PeriodPicker, MarketCard, MarketItemDialog, MarketForm],
  templateUrl: './ocskapiac.html',
  styleUrl: './ocskapiac.scss',
})
export class Ocskapiac implements OnInit {
  private market = inject(MarketService);
  private notifications = inject(NotificationsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  loading = signal(true);
  items = signal<MarketItem[]>([]);
  search = signal('');
  filter = signal<MarketFilter>(
    FILTERS.find((f) => f.value === this.route.snapshot.queryParamMap.get('szuro'))?.value ?? 'all',
  );
  // 'all' or one of CATEGORIES.
  category = signal<string>(
    CATEGORIES.find((c) => c.value === this.route.snapshot.queryParamMap.get('kategoria'))?.value ??
      'all',
  );
  readonly categoryOptions: PeriodOption[] = [
    { value: 'all', label: 'Minden kategória' },
    ...CATEGORIES,
  ];
  openId = signal<string | null>(null);
  // The form: 'new', an item being edited, or null (closed).
  form = signal<'new' | MarketItem | null>(null);

  private matching = computed(() => {
    const words = plain(this.search().trim()).split(/\s+/).filter(Boolean);
    const category = this.category();
    return this.items().filter((i) => {
      if (category !== 'all' && i.category !== category) return false;
      const text = searchText(i);
      return words.every((w) => text.includes(w));
    });
  });

  tabOptions = computed<TabOption[]>(() =>
    FILTERS.map((f) => ({
      value: f.value,
      label: f.label,
      count: this.matching().filter(f.test).length,
    })),
  );

  shown = computed(() => {
    const test = FILTERS.find((f) => f.value === this.filter())!.test;
    return this.matching().filter(test);
  });

  openItem = computed(() => this.items().find((i) => i._id === this.openId()) ?? null);
  editing = computed(() => {
    const f = this.form();
    return f && f !== 'new' ? f : null;
  });

  ngOnInit() {
    this.route.queryParamMap.subscribe((q) => this.openId.set(q.get('kacat')));
    this.market.getItems().subscribe({
      next: (items) => {
        this.items.set(items);
        this.loading.set(false);
        this.fetchOpenIfMissing();
      },
      error: (err) => {
        this.loading.set(false);
        this.notifications.addError(errorMessage(err, 'Nem sikerült betölteni az Ócskapiacot.'));
      },
    });
  }

  // A link to an item that has dropped off the list (gone long ago, or
  // deleted): fetched by itself, or the link is let go.
  private fetchOpenIfMissing() {
    const id = this.openId();
    if (!id || this.openItem()) return;
    this.market.getItem(id).subscribe({
      next: (item) => this.upsert(item),
      error: () => {
        this.notifications.addError('Ez a kacat már nincs meg.');
        this.open(null);
      },
    });
  }

  setFilter(value: string) {
    this.filter.set(value as MarketFilter);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { szuro: value === 'all' ? null : value },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  setCategory(value: string) {
    this.category.set(value);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { kategoria: value === 'all' ? null : value },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // Opened by a tap here (not by a link from outside): closing is Back, so
  // the phone's own Back button closes it the same way.
  private openedHere = false;

  open(id: string | null) {
    this.openedHere = !!id;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { kacat: id },
      queryParamsHandling: 'merge',
      replaceUrl: !id,
    });
  }

  close() {
    if (this.openedHere) {
      this.openedHere = false;
      history.back();
    } else this.open(null);
  }

  upsert(item: MarketItem) {
    this.items.update((list) =>
      list.some((i) => i._id === item._id)
        ? list.map((i) => (i._id === item._id ? item : i))
        : [item, ...list],
    );
  }

  removed(id: string) {
    this.items.update((list) => list.filter((i) => i._id !== id));
    this.notifications.addSuccess('Törölve.');
    this.close();
  }

  saved(item: MarketItem) {
    const isNew = this.form() === 'new';
    this.upsert(item);
    this.form.set(null);
    if (isNew) this.open(item._id);
  }

  clearFilters() {
    this.search.set('');
    this.setCategory('all');
    this.setFilter('all');
  }
}
