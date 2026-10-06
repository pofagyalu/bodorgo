import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import {
  ChatImageSettings,
  ImageCacheSettings,
  MembershipFee,
  PAYMENT_METHOD_NAMES,
  PaymentMethodKey,
  PaymentMethodSettings,
  PaymentMethods,
  SettingsService,
  feeForYear,
  paymentFee,
} from '../../../../services/settings';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';
import { BarionWithdraw } from '../barion-withdraw/barion-withdraw';

interface FeeRow {
  fromYear: number;
  amount: number;
}

// Klub → Beállítások → Klub és fizetés: the membership fee, the payment
// methods, the president, and the room the photos take (the chat's, and the
// picture cache). One of the settings page's tabs
// (settings.ts shows them; every tab stays in the DOM, only hidden).
@Component({
  selector: 'app-club-settings',
  imports: [FormsModule, MatIconModule, DatePipe, BarionWithdraw],
  templateUrl: './club-settings.html',
  styleUrl: './club-settings.scss',
})
export class ClubSettingsTab implements OnInit {
  private settingsService = inject(SettingsService);
  private notifications = inject(NotificationsService);

  readonly currentYear = new Date().getFullYear();

  // --- Tagdíj: the fee by year, and the list of what was changed ---

  loading = signal(true);
  saving = signal(false);
  foundingYear = signal(2019);
  paidYears = signal<number[]>([]);
  history = signal<{ at: string; byName: string; change: string }[]>([]);

  // What's saved, and the table being edited.
  private saved = signal<MembershipFee[]>([]);
  rows = signal<FeeRow[]>([]);

  dirty = computed(
    () => JSON.stringify(this.sorted(this.rows())) !== JSON.stringify(this.sorted(this.saved())),
  );
  currentFee = computed(() => feeForYear(this.saved(), this.currentYear));

  ngOnInit() {
    this.loadPayMethods();
    this.loadPresident();
    this.loadChatImages();
    this.loadImageCache();
    this.settingsService.getMembershipFees().subscribe({
      next: (res) => {
        this.foundingYear.set(res.data.foundingYear);
        this.paidYears.set(res.data.paidYears ?? []);
        this.history.set(res.data.history ?? []);
        this.saved.set(res.data.fees);
        this.rows.set(res.data.fees.map((f) => ({ ...f })));
        this.loading.set(false);
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'A beállítások betöltése nem sikerült.');
        this.loading.set(false);
      },
    });
  }

  private sorted(rows: FeeRow[]) {
    return [...rows]
      .map((r) => ({ fromYear: Number(r.fromYear), amount: Number(r.amount) }))
      .sort((a, b) => a.fromYear - b.fromYear);
  }

  // The years a saved row covers, up to (not including) the next row's.
  private yearsOf(row: FeeRow, all: FeeRow[]): [number, number] {
    const later = all.filter((r) => r.fromYear > row.fromYear).map((r) => r.fromYear);
    return [row.fromYear, later.length ? Math.min(...later) - 1 : Infinity];
  }

  // A saved row somebody has already paid under - locked (see the server's
  // same check); the founding-year row's year is always fixed.
  isLocked(row: FeeRow): boolean {
    const original = this.saved().find((f) => f.fromYear === row.fromYear);
    if (!original) return false;
    const [from, to] = this.yearsOf(original, this.saved());
    return this.paidYears().some((y) => y >= from && y <= to);
  }

  isFounding(row: FeeRow): boolean {
    return (
      row.fromYear === this.foundingYear() && this.saved().some((f) => f.fromYear === row.fromYear)
    );
  }

  // "2019–2026" / "2027-től"
  rangeLabel(row: FeeRow): string {
    const [from, to] = this.yearsOf(row, this.rows());
    return to === Infinity ? `${from}-től` : from === to ? `${from}` : `${from}–${to}`;
  }

  addRow() {
    const last = this.sorted(this.rows()).at(-1);
    const nextYear = Math.max(this.currentYear + 1, (last?.fromYear ?? this.currentYear) + 1);
    this.rows.update((rows) => [...rows, { fromYear: nextYear, amount: last?.amount ?? 1000 }]);
  }

  removeRow(row: FeeRow) {
    this.rows.update((rows) => rows.filter((r) => r !== row));
  }

  update(row: FeeRow, field: keyof FeeRow, value: number) {
    this.rows.update((rows) => rows.map((r) => (r === row ? { ...r, [field]: Number(value) } : r)));
  }

  reset() {
    this.rows.set(this.saved().map((f) => ({ ...f })));
  }

  save() {
    if (this.saving()) return;
    this.saving.set(true);
    this.settingsService.updateMembershipFees(this.sorted(this.rows())).subscribe({
      next: (res) => {
        this.saved.set(res.data.fees);
        this.rows.set(res.data.fees.map((f) => ({ ...f })));
        this.saving.set(false);
        this.notifications.addSuccess('Tagdíj mentve.');
        // Fresh history (and paid years) from the server.
        this.settingsService.getMembershipFees().subscribe((r) => {
          this.history.set(r.data.history ?? []);
          this.paidYears.set(r.data.paidYears ?? []);
        });
      },
      error: (err) => {
        this.saving.set(false);
        this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
      },
    });
  }

  // What was changed, read anew - after a save here, and when the OIDC tab
  // saved something (the settings page tells).
  refreshHistory() {
    this.settingsService
      .getMembershipFees()
      .subscribe((r) => this.history.set(r.data.history ?? []));
  }

  // --- Fizetési módok: Stripe and Barion - on or off, and the fee on top ---

  readonly payMethodKeys: PaymentMethodKey[] = ['stripe', 'barion'];
  readonly payMethodNames = PAYMENT_METHOD_NAMES;
  // What's saved, and the form (each method saved with its own Mentés).
  private payMethods = signal<PaymentMethods | null>(null);
  payForm = signal<PaymentMethods | null>(null);
  savingPayMethod = signal<PaymentMethodKey | null>(null);

  private loadPayMethods() {
    this.settingsService.getPaymentMethods().subscribe({
      next: (res) => {
        this.payMethods.set(res.data);
        this.payForm.set(res.data);
      },
      error: () => {},
    });
  }

  payMethodDirty(key: PaymentMethodKey): boolean {
    return JSON.stringify(this.payMethods()?.[key]) !== JSON.stringify(this.payForm()?.[key]);
  }

  setPayField(key: PaymentMethodKey, field: keyof PaymentMethodSettings, value: unknown) {
    this.payForm.update(
      (form) =>
        form && {
          ...form,
          [key]: { ...form[key], [field]: field === 'enabled' ? !!value : Number(value) },
        },
    );
  }

  // What a sum becomes with the fee in the form right now.
  payExample(key: PaymentMethodKey, sum: number): string {
    const method = this.payForm()?.[key];
    const total = method ? sum + paymentFee(sum, method) : sum;
    return new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 }).format(total);
  }

  resetPayMethod(key: PaymentMethodKey) {
    const saved = this.payMethods();
    if (saved) this.payForm.update((form) => form && { ...form, [key]: saved[key] });
  }

  savePayMethod(key: PaymentMethodKey) {
    const method = this.payForm()?.[key];
    if (!method || this.savingPayMethod()) return;
    this.savingPayMethod.set(key);
    this.settingsService.updatePaymentMethod(key, method).subscribe({
      next: (res) => {
        this.payMethods.update((saved) => saved && { ...saved, [key]: res.data });
        this.payForm.update((form) => form && { ...form, [key]: res.data });
        this.savingPayMethod.set(null);
        this.notifications.addSuccess(`${PAYMENT_METHOD_NAMES[key]} beállítás mentve.`);
        this.settingsService
          .getMembershipFees()
          .subscribe((r) => this.history.set(r.data.history ?? []));
      },
      error: (err) => {
        this.savingPayMethod.set(null);
        this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
      },
    });
  }

  // --- Elnök: on a tour's beszámoló, and around its wax seal ---

  presidentSaved = signal<string | null>(null);
  presidentName = signal('');
  savingPresident = signal(false);
  // Changes with a saved name, so the seal picture is made again with it.
  private sealVersion = signal('');
  sealUrl = computed(() => this.settingsService.presidentSealUrl(this.sealVersion()));

  presidentDirty = computed(() => this.presidentName().trim() !== (this.presidentSaved() ?? ''));

  private loadPresident() {
    this.settingsService.getPresident().subscribe({
      next: (res) => this.applyPresident(res.data.presidentName),
      error: () => {},
    });
  }

  private applyPresident(name: string) {
    this.presidentSaved.set(name);
    this.presidentName.set(name);
    this.sealVersion.set(name);
  }

  savePresident() {
    if (this.savingPresident()) return;
    this.savingPresident.set(true);
    this.settingsService.updatePresident(this.presidentName().trim()).subscribe({
      next: (res) => {
        this.applyPresident(res.data.presidentName);
        this.savingPresident.set(false);
        this.notifications.addSuccess('Elnök mentve.');
      },
      error: (err) => {
        this.savingPresident.set(false);
        this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
      },
    });
  }

  // --- Chat fotók: the folder's size limit and the daily number per person ---

  chatImages = signal<ChatImageSettings | null>(null);
  chatQuotaMB = signal(1024);
  chatDailyLimit = signal(10);
  savingChatImages = signal(false);

  chatImagesDirty = computed(() => {
    const c = this.chatImages();
    return (
      !!c &&
      (c.quotaMB !== Number(this.chatQuotaMB()) || c.dailyLimit !== Number(this.chatDailyLimit()))
    );
  });

  // How full the folder is, 0-100.
  chatUsagePercent = computed(() => {
    const c = this.chatImages();
    if (!c) return 0;
    return Math.min(100, Math.round((c.usage.bytes / (c.quotaMB * 1024 * 1024)) * 100));
  });

  chatUsageMB = computed(() => Math.round((this.chatImages()?.usage.bytes ?? 0) / (1024 * 1024)));

  private loadChatImages() {
    this.settingsService.getChatImageSettings().subscribe({
      next: (res) => this.applyChatImages(res.data),
      error: () => {},
    });
  }

  applyChatImages(c: ChatImageSettings) {
    this.chatImages.set(c);
    this.chatQuotaMB.set(c.quotaMB);
    this.chatDailyLimit.set(c.dailyLimit);
  }

  saveChatImages() {
    if (this.savingChatImages()) return;
    this.savingChatImages.set(true);
    this.settingsService
      .updateChatImageSettings({
        quotaMB: Number(this.chatQuotaMB()),
        dailyLimit: Number(this.chatDailyLimit()),
      })
      .subscribe({
        next: (res) => {
          this.applyChatImages(res.data);
          this.savingChatImages.set(false);
          this.notifications.addSuccess(
            res.data.removed
              ? `Kotyogó fotók mentve – ${res.data.removed} régi fotó törölve, hogy beférjen.`
              : 'Kotyogó fotók mentve.',
          );
        },
        error: (err) => {
          this.savingChatImages.set(false);
          this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
        },
      });
  }

  // --- Kép gyorsítótár: the smaller photo versions for the viewer ---

  private confirm = inject(ConfirmService);
  imageCache = signal<ImageCacheSettings | null>(null);
  imageCacheQuotaMB = signal(5120);
  savingImageCache = signal(false);

  imageCacheDirty = computed(() => {
    const c = this.imageCache();
    return !!c && c.quotaMB !== Number(this.imageCacheQuotaMB());
  });

  imageCachePercent = computed(() => {
    const c = this.imageCache();
    if (!c) return 0;
    return Math.min(100, Math.round((c.usage.bytes / (c.quotaMB * 1024 * 1024)) * 100));
  });

  imageCacheUsageMB = computed(() =>
    Math.round((this.imageCache()?.usage.bytes ?? 0) / (1024 * 1024)),
  );

  private loadImageCache() {
    this.settingsService.getImageCacheSettings().subscribe({
      next: (res) => this.applyImageCache(res.data),
      error: () => {},
    });
  }

  applyImageCache(c: ImageCacheSettings) {
    this.imageCache.set(c);
    this.imageCacheQuotaMB.set(c.quotaMB);
  }

  saveImageCache() {
    if (this.savingImageCache()) return;
    this.savingImageCache.set(true);
    this.settingsService.updateImageCacheSettings(Number(this.imageCacheQuotaMB())).subscribe({
      next: (res) => {
        this.applyImageCache(res.data);
        this.savingImageCache.set(false);
        this.notifications.addSuccess(
          res.data.removed
            ? `Kép gyorsítótár mentve – ${res.data.removed} régóta nem nézett kép törölve, hogy beférjen.`
            : 'Kép gyorsítótár mentve.',
        );
      },
      error: (err) => {
        this.savingImageCache.set(false);
        this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
      },
    });
  }

  async clearImageCache() {
    if (this.savingImageCache()) return;
    const ok = await this.confirm.ask({
      message: 'Biztosan üríted a kép gyorsítótárat?',
      detail:
        'Az eredeti fotók megmaradnak – a kisebb változatok újra elkészülnek, ahogy megnézik őket.',
      confirmText: 'Ürítés',
    });
    if (!ok) return;
    this.savingImageCache.set(true);
    this.settingsService.clearImageCache().subscribe({
      next: (res) => {
        this.applyImageCache(res.data);
        this.savingImageCache.set(false);
        this.notifications.addSuccess(
          `Kép gyorsítótár kiürítve – ${res.data.removed} kép törölve.`,
        );
      },
      error: (err) => {
        this.savingImageCache.set(false);
        this.notifications.addError(err?.error?.message ?? 'Az ürítés nem sikerült.');
      },
    });
  }
}
