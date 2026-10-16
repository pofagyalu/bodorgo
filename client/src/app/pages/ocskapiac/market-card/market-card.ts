import { Component, computed, inject, input } from '@angular/core';
import {
  MarketItem,
  MarketService,
  categoryLabel,
  personName,
  priceLabel,
} from '../../../services/market';

const DAY_MS = 24 * 60 * 60 * 1000;

// How many days a stipistopi still holds - "még 3 napig".
export function daysLeft(until: string | null, now = Date.now()): number {
  if (!until) return 0;
  return Math.max(1, Math.ceil((new Date(until).getTime() - now) / DAY_MS));
}

// One thing on the Ócskapiac grid: its first photo, the price, and a
// rubber stamp when someone's stipistopi holds it or it's gone. A tap opens
// it (the page's market-item dialog).
@Component({
  selector: 'app-market-card',
  templateUrl: './market-card.html',
  styleUrl: './market-card.scss',
})
export class MarketCard {
  private market = inject(MarketService);

  item = input.required<MarketItem>();

  price = computed(() => priceLabel(this.item().price));
  category = computed(() => categoryLabel(this.item().category));
  owner = computed(() => personName(this.item().owner));
  holder = computed(() => personName(this.item().reservedBy));
  days = computed(() => daysLeft(this.item().reservedUntil));

  thumb = computed(() => {
    const item = this.item();
    const first = item.photos[0];
    return first ? this.market.thumbUrl(item._id, first._id) : null;
  });
}
