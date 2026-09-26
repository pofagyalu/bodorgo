import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MembershipFee, SettingsService, feeForYear } from '../../../services/settings';
import { NotificationsService } from '../../../notifications/notifications.service';
import { UserService } from '../../../services/user';
import { usernameKey } from '../../../shared/usernames';

interface UsernameRow {
  id: string;
  name: string;
  original: string;
  username: string;
}

// A username from a real name - see KlubSettings.suggestUsernames. Keeps
// accents ("Zoltán"); drops anything the server wouldn't accept (see
// shared/usernames.ts). `taken` holds usernameKey()s.
function suggestUsername(fullName: string, taken: Set<string>): string {
  const clean = (s: string) => s.replace(/[^\p{L}\p{N}._-]/gu, '');
  const words = fullName.trim().split(/\s+/).map(clean).filter(Boolean);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const given = cap(words.at(-1) ?? 'Tag');
  const family = words.length > 1 ? cap(words[0]) : '';
  let base = given.length >= 3 ? given : `${given}${family}`.padEnd(3, 'x');
  base = base.slice(0, 36);
  const candidates = [base, family ? `${base}${family.charAt(0)}` : null].filter(Boolean) as string[];
  for (const c of candidates) if (!taken.has(usernameKey(c))) return c;
  for (let i = 2; ; i++) if (!taken.has(usernameKey(`${base}${i}`))) return `${base}${i}`;
}

interface FeeRow {
  fromYear: number;
  amount: number;
}

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

  dirty = computed(() => JSON.stringify(this.sorted(this.rows())) !== JSON.stringify(this.sorted(this.saved())));
  currentFee = computed(() => feeForYear(this.saved(), this.currentYear));

  ngOnInit() {
    this.loadUsernames();
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
    return [...rows].map((r) => ({ fromYear: Number(r.fromYear), amount: Number(r.amount) })).sort((a, b) => a.fromYear - b.fromYear);
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
    return row.fromYear === this.foundingYear() && this.saved().some((f) => f.fromYear === row.fromYear);
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

  // --- Felhasználónevek: filling in everyone's username at once ---

  private userService = inject(UserService);
  people = signal<UsernameRow[]>([]);
  usernameErrors = signal<Record<string, string>>({});
  savingUsernames = signal(false);
  usernamesDirty = computed(() => this.people().some((p) => p.username !== p.original));
  missingCount = computed(() => this.people().filter((p) => !p.username.trim()).length);

  private loadUsernames() {
    this.userService.getUsernames().subscribe({
      next: (res) =>
        this.people.set(
          res.data.users.map((u) => ({ id: u._id, name: u.name, original: u.username ?? '', username: u.username ?? '' })),
        ),
      error: () => this.notifications.addError('A felhasználónevek betöltése nem sikerült.'),
    });
  }

  setUsername(id: string, value: string) {
    this.people.update((list) => list.map((p) => (p.id === id ? { ...p, username: value } : p)));
    this.usernameErrors.update((e) => {
      const { [id]: _removed, ...rest } = e;
      return rest;
    });
  }

  // Fills the empty ones: the given name (the last word - Hungarian names
  // put the family name first) - "Nagy Zoltán" → "Zoltán"; if that's taken
  // (ignoring case and accents), with the family name's initial
  // ("ZoltánN"), then a number. Only a suggestion - review, then Mentés.
  suggestUsernames() {
    const taken = new Set(this.people().map((p) => usernameKey(p.username.trim())).filter(Boolean));
    this.people.update((list) =>
      list.map((p) => {
        if (p.username.trim()) return p;
        const suggestion = suggestUsername(p.name, taken);
        taken.add(usernameKey(suggestion));
        return { ...p, username: suggestion };
      }),
    );
  }

  resetUsernames() {
    this.people.update((list) => list.map((p) => ({ ...p, username: p.original })));
    this.usernameErrors.set({});
  }

  saveUsernames() {
    if (this.savingUsernames()) return;
    const changed = this.people().filter((p) => p.username !== p.original);
    this.savingUsernames.set(true);
    this.userService.updateUsernames(changed.map((p) => ({ id: p.id, username: p.username.trim() }))).subscribe({
      next: (res) => {
        this.savingUsernames.set(false);
        this.usernameErrors.set({});
        this.people.update((list) => list.map((p) => ({ ...p, username: p.username.trim(), original: p.username.trim() })));
        this.notifications.addSuccess(`${res.data.updated} felhasználónév mentve.`);
      },
      error: (err) => {
        this.savingUsernames.set(false);
        this.usernameErrors.set(err?.error?.errors ?? {});
        this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
      },
    });
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
}
