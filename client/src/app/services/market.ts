import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { PushService } from './push';

// Ócskapiac - what we give away (server controllers/marketController.js).

export type MarketCategory = 'barkacs' | 'gyerek' | 'haztartas' | 'kezmuves' | 'egyeb';
export type MarketPriceKind =
  'ingyen' | 'joszo' | 'sor' | 'csoki' | 'palinka' | 'kave' | 'lekvar' | 'forint';

export interface MarketPrice {
  kind: MarketPriceKind;
  amount: number | null; // null for ingyen and joszo
}

export interface MarketPerson {
  _id: string;
  name: string;
  username: string;
  photoUpdatedAt?: string | null;
}

export interface MarketItem {
  _id: string;
  title: string;
  description: string;
  category: MarketCategory;
  price: MarketPrice;
  owner: MarketPerson;
  photos: { _id: string; width: number; height: number }[];
  // reserved: someone's stipistopi holds it until reservedUntil (7 days);
  // gone: Odaadtam - no photos any more.
  status: 'available' | 'reserved' | 'gone';
  reservedBy: MarketPerson | null;
  reservedUntil: string | null;
  wanted: { user: MarketPerson; at: string }[];
  notes: { _id: string; user: MarketPerson; text: string; createdAt: string }[];
  mine: boolean;
  iWant: boolean;
  iReserved: boolean;
  createdAt: string;
  goneAt: string | null;
}

// What the item form sends - photos already shrunk (shared/image-resize).
export interface MarketItemForm {
  title: string;
  description: string;
  category: MarketCategory;
  price: MarketPrice;
  newPhotos: Blob[];
  removePhotos: string[]; // editing: the photos taken off
}

export const MAX_PHOTOS = 3;
export const MAX_NOTE_LENGTH = 100;
export const HOLD_DAYS = 7;

export const CATEGORIES: { value: MarketCategory; label: string }[] = [
  { value: 'barkacs', label: '🔧 Barkács' },
  { value: 'gyerek', label: '🧸 Gyerekholmi' },
  { value: 'haztartas', label: '🍳 Háztartás' },
  { value: 'kezmuves', label: '🎨 Kézműves, házi' },
  { value: 'egyeb', label: '📦 Egyéb' },
];

// unit: after the amount ("2 sör"); none for the two without an amount.
export const PRICE_KINDS: {
  value: MarketPriceKind;
  emoji: string;
  label: string;
  unit?: string;
}[] = [
  { value: 'ingyen', emoji: '🎁', label: 'Ingyen elvihető' },
  { value: 'joszo', emoji: '😊', label: 'Egy jó szó is elég' },
  { value: 'sor', emoji: '🍺', label: 'Sörért', unit: 'sör' },
  { value: 'csoki', emoji: '🍫', label: 'Csokiért', unit: 'csoki' },
  { value: 'palinka', emoji: '🥃', label: 'Pálinkáért', unit: 'pálinka' },
  { value: 'kave', emoji: '☕', label: 'Kávéért', unit: 'kávé' },
  { value: 'lekvar', emoji: '🫙', label: 'Lekvárért', unit: 'üveg lekvár' },
  { value: 'forint', emoji: '💰', label: 'Forintért', unit: 'Ft' },
];

export const hasAmount = (kind: MarketPriceKind) => kind !== 'ingyen' && kind !== 'joszo';

// "🍺 2 sör", "🎁 Ingyen elvihető", "💰 1 500 Ft".
export function priceLabel(price: MarketPrice): string {
  const kind = PRICE_KINDS.find((k) => k.value === price.kind) ?? PRICE_KINDS[0];
  if (!kind.unit || price.amount == null) return `${kind.emoji} ${kind.label}`;
  return `${kind.emoji} ${price.amount.toLocaleString('hu-HU')} ${kind.unit}`;
}

export const categoryLabel = (c: MarketCategory) =>
  CATEGORIES.find((x) => x.value === c)?.label ?? '📦 Egyéb';

export const personName = (p: MarketPerson | null | undefined) => p?.username || p?.name || '';

type ItemResponse = { data: { item: MarketItem } };

@Injectable({ providedIn: 'root' })
export class MarketService {
  private http = inject(HttpClient);
  private push = inject(PushService);
  private apiUrl = `${environment.apiBaseUrl}/ocskapiac`;

  // What others put up since I last opened the Ócskapiac - the menu's
  // badge. Refreshed with the other badges (see header.ts).
  readonly newCount = signal(0);

  refreshNew() {
    this.http.get<{ data: { count: number } }>(`${this.apiUrl}/new-count`).subscribe({
      next: (res) => this.newCount.set(res.data.count),
      error: () => {},
    });
  }

  // Opening the list is seeing what's new (the server notes it): the
  // badge goes, and so do the "Új kacat" notifications on the phone.
  getItems(): Observable<MarketItem[]> {
    return this.http.get<{ data: { items: MarketItem[] } }>(this.apiUrl).pipe(
      map((res) => res.data.items),
      tap(() => {
        this.newCount.set(0);
        void this.push.closeNotifications((tag) => tag === 'ocskapiac-uj');
      }),
    );
  }

  getItem(id: string): Observable<MarketItem> {
    return this.http.get<ItemResponse>(`${this.apiUrl}/${id}`).pipe(map((res) => res.data.item));
  }

  private formData(form: MarketItemForm): FormData {
    const data = new FormData();
    data.append('title', form.title);
    data.append('description', form.description);
    data.append('category', form.category);
    data.append('priceKind', form.price.kind);
    data.append('priceAmount', form.price.amount == null ? '' : String(form.price.amount));
    form.newPhotos.forEach((blob, i) => data.append('photos', blob, `foto-${i + 1}.jpg`));
    form.removePhotos.forEach((id) => data.append('removePhotos', id));
    return data;
  }

  create(form: MarketItemForm): Observable<MarketItem> {
    return this.http
      .post<ItemResponse>(this.apiUrl, this.formData(form))
      .pipe(map((res) => res.data.item));
  }

  update(id: string, form: MarketItemForm): Observable<MarketItem> {
    return this.http
      .patch<ItemResponse>(`${this.apiUrl}/${id}`, this.formData(form))
      .pipe(map((res) => res.data.item));
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  private act(id: string, what: string, method: 'post' | 'delete', body?: object) {
    const url = `${this.apiUrl}/${id}/${what}`;
    const req =
      method === 'post'
        ? this.http.post<ItemResponse>(url, body ?? {})
        : this.http.delete<ItemResponse>(url);
    return req.pipe(map((res) => res.data.item));
  }

  markGone = (id: string) => this.act(id, 'gone', 'post');
  want = (id: string) => this.act(id, 'want', 'post');
  unwant = (id: string) => this.act(id, 'want', 'delete');
  dibs = (id: string) => this.act(id, 'dibs', 'post');
  undibs = (id: string) => this.act(id, 'dibs', 'delete');
  addNote = (id: string, text: string) => this.act(id, 'notes', 'post', { text });
  deleteNote = (id: string, noteId: string) => this.act(id, `notes/${noteId}`, 'delete');

  photoUrl(itemId: string, photoId: string): string {
    return `${this.apiUrl}/${itemId}/photos/${photoId}`;
  }

  thumbUrl(itemId: string, photoId: string): string {
    return `${this.photoUrl(itemId, photoId)}/thumb`;
  }
}
