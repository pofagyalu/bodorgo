import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import {
  MembershipFee,
  MembershipReminder,
  SettingsService,
  feeForYear,
} from '../../../../services/settings';
import { NotificationsService } from '../../../../notifications/notifications.service';

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

interface FeeRow {
  fromYear: number;
  amount: number;
}

// Klub → Beállítások → Klub: the membership fee, the president, and the
// e-mails reminding of an unpaid fee. One of the settings page's tabs
// (settings.ts shows them; every tab stays in the DOM, only hidden).
@Component({
  selector: 'app-club-settings',
  imports: [FormsModule, MatIconModule],
  templateUrl: './club-settings.html',
  styleUrl: './club-settings.scss',
})
export class ClubSettingsTab implements OnInit {
  private settingsService = inject(SettingsService);
  private notifications = inject(NotificationsService);

  readonly currentYear = new Date().getFullYear();

  // --- Tagdíj: the fee by year ---

  loading = signal(true);
  saving = signal(false);
  foundingYear = signal(2019);
  paidYears = signal<number[]>([]);

  // What's saved, and the table being edited.
  private saved = signal<MembershipFee[]>([]);
  rows = signal<FeeRow[]>([]);

  dirty = computed(
    () => JSON.stringify(this.sorted(this.rows())) !== JSON.stringify(this.sorted(this.saved())),
  );
  currentFee = computed(() => feeForYear(this.saved(), this.currentYear));

  ngOnInit() {
    this.loadPresident();
    this.loadReminder();
    this.settingsService.getMembershipFees().subscribe({
      next: (res) => {
        this.foundingYear.set(res.data.foundingYear);
        this.paidYears.set(res.data.paidYears ?? []);
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
        // The paid years fresh from the server. (Who changed what is on
        // Klub → Napló, as every other change of the settings.)
        this.settingsService
          .getMembershipFees()
          .subscribe((r) => this.paidYears.set(r.data.paidYears ?? []));
      },
      error: (err) => {
        this.saving.set(false);
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

  // --- Tagdíj emlékeztető: e-mails to whoever hasn't paid this year's fee ---

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
}
