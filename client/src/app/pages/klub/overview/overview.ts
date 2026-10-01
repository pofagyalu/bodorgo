import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MembershipService, MemberUser } from '../../../services/membership';
import { FinanceService, Transaction, TransactionCurrency } from '../../../services/finance';
import { SettingsService } from '../../../services/settings';
import { RingChart } from '../../../components/ring-chart/ring-chart';

const monthAndDay = new Intl.DateTimeFormat('hu-HU', { month: 'long', day: 'numeric' });

function formatMoney(amount: number, currency: TransactionCurrency = 'HUF'): string {
  const formatted = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 }).format(amount);
  return currency === 'EUR' ? `${formatted} €` : `${formatted} Ft`;
}

@Component({
  selector: 'app-klub-overview',
  imports: [RouterLink, DatePipe, RingChart],
  templateUrl: './overview.html',
  styleUrl: './overview.scss',
})
export class Overview implements OnInit {
  private membershipService = inject(MembershipService);
  private financeService = inject(FinanceService);
  private settingsService = inject(SettingsService);

  readonly currentYear = new Date().getFullYear();

  members = signal<MemberUser[]>([]);
  transactions = signal<Transaction[]>([]);

  clubMembers = computed(() =>
    this.members().filter((u) => u.role === 'admin' || u.role === 'member'),
  );

  // "március 1." - the day this year's fee is due by (the first Tagdíj
  // emlékeztető's day, see Klub → Beállítások). null until it arrives,
  // and for someone who may not read it.
  paymentDeadline = signal<string | null>(null);

  isEligible(u: MemberUser, year: number): boolean {
    return !u.memberSince || year >= u.memberSince;
  }

  // "userId:year" pairs backed by a real Tagdíj income transaction (see
  // server/src/models/transactionModel.js's user/membershipYear fields and
  // members.ts's identical logic).
  private paidPairs = computed(() => {
    const pairs = new Set<string>();
    for (const t of this.transactions()) {
      if (t.type === 'income' && t.category === 'Tagdíj' && t.user && t.membershipYear) {
        pairs.add(`${t.user}:${t.membershipYear}`);
      }
    }
    return pairs;
  });

  isPaid(u: MemberUser, year: number): boolean {
    return this.paidPairs().has(`${u._id}:${year}`);
  }

  eligibleThisYear = computed(() =>
    this.clubMembers().filter((m) => this.isEligible(m, this.currentYear)),
  );
  paidThisYear = computed(() =>
    this.eligibleThisYear().filter((m) => this.isPaid(m, this.currentYear)),
  );

  // "How much money does the club actually have right now" - all-time
  // income minus all-time expenses, not just this year's - a single
  // year's net flow (what used to be shown here) answers "how did this
  // year go," not "what do we have," which is the more useful number at
  // a glance.
  totalBalance = computed(() =>
    this.transactions().reduce((sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount), 0),
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
    this.settingsService.getMembershipFees().subscribe({
      next: (res) => {
        const deadline = res.data.paymentDeadline;
        if (deadline) {
          this.paymentDeadline.set(
            monthAndDay.format(new Date(this.currentYear, deadline.month - 1, deadline.day)),
          );
        }
      },
      error: (err) => console.error('Failed to load the payment deadline', err),
    });
  }

  money(amount: number, currency: TransactionCurrency = 'HUF') {
    return formatMoney(amount, currency);
  }
}
