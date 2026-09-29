import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import {
  MembershipFee,
  BirthdaySettings,
  ChatImageSettings,
  ImageCacheSettings,
  MembershipReminder,
  SettingsService,
  feeForYear,
} from '../../../services/settings';
import { NotificationsService } from '../../../notifications/notifications.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { BarionWithdraw } from './barion-withdraw/barion-withdraw';
import {
  BIRTHDAY_EFFECTS,
  BirthdayEffect,
  BirthdayService,
} from '../../../shared/birthday/birthday.service';
import { AuthService } from '../../../auth/auth.service';

interface FeeRow {
  fromYear: number;
  amount: number;
}

// Every notification the app sends - listed on the Értesítések card so an
// admin can see what goes to whom, and when. Kept in step with the server
// by hand: each e-mail goes through server/src/utils/resendEmail.js, each
// push through server/src/utils/push.js. "Csak aki" = who's left out.
interface NotificationInfo {
  name: string;
  when: string;
  who: string;
  settings?: 'membershipReminder'; // set on this card
}

const ATTENDEE_RULE =
  'Csak akinek van e-mail címe, már bejelentkezett, és nem kapcsolta ki az e-maileket.';

const EMAILS: (NotificationInfo & { note?: string })[] = [
  {
    name: 'Sikeres jelentkezés',
    when: 'Valaki jelentkezik egy táborra.',
    who: 'Aki jelentkeztetett, és akit jelentkeztettek.',
    note: ATTENDEE_RULE,
  },
  {
    name: 'Lemondás',
    when: 'Valakit levesznek egy táborról.',
    who: 'Akit levettek, és aki őt jelentkeztette.',
    note: ATTENDEE_RULE,
  },
  {
    name: 'Tábori levél',
    when: 'Egy admin kiküldi a tábor oldaláról.',
    who: 'A tábor résztvevői (próbaküldés: csak az admin).',
    note: ATTENDEE_RULE,
  },
  {
    name: 'Programfüzet e-mailben',
    when: 'Egy admin elküldi magának próbaként.',
    who: 'Az admin.',
  },
  {
    name: 'Tábori videó megjött',
    when: 'Az „Új média felfedezése” új tábori videót talál.',
    who: 'A tábor résztvevői.',
    note: ATTENDEE_RULE,
  },
  {
    name: 'Tagdíj befizetve',
    when: 'Sikeres online tagdíjfizetés (számlával).',
    who: 'Aki fizetett.',
  },
  {
    name: 'Előleg befizetve',
    when: 'Sikeres online előlegfizetés (számlával).',
    who: 'Aki fizetett.',
  },
  {
    name: 'Mindenki befizette az előleget',
    when: 'Egy tábor utolsó résztvevője is befizeti az előleget.',
    who: 'Az adminok.',
  },
  {
    name: 'Minden klubtag befizette a tagdíjat',
    when: 'Az év utolsó tagdíja is befizetésre kerül – online fizetésnél azonnal, készpénznél egy órán belül (évente egyszer).',
    who: 'Az adminok.',
    note: 'A felfüggesztett tagok nem számítanak.',
  },
  {
    name: 'Tagdíj emlékeztető',
    when: 'A Tagdíj emlékeztető kártyán beállított napokon.',
    who: 'Aki még nem fizette be az idei tagdíjat, és már bejelentkezett. Az adminok összesítőt kapnak róla.',
    settings: 'membershipReminder',
  },
];

const PUSHES: NotificationInfo[] = [
  {
    name: 'Új Kotyogó-üzenet',
    when: 'Valaki ír a tábor Kotyogójába.',
    who: 'A tábor résztvevői, akik nem nézik épp a Kotyogót. Egy csörgés, utána csendben frissül, amíg meg nem nyitják; megemlítés (@név) mindig csörög; a Kotyogó némítható.',
  },
  {
    name: 'Új szavazás',
    when: 'Valaki szavazást indít a Kotyogóban.',
    who: 'A tábor résztvevői.',
  },
  {
    name: 'Szavazás hamarosan lezárul',
    when: '2 órával a lezárás előtt.',
    who: 'Akik még nem szavaztak.',
  },
  {
    name: 'Összejött!',
    when: 'Egy szavazási lehetőség eléri a kitűzött létszámot.',
    who: 'Akik arra szavaztak.',
  },
];

const MONTHS = [
  'január',
  'február',
  'március',
  'április',
  'május',
  'június',
  'július',
  'augusztus',
  'szeptember',
  'október',
  'november',
  'december',
];

// Klub → Beállítások (admin-only): club-wide settings. For now the yearly
// membership fee, as a table of amounts by the year each takes effect - a
// raise from a year on leaves older, still unpaid years at their old fee.
// A year somebody already paid for can't get a different fee (the server
// refuses it too).
@Component({
  selector: 'app-klub-settings',
  imports: [FormsModule, MatIconModule, DatePipe, BarionWithdraw],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class KlubSettings implements OnInit {
  private settingsService = inject(SettingsService);
  private notifications = inject(NotificationsService);

  readonly currentYear = new Date().getFullYear();

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
    this.loadReminder();
    this.loadChatImages();
    this.loadImageCache();
    this.loadBirthday();
    this.loadRank();
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

  // --- Értesítések: every e-mail and push the app sends, and the one that
  // can be set here (Tagdíj emlékeztető) ---

  readonly emails = EMAILS;
  readonly pushes = PUSHES;
  readonly months = MONTHS;

  reminderLoading = signal(true);
  reminder = signal<MembershipReminder | null>(null);
  reminderRecipients = signal<string[]>([]);
  // The form (saved with Mentés).
  reminderEnabled = signal(false);
  reminderMonth = signal(3);
  reminderDay = signal(1);
  reminderFrequency = signal<'monthly' | 'quarterly'>('quarterly');
  savingReminder = signal(false);
  sendingTest = signal(false);

  reminderDirty = computed(() => {
    const r = this.reminder();
    return (
      !!r &&
      (r.enabled !== this.reminderEnabled() ||
        r.startMonth !== Number(this.reminderMonth()) ||
        r.startDay !== Number(this.reminderDay()) ||
        r.frequency !== this.reminderFrequency())
    );
  });

  // This year's rounds for what's in the form right now - so the effect
  // of a change shows before saving ("1 March quarterly: Mar, Jun, Sep, Dec").
  previewDates = computed(() => {
    const step = this.reminderFrequency() === 'monthly' ? 1 : 3;
    const day = Number(this.reminderDay());
    const dates: string[] = [];
    for (let m = Number(this.reminderMonth()); m <= 12; m += step) {
      dates.push(`${MONTHS[m - 1]} ${day}.`);
    }
    return dates;
  });

  private loadReminder() {
    this.settingsService.getMembershipReminder().subscribe({
      next: (res) => {
        this.applyReminder(res.data.reminder);
        this.reminderRecipients.set(res.data.recipients);
        this.reminderLoading.set(false);
      },
      error: () => this.reminderLoading.set(false),
    });
  }

  private applyReminder(r: MembershipReminder) {
    this.reminder.set(r);
    this.reminderEnabled.set(r.enabled);
    this.reminderMonth.set(r.startMonth);
    this.reminderDay.set(r.startDay);
    this.reminderFrequency.set(r.frequency);
  }

  resetReminder() {
    const r = this.reminder();
    if (r) this.applyReminder(r);
  }

  saveReminder() {
    if (this.savingReminder()) return;
    this.savingReminder.set(true);
    this.settingsService
      .updateMembershipReminder({
        enabled: this.reminderEnabled(),
        startMonth: Number(this.reminderMonth()),
        startDay: Number(this.reminderDay()),
        frequency: this.reminderFrequency(),
      })
      .subscribe({
        next: (res) => {
          this.applyReminder(res.data.reminder);
          this.savingReminder.set(false);
          this.notifications.addSuccess('Tagdíj emlékeztető mentve.');
        },
        error: (err) => {
          this.savingReminder.set(false);
          this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
        },
      });
  }

  sendTestReminder() {
    if (this.sendingTest()) return;
    this.sendingTest.set(true);
    this.settingsService.testMembershipReminder().subscribe({
      next: (res) => {
        this.sendingTest.set(false);
        this.notifications.addSuccess(`Próba e-mail elküldve: ${res.data.sentTo}`);
      },
      error: (err) => {
        this.sendingTest.set(false);
        this.notifications.addError(err?.error?.message ?? 'A próba e-mail nem ment el.');
      },
    });
  }

  // "2027-06-01" -> "június 1."
  roundLabel(date: string): string {
    const [, m, d] = date.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}.`;
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

  // --- Születésnap: the birthday greeting (shared/birthday) ---

  private birthday = inject(BirthdayService);
  private auth = inject(AuthService);
  readonly birthdayEffects = BIRTHDAY_EFFECTS;

  birthdaySaved = signal<BirthdaySettings | null>(null);
  bdEnabled = signal(true);
  bdEffect = signal<BirthdayEffect>('confetti');
  bdMessage = signal('');
  savingBirthday = signal(false);

  birthdayDirty = computed(() => {
    const b = this.birthdaySaved();
    return (
      !!b &&
      (b.enabled !== this.bdEnabled() ||
        b.effect !== this.bdEffect() ||
        b.message !== this.bdMessage().trim())
    );
  });

  private loadBirthday() {
    this.settingsService.getBirthdaySettings().subscribe({
      next: (res) => this.applyBirthday(res.data),
      error: () => {},
    });
  }

  private applyBirthday(b: BirthdaySettings) {
    this.birthdaySaved.set(b);
    this.bdEnabled.set(b.enabled);
    this.bdEffect.set(b.effect);
    this.bdMessage.set(b.message);
  }

  resetBirthday() {
    const b = this.birthdaySaved();
    if (b) this.applyBirthday(b);
  }

  // Plays it on my own screen now, as set in the form (saved or not) - with
  // my own given name in {név} (the last part of a Hungarian name).
  previewBirthday() {
    const myName = (this.auth.user()?.name ?? '').trim().split(/\s+/).at(-1) ?? '';
    const text = (this.bdMessage().trim() || 'Boldog születésnapot, {név}! 🎂').replaceAll(
      '{név}',
      myName,
    );
    void this.birthday.play(this.bdEffect(), text);
  }

  saveBirthday() {
    if (this.savingBirthday()) return;
    this.savingBirthday.set(true);
    this.settingsService
      .updateBirthdaySettings({
        enabled: this.bdEnabled(),
        effect: this.bdEffect(),
        message: this.bdMessage().trim(),
      })
      .subscribe({
        next: (res) => {
          this.applyBirthday(res.data);
          this.savingBirthday.set(false);
          this.notifications.addSuccess('Születésnap beállítás mentve.');
        },
        error: (err) => {
          this.savingBirthday.set(false);
          this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
        },
      });
  }

  // --- Rangok ünneplése: a newly reached rank (shared/birthday) ---

  rankSaved = signal<BirthdaySettings | null>(null);
  rkEnabled = signal(true);
  rkEffect = signal<BirthdayEffect>('fireworks');
  rkMessage = signal('');
  savingRank = signal(false);

  rankDirty = computed(() => {
    const r = this.rankSaved();
    return (
      !!r &&
      (r.enabled !== this.rkEnabled() ||
        r.effect !== this.rkEffect() ||
        r.message !== this.rkMessage().trim())
    );
  });

  private loadRank() {
    this.settingsService.getRankSettings().subscribe({
      next: (res) => this.applyRank(res.data),
      error: () => {},
    });
  }

  private applyRank(r: BirthdaySettings) {
    this.rankSaved.set(r);
    this.rkEnabled.set(r.enabled);
    this.rkEffect.set(r.effect);
    this.rkMessage.set(r.message);
  }

  resetRank() {
    const r = this.rankSaved();
    if (r) this.applyRank(r);
  }

  // Plays it on my own screen now, as set in the form - as if I had just
  // reached Bronz with 10 tours.
  previewRank() {
    const myName = (this.auth.user()?.name ?? '').trim().split(/\s+/).at(-1) ?? '';
    const text = (this.rkMessage().trim() || 'Kedves {név}! Túléltél {szám} bódorgót!')
      .replaceAll('{név}', myName)
      .replaceAll('{szám}', '10')
      .replaceAll('{rang}', 'Bronz');
    void this.birthday.play(this.rkEffect(), text, 'rank');
  }

  saveRank() {
    if (this.savingRank()) return;
    this.savingRank.set(true);
    this.settingsService
      .updateRankSettings({
        enabled: this.rkEnabled(),
        effect: this.rkEffect(),
        message: this.rkMessage().trim(),
      })
      .subscribe({
        next: (res) => {
          this.applyRank(res.data);
          this.savingRank.set(false);
          this.notifications.addSuccess('Rangok ünneplése mentve.');
        },
        error: (err) => {
          this.savingRank.set(false);
          this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
        },
      });
  }
}
