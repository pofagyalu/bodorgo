import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MembershipService, MemberUser } from '../../../services/membership';
import { FinanceService, Transaction, TransactionCurrency } from '../../../services/finance';

// Same club-founding year as members.ts - kept in sync there since both
// pages independently compute the same per-year eligibility.
const CLUB_FOUNDING_YEAR = 2019;

function formatMoney(amount: number, currency: TransactionCurrency = 'HUF'): string {
  const formatted = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 }).format(amount);
  return currency === 'EUR' ? `${formatted} €` : `${formatted} Ft`;
}

@Component({
  selector: 'app-klub-overview',
  imports: [RouterLink, DatePipe],
  templateUrl: './overview.html',
  styleUrl: './overview.scss',
})
export class Overview implements OnInit {
  private membershipService = inject(MembershipService);
  private financeService = inject(FinanceService);

  readonly currentYear = new Date().getFullYear();

  members = signal<MemberUser[]>([]);
  transactions = signal<Transaction[]>([]);

  clubMembers = computed(() =>
    this.members().filter((u) => u.role === 'admin' || u.role === 'member'),
  );

  membershipYears = computed(() => {
    const years: number[] = [];
    for (let y = this.currentYear; y >= CLUB_FOUNDING_YEAR; y--) years.push(y);
    return years;
  });

  isEligible(u: MemberUser, year: number): boolean {
    return !u.memberSince || year >= u.memberSince;
  }

  // No real per-year payment records exist yet (see members.ts's identical
  // note) - every eligible member currently counts as unpaid.
  isPaid(_u: MemberUser, _year: number): boolean {
    return false;
  }

  eligibleThisYear = computed(() =>
    this.clubMembers().filter((m) => this.isEligible(m, this.currentYear)),
  );
  paidThisYear = computed(() => this.eligibleThisYear().filter((m) => this.isPaid(m, this.currentYear)));

  currentYearTransactions = computed(() =>
    this.transactions().filter((t) => t.date.startsWith(String(this.currentYear))),
  );
  netThisYear = computed(() =>
    this.currentYearTransactions().reduce(
      (sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount),
      0,
    ),
  );

  yearProgress = computed(() =>
    this.membershipYears().map((year) => {
      const due = this.clubMembers().filter((m) => this.isEligible(m, year));
      const done = due.filter((m) => this.isPaid(m, year));
      return {
        year,
        due: due.length,
        done: done.length,
        pct: due.length ? (done.length / due.length) * 100 : 0,
      };
    }),
  );

  recentActivity = computed(() =>
    [...this.transactions()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4),
  );

  ngOnInit() {
    this.membershipService.getMembers().subscribe({
      next: (res) => this.members.set(res.data.users),
      error: (err) => console.error('Failed to load members for overview', err),
    });
    this.financeService.getTransactions().subscribe({
      next: (res) => this.transactions.set(res.data.transactions),
      error: (err) => console.error('Failed to load transactions for overview', err),
    });
  }

  money(amount: number, currency: TransactionCurrency = 'HUF') {
    return formatMoney(amount, currency);
  }
}
