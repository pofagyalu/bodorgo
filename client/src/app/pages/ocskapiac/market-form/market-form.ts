import {
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import {
  CATEGORIES,
  MAX_PHOTOS,
  MarketCategory,
  MarketItem,
  MarketPriceKind,
  MarketService,
  PRICE_KINDS,
  hasAmount,
} from '../../../services/market';
import { NotificationsService } from '../../../notifications/notifications.service';
import { shrinkImage } from '../../../shared/image-resize';
import { errorMessage } from '../../../shared/errors';

// A photo in the form: one already on the item (kept unless taken off), or
// a new one - shrunk on the phone before it's sent (the server makes it
// WebP).
type PhotoSlot =
  { kind: 'kept'; id: string; url: string } | { kind: 'new'; blob: Blob; url: string };

// "Új kacat" / editing one - over the page. Title, a few words, category,
// the price (free, a kind word, beers, chocolates... or forints) and 1-3
// photos.
@Component({
  selector: 'app-market-form',
  imports: [MatIconModule],
  templateUrl: './market-form.html',
  styleUrl: './market-form.scss',
})
export class MarketForm implements OnInit, OnDestroy {
  private market = inject(MarketService);
  private notifications = inject(NotificationsService);

  // null: a new one.
  item = input<MarketItem | null>(null);
  saved = output<MarketItem>();
  closed = output<void>();

  readonly categories = CATEGORIES;
  readonly priceKinds = PRICE_KINDS;
  readonly maxPhotos = MAX_PHOTOS;

  title = signal('');
  description = signal('');
  category = signal<MarketCategory>('egyeb');
  priceKind = signal<MarketPriceKind>('ingyen');
  amount = signal<number | null>(null);
  photos = signal<PhotoSlot[]>([]);
  shrinking = signal(false);
  saving = signal(false);

  needsAmount = computed(() => hasAmount(this.priceKind()));
  unit = computed(() => PRICE_KINDS.find((k) => k.value === this.priceKind())?.unit ?? '');
  amountMax = computed(() => (this.priceKind() === 'forint' ? 1_000_000 : 99));
  canSave = computed(
    () =>
      !this.saving() &&
      !this.shrinking() &&
      !!this.title().trim() &&
      this.photos().length > 0 &&
      (!this.needsAmount() || this.amountValid()),
  );

  private amountValid() {
    const a = this.amount();
    return a != null && Number.isInteger(a) && a >= 1 && a <= this.amountMax();
  }

  ngOnInit() {
    const item = this.item();
    if (!item) return;
    this.title.set(item.title);
    this.description.set(item.description);
    this.category.set(item.category);
    this.priceKind.set(item.price.kind);
    this.amount.set(item.price.amount);
    this.photos.set(
      item.photos.map((p) => ({
        kind: 'kept',
        id: p._id,
        url: this.market.thumbUrl(item._id, p._id),
      })),
    );
  }

  ngOnDestroy() {
    for (const p of this.photos()) if (p.kind === 'new') URL.revokeObjectURL(p.url);
  }

  @HostListener('document:keydown.escape')
  cancel() {
    if (!this.saving()) this.closed.emit();
  }

  setPriceKind(kind: MarketPriceKind) {
    this.priceKind.set(kind);
    if (hasAmount(kind) && this.amount() == null) this.amount.set(kind === 'forint' ? 500 : 1);
  }

  setAmount(value: string) {
    this.amount.set(value === '' ? null : Number(value));
  }

  async addPhotos(input: HTMLInputElement) {
    const room = MAX_PHOTOS - this.photos().length;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    if (files.length > room) {
      this.notifications.addError(`Legfeljebb ${MAX_PHOTOS} fotó lehet – a többi kimaradt.`);
    }
    this.shrinking.set(true);
    try {
      for (const file of files.slice(0, room)) {
        const blob = await shrinkImage(file);
        this.photos.update((list) => [
          ...list,
          { kind: 'new', blob, url: URL.createObjectURL(blob) },
        ]);
      }
    } catch (err) {
      this.notifications.addError(errorMessage(err, 'Ezt a képet nem sikerült beolvasni.'));
    } finally {
      this.shrinking.set(false);
    }
  }

  removePhoto(slot: PhotoSlot) {
    if (slot.kind === 'new') URL.revokeObjectURL(slot.url);
    this.photos.update((list) => list.filter((p) => p !== slot));
  }

  submit(event: Event) {
    event.preventDefault();
    if (!this.canSave()) return;
    const item = this.item();
    const slots = this.photos();
    const form = {
      title: this.title().trim(),
      description: this.description().trim(),
      category: this.category(),
      price: { kind: this.priceKind(), amount: this.needsAmount() ? this.amount() : null },
      newPhotos: slots.flatMap((p) => (p.kind === 'new' ? [p.blob] : [])),
      removePhotos: item
        ? item.photos
            .map((p) => p._id)
            .filter((id) => !slots.some((s) => s.kind === 'kept' && s.id === id))
        : [],
    };
    this.saving.set(true);
    (item ? this.market.update(item._id, form) : this.market.create(form)).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.notifications.addSuccess(
          item ? 'Elmentve.' : 'Kitéve a placcra! Reméljük, hamar gazdára talál. 🎉',
        );
        this.saved.emit(saved);
      },
      error: (err) => {
        this.saving.set(false);
        this.notifications.addError(errorMessage(err, 'Nem sikerült elmenteni.'));
      },
    });
  }
}
