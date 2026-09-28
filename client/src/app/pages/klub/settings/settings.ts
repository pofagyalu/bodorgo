import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import {
  MembershipFee,
  MembershipReminder,
  SettingsService,
  feeForYear,
} from '../../../services/settings';
import { NotificationsService } from '../../../notifications/notifications.service';

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
    when: 'A lent beállított napokon.',
    who: 'Aki még nem fizette be az idei tagdíjat, és már bejelentkezett. Az adminok összesítőt kapnak róla.',
    settings: 'membershipReminder',
  },
];

const PUSHES: NotificationInfo[] = [
  {
    name: 'Új chatüzenet',
    when: 'Valaki ír a tábor chatjébe.',
    who: 'A tábor résztvevői, akik nem nézik épp a chatet. Egy csörgés, utána csendben frissül, amíg meg nem nyitják; megemlítés (@név) mindig csörög; a chat némítható.',
  },
  {
    name: 'Új szavazás',
    when: 'Valaki szavazást indít a chatben.',
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
  imports: [FormsModule, MatIconModule, DatePipe],
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
}
