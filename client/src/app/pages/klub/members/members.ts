import { Component, OnInit, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { Observable } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../../auth/auth.service';
import { MembershipService, MemberUser } from '../../../services/membership';
import { FinanceService, Transaction, TransactionCurrency } from '../../../services/finance';
import { PaymentService } from '../../../services/payment';
import { UserService } from '../../../services/user';
import { NotificationsService } from '../../../notifications/notifications.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { ExtraColumn, PeopleTable } from './people-table/people-table';
import { SettingsService, MembershipFee, feeForYear } from '../../../services/settings';

function formatMoney(amount: number, currency: TransactionCurrency = 'HUF'): string {
  const formatted = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 }).format(amount);
  return currency === 'EUR' ? `${formatted} €` : `${formatted} Ft`;
}

// The club has tracked membership dues since this year - the year strip
// and the per-member table both span from here to the current year,
// rather than an arbitrary fixed window.
const CLUB_FOUNDING_YEAR = 2019;

// Mirrors utils/barion.js's own BARION_FEE_RATE server-side - shown here
// purely so the confirmation dialog can display what the payer will
// actually be charged before they ever reach Barion's page; the server
// never trusts this figure, it computes the real charge itself the same
// way (see paymentController.js's chargeableAmount).
const BARION_FEE_RATE = 0.016;

@Component({
  selector: 'app-members',
  imports: [DatePipe, RouterLink, MatIconModule, PeopleTable],
  templateUrl: './members.html',
  styleUrl: './members.scss',
})
export class Members implements OnInit {
  private membershipService = inject(MembershipService);
  private financeService = inject(FinanceService);
  private paymentService = inject(PaymentService);
  private userService = inject(UserService);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);
  private auth = inject(AuthService);
  private settingsService = inject(SettingsService);

  isAdmin = computed(() => this.auth.user()?.role === 'admin');
  myId = computed(() => this.auth.user()?.id ?? null);

  users = signal<MemberUser[]>([]);
  loading = signal(true);

  // "userId:year" -> the real Tagdíj income transaction that covers it
  // (see server/src/models/transactionModel.js's user/membershipYear
  // fields) - built once from the finance ledger, not per-cell, so
  // checking (and showing details for) a given member+year is a plain
  // Map lookup.
  private paidTransactions = signal<Map<string, Transaction>>(new Map());

  activeTab = signal<'club' | 'casual' | 'everyone'>('club');
  // "Személy keresése" - one search for all three tables, by name or
  // email, kept when switching tabs.
  search = signal('');

  // Which club member's per-year payment history is expanded inline in the
  // "Tagok és éves befizetések" table right now (admin-only - see
  // toggleDetail below) - at most one at a time, matching the mockup the
  // user approved. Distinct from "Saját befizetések" above the table,
  // which always shows the viewer's own dues regardless of this.
  expandedMemberId = signal<string | null>(null);

  // Set once the browser is redirected back from the gateway's own
  // checkout page (see the ?paymentId= query param, matching payment.ts's
  // own returningPaymentId convention).
  private returningPaymentId = this.route.snapshot.queryParamMap.get('paymentId');
  paying = signal(false);
  paymentNotice = signal<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Shown before ever redirecting to the payment gateway - who exactly is
  // included and what it totals to, so a family payment doesn't silently
  // charge for people the payer didn't mean to include this time.
  showPayConfirm = signal(false);

  // Descending, e.g. [2026, 2025, ..., 2019] - matches the demo's own
  // newest-first column order.
  membershipYears = computed(() => {
    const current = new Date().getFullYear();
    const years: number[] = [];
    for (let y = current; y >= CLUB_FOUNDING_YEAR; y--) years.push(y);
    return years;
  });

  clubMembers = computed(() =>
    this.users().filter((u) => u.role === 'admin' || u.role === 'member'),
  );
  casualUsers = computed(() => this.users().filter((u) => u.role === 'guest'));

  private matches = computed(() => {
    const q = this.search().trim().toLocaleLowerCase('hu');
    return (u: MemberUser) =>
      !q ||
      u.name.toLocaleLowerCase('hu').includes(q) ||
      (u.email ?? '').toLocaleLowerCase('hu').includes(q);
  });
  filteredClubMembers = computed(() => this.clubMembers().filter(this.matches()));
  filteredCasualUsers = computed(() => this.casualUsers().filter(this.matches()));
  // Mindenki: every user, the suspended ones too.
  filteredEveryone = computed(() => this.users().filter(this.matches()));

  // Klubtagok's own columns for its people-table - this year's dues and
  // the Előzmény dot-row (templates in members.html).
  private yearCell = viewChild.required<TemplateRef<{ $implicit: MemberUser }>>('yearCell');
  private historyCell = viewChild.required<TemplateRef<{ $implicit: MemberUser }>>('historyCell');
  clubExtraColumns = computed<ExtraColumn[]>(() => [
    { header: String(this.currentMembershipYear()), width: '15%', cell: this.yearCell() },
    { header: 'Előzmény', width: '35%', cell: this.historyCell() },
  ]);

  me = computed(() => this.clubMembers().find((u) => u._id === this.myId()) ?? null);

  // Newest year first (membershipYears() itself), so index 0 is always
  // "this year" - drives the table's single always-visible status column.
  currentMembershipYear = computed(() => this.membershipYears()[0]);

  // Oldest-first, the order the mockup's dot-row reads left to right.
  historyYears = computed(() => [...this.membershipYears()].reverse());

  // Myself plus any other real club member (admin/member) sharing my own
  // familyId - who a membership payment can cover in one go (see
  // payMembership below). Mirrors tour.ts's isInMyPaymentGroup spirit for
  // dues instead of a tour advance.
  myFamilyClubMembers = computed(() => {
    const myFamilyId = this.auth.user()?.familyId;
    return this.clubMembers().filter(
      (u) => u._id === this.myId() || (!!myFamilyId && u.familyId === myFamilyId),
    );
  });

  // Whether the hero's pay button should show at all - not just the
  // caller's own dues, but anyone in their family, since paying covers
  // whoever's picked in the confirmation step below, not just "myself".
  hasUnpaidDues = computed(() => this.payBreakdown().length > 0);

  // True once the caller's own dues are all settled but a family member's
  // aren't - the button's label then says whose dues it's actually paying,
  // rather than (misleadingly) implying it's still the caller's own.
  payingOnlyForFamily = computed(() => {
    const mine = this.me();
    if (!mine || !this.hasUnpaidDues()) return false;
    return !this.payBreakdown().some((row) => row.userId === mine._id);
  });

  // The yearly fee table, set on Klub → Beállítások - loaded in ngOnInit;
  // 1000 Ft from 2019 until then, the club's long-standing fee.
  private membershipFees = signal<MembershipFee[]>([{ fromYear: 2019, amount: 1000 }]);

  // Every outstanding person+year pair across the family - one row per
  // unpaid year per member (not just each person's earliest), each at that
  // year's own fee (see membershipFees), oldest year first per person.
  // The confirmation step lets the payer pick exactly which of these to
  // actually include this time (see selectedPayIds below) - e.g. catching
  // up two unpaid years for themselves and one for a family member, all in
  // one payment.
  payBreakdown = computed(() => {
    const rows: { id: string; userId: string; name: string; year: number; amount: number }[] = [];
    const fees = this.membershipFees();
    for (const m of this.myFamilyClubMembers()) {
      for (const year of this.historyYears()) {
        const amount = feeForYear(fees, year);
        if (amount && this.yearState(m._id, year) === 'unpaid') {
          rows.push({ id: `${m._id}:${year}`, userId: m._id, name: m.name, year, amount });
        }
      }
    }
    return rows;
  });

  // Which of payBreakdown's rows are actually checked in the confirmation
  // dialog - starts with everyone checked (openPayConfirm below), same
  // "whole family by default" starting point as before, just now
  // adjustable rather than fixed.
  selectedPayIds = signal<Set<string>>(new Set());

  selectedPayTotal = computed(() =>
    this.payBreakdown()
      .filter((row) => this.selectedPayIds().has(row.id))
      .reduce((sum, row) => sum + row.amount, 0),
  );

  // What Barion will actually charge, once its own ~1.6% fee is added on
  // top (see BARION_FEE_RATE above) - rounded the same way the server
  // rounds it, so this matches exactly rather than drifting a forint off.
  selectedPayGrandTotal = computed(() =>
    Math.round(this.selectedPayTotal() * (1 + BARION_FEE_RATE)),
  );

  // Just the fee portion, derived from the two totals above rather than
  // computed separately, so it always reconciles exactly with them
  // (selectedPayTotal + selectedPayFee === selectedPayGrandTotal).
  selectedPayFee = computed(() => this.selectedPayGrandTotal() - this.selectedPayTotal());

  ngOnInit() {
    this.settingsService.getMembershipFees().subscribe({
      next: (res) => this.membershipFees.set(res.data.fees),
      error: () => {}, // keeps the default - the server charges the real fee anyway
    });
    this.membershipService.getMembers().subscribe({
      next: (res) => {
        this.users.set(res.data.users);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load members', err);
        this.loading.set(false);
      },
    });

    this.loadTransactions();

    if (this.returningPaymentId) {
      this.checkPaymentResult(this.returningPaymentId);
    }
  }

  private loadTransactions() {
    this.financeService.getTransactions().subscribe({
      next: (res) => {
        const map = new Map<string, Transaction>();
        for (const t of res.data.transactions) {
          if (t.type === 'income' && t.category === 'Tagdíj' && t.user && t.membershipYear) {
            map.set(`${t.user}:${t.membershipYear}`, t);
          }
        }
        this.paidTransactions.set(map);
      },
      error: (err) => console.error('Failed to load transactions for membership status', err),
    });
  }

  private checkPaymentResult(paymentId: string) {
    this.paymentService.getPaymentStatus(paymentId).subscribe({
      next: (res) => {
        if (res.data.status === 'Succeeded') {
          this.paymentNotice.set({ kind: 'success', text: 'A tagdíj befizetése sikeres volt.' });
          this.loadTransactions();
        } else {
          this.paymentNotice.set({
            kind: 'error',
            text: 'A fizetés nem fejeződött be (megszakítva vagy sikertelen volt).',
          });
        }
      },
      error: () => {
        this.paymentNotice.set({
          kind: 'error',
          text: 'A fizetés állapotát nem sikerült lekérdezni.',
        });
      },
    });
  }

  // Opens the confirmation step - the hero button no longer starts a
  // payment directly (see confirmPay below for what actually does).
  // Defaults to everyone selected, same starting point paying for the
  // whole family always used to be - the payer can uncheck anyone they
  // don't want to cover this time before confirming.
  openPayConfirm() {
    if (!this.hasUnpaidDues()) return;
    this.paymentNotice.set(null);
    this.selectedPayIds.set(new Set(this.payBreakdown().map((row) => row.id)));
    this.showPayConfirm.set(true);
  }

  closePayConfirm() {
    if (this.paying()) return;
    this.showPayConfirm.set(false);
  }

  togglePaySelection(id: string) {
    this.selectedPayIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  confirmPay() {
    const items = this.payBreakdown()
      .filter((row) => this.selectedPayIds().has(row.id))
      .map((row) => ({ userId: row.userId, year: row.year }));
    if (this.paying() || items.length === 0) return;

    this.paying.set(true);
    this.paymentNotice.set(null);
    this.paymentService.startMembershipPayment(items).subscribe({
      next: (res) => {
        // A full navigation, not a client-side route change - same as
        // payment.ts's own tour-advance flow, leaving the site entirely
        // for the gateway's own hosted page.
        window.location.href = res.data.gatewayUrl;
      },
      error: (err) => {
        this.paymentNotice.set({
          kind: 'error',
          text: err?.error?.message ?? 'Hiba történt a fizetés indítása során.',
        });
        this.paying.set(false);
        this.showPayConfirm.set(false);
      },
    });
  }

  selectTab(tab: 'club' | 'casual' | 'everyone') {
    this.activeTab.set(tab);
  }

  // One at a time - opens a member's row to show their year-by-year
  // payment history (amount/date) inline in the table: an admin anyone's,
  // a member their own (it replaced the "Saját befizetések" panel).
  canOpenRow = (p: { _id: string }) => this.isAdmin() || p._id === this.myId();

  toggleDetail(id: string) {
    if (!this.canOpenRow({ _id: id })) return;
    this.expandedMemberId.update((current) => (current === id ? null : id));
  }

  isExpanded(id: string): boolean {
    return this.expandedMemberId() === id;
  }

  // "6/7 év fizetve" - counts only years this person was actually eligible
  // for (excludes 'na' years before they joined), matching the dot-row
  // shown right beside it.
  historyFraction(userId: string): string {
    const relevant = this.historyYears()
      .map((y) => this.yearState(userId, y))
      .filter((state) => state !== 'na');
    const paidCount = relevant.filter((state) => state === 'paid').length;
    return `${paidCount}/${relevant.length}`;
  }

  // 'na': before this person's own memberSince (or, if that's not set yet,
  // treated as eligible for every tracked year). 'paid': a real Tagdíj
  // transaction exists for this member+year (see paidTransactions above).
  // 'unpaid': eligible, but no such transaction (yet).
  yearState(userId: string, year: number): 'paid' | 'unpaid' | 'na' {
    const user = this.clubMembers().find((u) => u._id === userId);
    if (user?.memberSince && year < user.memberSince) return 'na';
    return this.paidTransactions().has(`${userId}:${year}`) ? 'paid' : 'unpaid';
  }

  // The actual transaction backing a 'paid' year, for the detail panel's
  // date/amount line - undefined for 'unpaid'/'na' years.
  paymentFor(userId: string, year: number): Transaction | undefined {
    return this.paidTransactions().get(`${userId}:${year}`);
  }

  // --- Cash dues (admin): the $ button in the year column and the payment
  // history - records a year as paid in cash, or undoes a cash one. An
  // online payment can't be undone this way (the server refuses too).

  cashBusy = signal<string | null>(null); // "userId:year" in progress

  paidInCash(userId: string, year: number): boolean {
    return this.paymentFor(userId, year)?.paymentMethod === 'cash';
  }

  // Shown on an unpaid year, and on one paid in cash (to undo it).
  canToggleCash(userId: string, year: number): boolean {
    const state = this.yearState(userId, year);
    return this.isAdmin() && (state === 'unpaid' || this.paidInCash(userId, year));
  }

  toggleCashDues(m: MemberUser, year: number, event: Event) {
    event.stopPropagation(); // the row itself opens/closes the history
    const key = `${m._id}:${year}`;
    if (this.cashBusy()) return;
    this.cashBusy.set(key);
    const cashTx = this.paidInCash(m._id, year) ? this.paymentFor(m._id, year) : undefined;
    const request: Observable<unknown> = cashTx?.payment
      ? this.paymentService.deleteCashPayment(cashTx.payment)
      : this.paymentService.recordCashMembershipPayment(m._id, year);
    request.subscribe({
      next: () => {
        this.cashBusy.set(null);
        this.notifications.addSuccess(
          cashTx
            ? `${m.name} ${year}. évi készpénzes tagdíja visszavonva.`
            : `${m.name} ${year}. évi tagdíja készpénzben befizetve.`,
        );
        this.loadTransactions();
      },
      error: (err) => {
        this.cashBusy.set(null);
        this.notifications.addError(err?.error?.message ?? 'A művelet nem sikerült.');
      },
    });
  }

  money(amount: number, currency: TransactionCurrency = 'HUF') {
    return formatMoney(amount, currency);
  }

  // Admin-only "delete" - never actually removes anyone (see
  // userController.js's archiveUser), so restore is always one click away.
  // Confirmed in the app's shared dialog (shared/confirm-dialog).
  archivingId = signal<string | null>(null);

  async archive(u: MemberUser) {
    if (this.archivingId()) return;
    const ok = await this.confirm.ask({
      title: 'Felhasználó felfüggesztése',
      message: `Biztosan felfüggeszted: ${u.name}?`,
      detail: 'A korábbi adatai (táborok, tagdíjak) megmaradnak, és később visszaállítható.',
      confirmText: 'Felfüggesztés',
    });
    if (ok) this.setRetired(u, true);
  }

  restore(u: MemberUser) {
    if (this.archivingId()) return;
    this.setRetired(u, false);
  }

  private setRetired(u: MemberUser, retired: boolean) {
    this.archivingId.set(u._id);
    const request = retired
      ? this.userService.archiveUser(u._id)
      : this.userService.restoreUser(u._id);
    request.subscribe({
      next: () => {
        this.users.update((list) => list.map((x) => (x._id === u._id ? { ...x, retired } : x)));
        this.archivingId.set(null);
        this.notifications.addSuccess(
          retired ? `${u.name} felfüggesztve` : `${u.name} visszaállítva`,
        );
      },
      error: (err) => {
        this.notifications.addError(
          err?.error?.message ?? 'Nem sikerült módosítani a felhasználó állapotát.',
        );
        this.archivingId.set(null);
      },
    });
  }

  initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  myStatusSummary(): string {
    const mine = this.me();
    if (!mine) return 'Tagsági állapot';
    const unpaidCount = this.membershipYears().filter(
      (y) => this.yearState(mine._id, y) === 'unpaid',
    ).length;
    return unpaidCount ? `${unpaidCount} év befizetése hiányzik` : 'Minden tagdíjad rendezve';
  }
}
