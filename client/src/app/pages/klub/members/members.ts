import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../../auth/auth.service';
import { MembershipService, MemberUser } from '../../../services/membership';
import { FinanceService, Transaction, TransactionCurrency } from '../../../services/finance';
import { PaymentService } from '../../../services/payment';

function formatMoney(amount: number, currency: TransactionCurrency = 'HUF'): string {
  const formatted = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 }).format(amount);
  return currency === 'EUR' ? `${formatted} €` : `${formatted} Ft`;
}

// The club has tracked membership dues since this year - the year strip
// and the per-member table both span from here to the current year,
// rather than an arbitrary fixed window.
const CLUB_FOUNDING_YEAR = 2019;

@Component({
  selector: 'app-members',
  imports: [DatePipe, RouterLink, MatIconModule],
  templateUrl: './members.html',
  styleUrl: './members.scss',
})
export class Members implements OnInit {
  private membershipService = inject(MembershipService);
  private financeService = inject(FinanceService);
  private paymentService = inject(PaymentService);
  private route = inject(ActivatedRoute);
  private auth = inject(AuthService);

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

  activeTab = signal<'club' | 'casual'>('club');
  clubSearch = signal('');
  casualSearch = signal('');
  selectedMemberId = signal<string | null>(null);

  // Set once the browser is redirected back from Stripe's Checkout page
  // (see the ?paymentId= query param, matching payment.ts's own
  // returningPaymentId convention).
  private returningPaymentId = this.route.snapshot.queryParamMap.get('paymentId');
  paying = signal(false);
  paymentNotice = signal<{ kind: 'success' | 'error'; text: string } | null>(null);

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

  filteredClubMembers = computed(() => {
    const q = this.clubSearch().trim().toLocaleLowerCase('hu');
    return this.clubMembers().filter((u) => u.name.toLocaleLowerCase('hu').includes(q));
  });

  filteredCasualUsers = computed(() => {
    const q = this.casualSearch().trim().toLocaleLowerCase('hu');
    return this.casualUsers().filter((u) => u.name.toLocaleLowerCase('hu').includes(q));
  });

  me = computed(() => this.clubMembers().find((u) => u._id === this.myId()) ?? null);

  // Myself plus any other real club member (admin/member) sharing my own
  // familyId - who a membership payment can cover in one go (see
  // payMembership below). Mirrors tour.ts's isInMyPaymentGroup spirit for
  // dues instead of a tour advance.
  myFamilyClubMembers = computed(() => {
    const mine = this.me();
    const myFamilyId = this.auth.user()?.familyId;
    return this.clubMembers().filter(
      (u) => u._id === this.myId() || (!!myFamilyId && u.familyId === myFamilyId),
    );
  });

  // The earliest year I personally haven't paid yet, or null if I'm fully
  // settled through the current year - drives the hero's pay button
  // (same "oldest unpaid first" rule as the demo's own openPay(year)).
  myEarliestUnpaidYear = computed(() => {
    const mine = this.me();
    if (!mine) return null;
    const years = [...this.membershipYears()].sort((a, b) => a - b);
    return years.find((y) => this.yearState(mine._id, y) === 'unpaid') ?? null;
  });

  // Every viewer (admin or plain member) starts out seeing their own dues
  // at the bottom, same as the demo; only admin can then switch it via
  // "Részletek →" (see selectMember below) - a plain member can never see
  // anyone else's payment breakdown, only the paid/unpaid status column.
  selectedMember = computed(() => {
    const id = this.isAdmin() ? this.selectedMemberId() : this.myId();
    return this.clubMembers().find((u) => u._id === id) ?? null;
  });

  ngOnInit() {
    this.membershipService.getMembers().subscribe({
      next: (res) => {
        this.users.set(res.data.users);
        this.selectedMemberId.set(this.myId());
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
        this.paymentNotice.set({ kind: 'error', text: 'A fizetés állapotát nem sikerült lekérdezni.' });
      },
    });
  }

  payMembership() {
    if (this.paying() || this.myEarliestUnpaidYear() == null) return;

    this.paying.set(true);
    this.paymentNotice.set(null);
    const userIds = this.myFamilyClubMembers().map((u) => u._id);
    this.paymentService.startMembershipPayment(userIds).subscribe({
      next: (res) => {
        // A full navigation, not a client-side route change - same as
        // payment.ts's own tour-advance flow, leaving the site entirely
        // for Stripe's hosted Checkout page.
        window.location.href = res.data.gatewayUrl;
      },
      error: (err) => {
        this.paymentNotice.set({
          kind: 'error',
          text: err?.error?.message ?? 'Hiba történt a fizetés indítása során.',
        });
        this.paying.set(false);
      },
    });
  }

  selectTab(tab: 'club' | 'casual') {
    this.activeTab.set(tab);
  }

  selectMember(id: string) {
    if (!this.isAdmin()) return;
    this.selectedMemberId.set(id);
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

  money(amount: number, currency: TransactionCurrency = 'HUF') {
    return formatMoney(amount, currency);
  }

  isActive(u: MemberUser): boolean {
    return !!u.lastLoginAt;
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
