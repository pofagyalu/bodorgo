import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import type { BirthdayEffect } from '../shared/birthday/birthday.service';

// The yearly membership fee, by the year each amount takes effect (see
// server/src/utils/clubSettings.js) - set on Klub → Beállítások.
export interface MembershipFee {
  fromYear: number;
  amount: number;
}

export interface MembershipFeesResponse {
  status: string;
  data: {
    fees: MembershipFee[];
    foundingYear: number;
    // The day of the year the fee is due by: the first day of the Tagdíj
    // emlékeztető (Klub → Beállítások).
    paymentDeadline?: { month: number; day: number };
    // Admin-only: years somebody already paid for (their fee can't
    // change), and who changed the fees when.
    paidYears?: number[];
    history?: { at: string; byName: string; change: string }[];
  };
}

// The fee for one year: the latest row that has started by then - same
// rule as the server's feeForYear.
export function feeForYear(fees: MembershipFee[], year: number): number | null {
  const row = [...fees]
    .filter((f) => f.fromYear <= year)
    .sort((a, b) => b.fromYear - a.fromYear)[0];
  return row ? row.amount : null;
}

// "Tagdíj emlékeztető" (see server/src/utils/membershipReminders.js): e-mails
// to members who haven't paid this year, on a first date and then monthly
// or quarterly.
export interface MembershipReminder {
  enabled: boolean;
  startMonth: number;
  startDay: number;
  frequency: 'monthly' | 'quarterly';
  lastRoundSent: string | null; // "YYYY-MM-DD"
  dates: string[]; // this year's rounds
  nextRound: string | null; // null while it's off
}

export interface MembershipReminderResponse {
  status: string;
  data: { reminder: MembershipReminder; year: number; recipients: string[] };
}

export interface ChatImageSettings {
  quotaMB: number;
  dailyLimit: number;
  usage: { bytes: number; count: number }; // the photos still on disk
}

// Kép gyorsítótár: the smaller photo versions made for the viewer (see
// server photos/imageSizes.js).
export interface ImageCacheSettings {
  quotaMB: number;
  usage: { bytes: number; count: number };
}

// One Barion wallet (Beállítások): where its payments land, and the bank
// account withdrawals go to. (Its API key is a secret in the server's .env.)
export interface BarionWallet {
  payeeEmail: string;
  withdrawName: string;
  withdrawIban: string;
}

export type BarionWalletKey = 'membership' | 'tour';

// Fizetési módok (Beállítások): one online gateway - offered or not, and
// the fee the payer pays on top.
export type PaymentMethodKey = 'stripe' | 'barion';

export interface PaymentMethodSettings {
  enabled: boolean;
  feePercent: number; // of the charge
  feeFixed: number; // Ft per payment
  feeMin: number; // Ft, the least the fee can be
  // Which purposes it can take now (read-only, from the server) - Stripe
  // only where that purpose's own account has its key.
  wallets?: Record<PaymentWallet, boolean>;
}

// Where a payment's money goes: dues to the club, advances to the tours'.
export type PaymentWallet = 'membership' | 'tour';

export type PaymentMethods = Record<PaymentMethodKey, PaymentMethodSettings>;

export const PAYMENT_METHOD_NAMES: Record<PaymentMethodKey, string> = {
  stripe: 'Stripe',
  barion: 'Barion',
};

// Their official logos (assets/images/providers, from Stripe's and Barion's
// brand kits): Stripe's wordmark, Barion's whole "Smart Payment Banner" -
// Barion approves a live shop only with it shown unchanged at payment.
export const PAYMENT_METHOD_LOGOS: Record<PaymentMethodKey, string> = {
  stripe: 'assets/images/providers/stripe-wordmark-blurple.svg',
  barion: 'assets/images/providers/barion-smart-banner-light.svg',
};

// The fee on top of a sum - the same sum the server charges (its
// utils/clubSettings.js's paymentFee): worked out backwards, so what's left
// after the gateway's cut is the sum itself.
export function paymentFee(subtotal: number, m: PaymentMethodSettings): number {
  if (!(subtotal > 0)) return 0;
  const charge = Math.round((subtotal + m.feeFixed) / (1 - m.feePercent / 100));
  return Math.max(charge - subtotal, m.feeMin);
}

// Születésnap: the birthday greeting (see shared/birthday).
export interface BirthdaySettings {
  enabled: boolean;
  effect: BirthdayEffect;
  message: string; // {név} = the given name
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/settings`;

  getMembershipFees() {
    return this.http.get<MembershipFeesResponse>(`${this.apiUrl}/membership-fees`);
  }

  // Admin-only - replaces the whole table.
  updateMembershipFees(fees: MembershipFee[]) {
    return this.http.put<{ status: string; data: { fees: MembershipFee[] } }>(
      `${this.apiUrl}/membership-fees`,
      {
        fees,
      },
    );
  }

  // --- Tagdíj emlékeztető (admin-only) ---

  getMembershipReminder() {
    return this.http.get<MembershipReminderResponse>(`${this.apiUrl}/membership-reminder`);
  }

  updateMembershipReminder(settings: {
    enabled: boolean;
    startMonth: number;
    startDay: number;
    frequency: 'monthly' | 'quarterly';
  }) {
    return this.http.put<{ status: string; data: { reminder: MembershipReminder } }>(
      `${this.apiUrl}/membership-reminder`,
      settings,
    );
  }

  // --- Chat fotók (admin-only): the folder's size limit and the daily
  // number per person (see server chat/chatImages.js) ---

  getChatImageSettings() {
    return this.http.get<{ data: ChatImageSettings }>(`${this.apiUrl}/chat-images`);
  }

  updateChatImageSettings(settings: { quotaMB: number; dailyLimit: number }) {
    return this.http.put<{ data: ChatImageSettings & { removed: number } }>(
      `${this.apiUrl}/chat-images`,
      settings,
    );
  }

  // --- Kép gyorsítótár (admin-only): its quota, and emptying it ---

  getImageCacheSettings() {
    return this.http.get<{ data: ImageCacheSettings }>(`${this.apiUrl}/image-cache`);
  }

  updateImageCacheSettings(quotaMB: number) {
    return this.http.put<{ data: ImageCacheSettings & { removed: number } }>(
      `${this.apiUrl}/image-cache`,
      { quotaMB },
    );
  }

  clearImageCache() {
    return this.http.delete<{ data: ImageCacheSettings & { removed: number } }>(
      `${this.apiUrl}/image-cache`,
    );
  }

  // --- Barion wallets (admin-only) ---

  getBarionSettings() {
    return this.http.get<{ data: Record<BarionWalletKey, BarionWallet> }>(`${this.apiUrl}/barion`);
  }

  updateBarionWallet(key: BarionWalletKey, wallet: BarionWallet) {
    return this.http.put<{ data: BarionWallet }>(`${this.apiUrl}/barion/${key}`, wallet);
  }

  // --- Fizetési módok: anyone logged in reads them, admins set them ---

  getPaymentMethods() {
    return this.http.get<{ data: PaymentMethods }>(`${this.apiUrl}/payment-methods`);
  }

  updatePaymentMethod(key: PaymentMethodKey, settings: PaymentMethodSettings) {
    return this.http.put<{ data: PaymentMethodSettings }>(
      `${this.apiUrl}/payment-methods/${key}`,
      settings,
    );
  }

  // --- Születésnap (admin-only) ---

  getBirthdaySettings() {
    return this.http.get<{ data: BirthdaySettings }>(`${this.apiUrl}/birthday`);
  }

  updateBirthdaySettings(settings: BirthdaySettings) {
    return this.http.put<{ data: BirthdaySettings }>(`${this.apiUrl}/birthday`, settings);
  }

  // Rangok ünneplése - the same shape as the birthday greeting's.
  getRankSettings() {
    return this.http.get<{ data: BirthdaySettings }>(`${this.apiUrl}/rank`);
  }

  updateRankSettings(settings: BirthdaySettings) {
    return this.http.put<{ data: BirthdaySettings }>(`${this.apiUrl}/rank`, settings);
  }

  // --- Elnök: named, with the wax seal, on a tour's beszámoló ---

  getPresident() {
    return this.http.get<{ data: { presidentName: string } }>(`${this.apiUrl}/president`);
  }

  updatePresident(presidentName: string) {
    return this.http.put<{ data: { presidentName: string } }>(`${this.apiUrl}/president`, {
      presidentName,
    });
  }

  // The seal as it looks now (v: a fresh picture after a name change).
  presidentSealUrl(v: string) {
    return `${this.apiUrl}/president/seal.png?v=${encodeURIComponent(v)}`;
  }

  // The reminder as a member would get it, to the admin themselves.
  testMembershipReminder() {
    return this.http.post<{ status: string; data: { sentTo: string } }>(
      `${this.apiUrl}/membership-reminder/test`,
      {},
    );
  }
}
