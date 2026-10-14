import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import type { BirthdayEffect } from '../shared/birthday/birthday.service';
import type { OutlookPackIcon, OutlookTier, WeatherCondition } from './tour';

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
    // change).
    paidYears?: number[];
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

// "Éves jelentés" (see server/src/utils/yearlyReportMail.js): the year the
// next e-mail is about, the 1 January it goes out on, who would get it now,
// and the last year already sent.
export interface YearlyReportInfo {
  year: number;
  sendsOn: string;
  recipients: string[];
  lastSentYear: number | null;
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

// Napló (Klub → Napló): one line of it - who did what and when (server
// controllers/auditLogController.js).
export type AuditAction =
  | 'role-change'
  | 'cash-advance'
  | 'cash-membership'
  | 'cash-undo'
  | 'withdrawal'
  | 'barion-settings'
  | 'settings';

export interface AuditEntry {
  _id: string;
  at: string;
  action: AuditAction;
  actorName: string;
  targetName?: string;
  summary: string; // one line, as it is shown
}

// Naplófájlok (Klub → Napló, the role manager's): one of the server's log
// files - an app or an error file of a day (server logger.js).
export interface LogFileInfo {
  name: string; // e.g. error-2026-10-14.log.gz
  kind: 'app' | 'error';
  date: string; // YYYY-MM-DD
  gz: boolean;
  size: number; // bytes
}

export interface LogFileLines {
  name: string;
  totalLines: number;
  lines: string[]; // the last ones, oldest first
}

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

// OIDC szolgáltató (Beállítások, the role manager only): the Authentik
// provider people log in through, and the token its invitations are made
// with. The two secrets never come from the server - only whether there
// is one.
export interface OidcSettings {
  serverUrl: string;
  providerSlug: string;
  clientId: string;
  hasClientSecret: boolean;
  postLogoutRedirectUri: string;
  hasApiToken: boolean;
  invitationFlow: string;
  source: 'database' | 'env'; // saved here, or still the server's .env
  unreadable: boolean; // the saved secrets can't be read with the server's key
  canSave: boolean; // the server has the key its secrets are encrypted with
  issuer: string;
  redirectUri: string; // this server's own callback
  // Information for setting a provider up: everything to list among its
  // Redirect URIs (a developer's own server, the live API, the live site).
  redirectUris: string[];
  localLogin: boolean; // LOCAL_LOGIN=true: the emergency login is on
  // Which provider everybody logs in through: 'authentik', or the id of
  // one of the others added next to it.
  active: string;
  providers: OidcProvider[];
}

// Another OIDC provider next to Authentik: any that describes itself at
// its Issuer URL.
export interface OidcProvider {
  id: string;
  name: string;
  issuerUrl: string;
  clientId: string;
  hasClientSecret: boolean;
  postLogoutRedirectUri: string;
  // Only people whose e-mail the provider says is confirmed get in.
  requireVerifiedEmail: boolean;
  unreadable: boolean; // its secret can't be read with the server's key
}

// What's sent of one: an empty secret keeps the one it has.
export interface OidcProviderInput {
  name: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  postLogoutRedirectUri: string;
  requireVerifiedEmail: boolean;
}

// What's sent: an empty secret keeps the one in use.
export interface OidcSettingsUpdate {
  serverUrl: string;
  providerSlug: string;
  clientId: string;
  clientSecret: string;
  postLogoutRedirectUri: string;
  apiToken: string;
  removeApiToken: boolean;
  invitationFlow: string;
}

// Everything a tour's weather outlook (Életviteli tanácsok) is worked out
// from, as it stands in the server's code (utils/weatherOutlookSettings.js)
// - read only, for Beállítások → Infó to explain the formula with.
export interface WeatherOutlookRules {
  forecast: { daysAhead: number; refetchHours: number };
  settings: {
    conditionScore: Record<WeatherCondition, number>;
    wetConditions: WeatherCondition[];
    sunnyConditions: WeatherCondition[];
    rainChanceSoftening: number;
    defaultRainChance: number;
    wetRainChance: number;
    comfortByMonth: [number, number][]; // January first: [low, high] °C
    comfortFadeBelow: number;
    comfortFadeAbove: number;
    weights: { condition: number; temperature: number; average: number; worstDay: number };
    tiers: { perfect: number; great: number; mixed: number; gloomy: number };
    uncertainAfterDays: number;
    allGoodFrom: number;
    bestDayLead: number;
    packing: {
      tshirtFromMaxC: number;
      sweaterBelowMinC: number;
      jacketBelowMinC: number;
      beanieFromMinC: number;
      sunFromMaxC: number;
      sunnyDayFromMaxC: number;
      layersFromSpreadC: number;
      windFromKmh: number;
    };
  };
  // The moods, worst first, each with its stretch of the index.
  tiers: { tier: OutlookTier; from: number; to: number; tag: string; word: string }[];
  conditionNames: Record<WeatherCondition, string>;
  packNames: Record<OutlookPackIcon, string>;
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

  // --- Napló (admin-only) ---

  // Newest first, fifty at a time; `before`: the ones before that moment
  // (the last shown entry's `at`).
  getAuditLog(before?: string) {
    return this.http.get<{ data: { entries: AuditEntry[]; hasMore: boolean } }>(
      `${this.apiUrl}/audit-log`,
      { params: before ? { before } : {} },
    );
  }

  // --- Életviteli tanácsok: the weather outlook's rules, to read (Infó) ---

  getWeatherOutlookRules() {
    return this.http.get<{ data: WeatherOutlookRules }>(`${this.apiUrl}/weather-outlook`);
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

  // --- OIDC szolgáltató (the role manager only) ---

  getOidcSettings() {
    return this.http.get<{ data: OidcSettings }>(`${this.apiUrl}/oidc`);
  }

  updateOidcSettings(settings: OidcSettingsUpdate) {
    return this.http.put<{ data: OidcSettings }>(`${this.apiUrl}/oidc`, settings);
  }

  // Another provider next to Authentik; `created` is its id.
  addOidcProvider(provider: OidcProviderInput) {
    return this.http.post<{ data: OidcSettings & { created: string } }>(
      `${this.apiUrl}/oidc/providers`,
      provider,
    );
  }

  updateOidcProvider(id: string, provider: OidcProviderInput) {
    return this.http.put<{ data: OidcSettings }>(`${this.apiUrl}/oidc/providers/${id}`, provider);
  }

  deleteOidcProvider(id: string) {
    return this.http.delete<{ data: OidcSettings }>(`${this.apiUrl}/oidc/providers/${id}`);
  }

  // Which one everybody logs in through: 'authentik' or a provider's id.
  setActiveOidcProvider(provider: string) {
    return this.http.put<{ data: OidcSettings }>(`${this.apiUrl}/oidc/active`, { provider });
  }

  // --- Éves jelentés: the club's year on one PDF page, e-mailed on 1 January ---

  getYearlyReport() {
    return this.http.get<{ status: string; data: YearlyReportInfo }>(
      `${this.apiUrl}/yearly-report`,
    );
  }

  // --- Naplófájlok: the server's log files (the role manager's, after
  // re-identifying) ---

  getLogFiles() {
    return this.http.get<{ data: { files: LogFileInfo[] } }>(`${this.apiUrl}/logs`);
  }

  // A file's last `lines` lines.
  getLogFile(name: string, lines: number) {
    return this.http.get<{ data: LogFileLines }>(
      `${this.apiUrl}/logs/${encodeURIComponent(name)}`,
      { params: { lines } },
    );
  }

  logFileDownloadUrl(name: string) {
    return `${this.apiUrl}/logs/${encodeURIComponent(name)}/download`;
  }

  // The report as it stands today (a PDF, opened in its own tab).
  yearlyReportPdfUrl() {
    return `${this.apiUrl}/yearly-report/preview.pdf`;
  }

  // The e-mail as a member would get it, to the admin themselves.
  testYearlyReport() {
    return this.http.post<{ status: string; data: { sentTo: string; year: number } }>(
      `${this.apiUrl}/yearly-report/test`,
      {},
    );
  }

  // The reminder as a member would get it, to the admin themselves.
  testMembershipReminder() {
    return this.http.post<{ status: string; data: { sentTo: string } }>(
      `${this.apiUrl}/membership-reminder/test`,
      {},
    );
  }
}
