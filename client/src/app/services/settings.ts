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

  // The reminder as a member would get it, to the admin themselves.
  testMembershipReminder() {
    return this.http.post<{ status: string; data: { sentTo: string } }>(
      `${this.apiUrl}/membership-reminder/test`,
      {},
    );
  }
}
