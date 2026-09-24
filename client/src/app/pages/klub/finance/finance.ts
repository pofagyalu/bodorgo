import { Component, OnInit, inject, signal, computed, WritableSignal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../../auth/auth.service';
import {
  FinanceService,
  Transaction,
  TransactionType,
  TransactionCurrency,
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
} from '../../../services/finance';
import { PaymentService, WithdrawalPurpose } from '../../../services/payment';

// Mirrors utils/barion.js's own WITHDRAWAL_FEE_RATE/WITHDRAWAL_MIN_FEE
// server-side - shown here purely so the admin sees the real net amount
// before withdrawing; the server computes the authoritative figure itself.
const WITHDRAWAL_FEE_RATE = 0.001;
const WITHDRAWAL_MIN_FEE = 70;

function withdrawalFee(amount: number): number {
  return Math.max(Math.round(amount * WITHDRAWAL_FEE_RATE), WITHDRAWAL_MIN_FEE);
}

const MONTH_LABELS = [
  'jan', 'feb', 'márc', 'ápr', 'máj', 'jún', 'júl', 'aug', 'szept', 'okt', 'nov', 'dec',
];

function formatMoney(amount: number, currency: TransactionCurrency = 'HUF'): string {
  const formatted = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 }).format(amount);
  return currency === 'EUR' ? `${formatted} €` : `${formatted} Ft`;
}

function today(): string {
  return new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd, matches <input type="date">
}

@Component({
  selector: 'app-finance',
  imports: [DatePipe],
  templateUrl: './finance.html',
  styleUrl: './finance.scss',
})
export class Finance implements OnInit {
  private financeService = inject(FinanceService);
  private paymentService = inject(PaymentService);
  private auth = inject(AuthService);

  readonly incomeCategories = INCOME_CATEGORIES;
  readonly expenseCategories = EXPENSE_CATEGORIES;
  readonly monthLabels = MONTH_LABELS;

  isAdmin = computed(() => this.auth.user()?.role === 'admin');

  // Membership dues and tour advances collect into two separate Barion
  // wallets (see server/src/config.js's barion.membership/.tour) - each
  // withdraws independently to its own fixed bank account, hence two
  // parallel sets of signals rather than one generic "withdraw" state.
  // configured starts false and flips true once ngOnInit's status check
  // comes back - both start out unconfigured until real, live Barion
  // wallets exist (see paymentController.js's getWithdrawalStatus).
  membershipWithdrawConfigured = signal(false);
  membershipWithdrawAmount = signal<number | null>(null);
  membershipWithdrawing = signal(false);

  tourWithdrawConfigured = signal(false);
  tourWithdrawAmount = signal<number | null>(null);
  tourWithdrawing = signal(false);

  withdrawNotice = signal<{ kind: 'success' | 'error'; text: string } | null>(null);

  membershipWithdrawFee = computed(() => {
    const amount = this.membershipWithdrawAmount();
    return amount ? withdrawalFee(amount) : 0;
  });
  membershipWithdrawNet = computed(() => (this.membershipWithdrawAmount() ?? 0) - this.membershipWithdrawFee());

  tourWithdrawFee = computed(() => {
    const amount = this.tourWithdrawAmount();
    return amount ? withdrawalFee(amount) : 0;
  });
  tourWithdrawNet = computed(() => (this.tourWithdrawAmount() ?? 0) - this.tourWithdrawFee());

  transactions = signal<Transaction[]>([]);
  loading = signal(true);
  period = signal<string>(String(new Date().getFullYear()));

  showModal = signal(false);
  saving = signal(false);
  formError = signal<string | null>(null);

  formType = signal<TransactionType>('income');
  formDate = signal<string>(today());
  formName = signal('');
  formCategory = signal<string>(INCOME_CATEGORIES[0]);
  formAmount = signal<number | null>(null);
  formCurrency = signal<TransactionCurrency>('HUF');

  formCategoryOptions = computed(() =>
    this.formType() === 'income' ? this.incomeCategories : this.expenseCategories,
  );

  // Always includes the current year, even before any transaction exists
  // for it yet, so the page can default to it (see the period signal
  // above) instead of silently falling back to whichever past year
  // happens to have data.
  availablePeriods = computed(() => {
    const years = new Set(this.transactions().map((t) => t.date.slice(0, 4)));
    years.add(String(new Date().getFullYear()));
    return [...years].sort((a, b) => b.localeCompare(a));
  });

  filteredTransactions = computed(() => {
    const period = this.period();
    return this.transactions()
      .filter((t) => period === 'all' || t.date.startsWith(period))
      .sort((a, b) => b.date.localeCompare(a.date));
  });

  incomeTotal = computed(() =>
    this.filteredTransactions()
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0),
  );

  expenseTotal = computed(() =>
    this.filteredTransactions()
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0),
  );

  balance = computed(() => this.incomeTotal() - this.expenseTotal());

  monthlyChart = computed(() => {
    const months = Array.from({ length: 12 }, () => ({ income: 0, expense: 0 }));
    for (const t of this.filteredTransactions()) {
      const monthIndex = Number(t.date.slice(5, 7)) - 1;
      months[monthIndex][t.type] += t.amount;
    }
    const peak = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
    // A tiny minimum bar height keeps a genuinely small (but nonzero)
    // month visible instead of rounding down to nothing next to a much
    // larger peak - zero itself still renders as a flat 0%.
    const barPct = (value: number) => (value ? Math.max((value / peak) * 100, 2) : 0);
    return months.map((m, i) => ({
      label: this.monthLabels[i],
      income: m.income,
      expense: m.expense,
      incomePct: barPct(m.income),
      expensePct: barPct(m.expense),
    }));
  });

  categoryBreakdown = computed(() => {
    const totals = new Map<string, number>();
    for (const t of this.filteredTransactions().filter((x) => x.type === 'expense')) {
      totals.set(t.category, (totals.get(t.category) ?? 0) + t.amount);
    }
    const expenseTotal = this.expenseTotal();
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, amount]) => ({
        category,
        amount,
        pct: expenseTotal ? (amount / expenseTotal) * 100 : 0,
      }));
  });

  ngOnInit() {
    // period already defaults to the current year (see its own signal
    // above) and availablePeriods always includes it too, so no
    // post-load override is needed - the page opens on the current year
    // by default even before any transaction exists for it yet.
    this.financeService.getTransactions().subscribe({
      next: (res) => {
        this.transactions.set(res.data.transactions);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load transactions', err);
        this.loading.set(false);
      },
    });

    // Only admins ever see the withdraw panel at all (see finance.html's
    // own @if), but the status check itself is admin-only server-side too
    // (restrictTo('admin')) - so it'd 403 for anyone else regardless.
    if (this.isAdmin()) {
      this.paymentService.getWithdrawalStatus('membershipFee').subscribe({
        next: (res) => this.membershipWithdrawConfigured.set(res.data.configured),
        error: (err) => console.error('Failed to load membership withdrawal status', err),
      });
      this.paymentService.getWithdrawalStatus('tourAdvance').subscribe({
        next: (res) => this.tourWithdrawConfigured.set(res.data.configured),
        error: (err) => console.error('Failed to load tour withdrawal status', err),
      });
    }
  }

  money(amount: number, currency: TransactionCurrency = 'HUF') {
    return formatMoney(amount, currency);
  }

  // Shared by withdrawMembership/withdrawTour below - the two rows are
  // otherwise fully independent (own amount/busy signals, own wallet), but
  // the actual API call and success/error handling is identical either way.
  private runWithdrawal(purpose: WithdrawalPurpose, amount: number | null, busy: WritableSignal<boolean>, amountSignal: WritableSignal<number | null>) {
    if (!amount || amount <= 0 || busy()) return;

    busy.set(true);
    this.withdrawNotice.set(null);
    this.paymentService.withdraw(purpose, amount).subscribe({
      next: (res) => {
        this.withdrawNotice.set({
          kind: 'success',
          text: `Sikeres kiutalás: ${this.money(res.data.net)} nettó (${this.money(res.data.fee)} díj levonva).`,
        });
        amountSignal.set(null);
        busy.set(false);
      },
      error: (err) => {
        this.withdrawNotice.set({
          kind: 'error',
          text: err?.error?.message ?? 'Nem sikerült a kiutalás.',
        });
        busy.set(false);
      },
    });
  }

  withdrawMembership() {
    this.runWithdrawal('membershipFee', this.membershipWithdrawAmount(), this.membershipWithdrawing, this.membershipWithdrawAmount);
  }

  withdrawTour() {
    this.runWithdrawal('tourAdvance', this.tourWithdrawAmount(), this.tourWithdrawing, this.tourWithdrawAmount);
  }

  openModal() {
    this.formType.set('income');
    this.formDate.set(today());
    this.formName.set('');
    this.formCategory.set(INCOME_CATEGORIES[0]);
    this.formAmount.set(null);
    this.formCurrency.set('HUF');
    this.formError.set(null);
    this.saving.set(false);
    this.showModal.set(true);
  }

  closeModal() {
    if (this.saving()) return;
    this.showModal.set(false);
  }

  onTypeChange(type: TransactionType) {
    this.formType.set(type);
    this.formCategory.set(
      (type === 'income' ? this.incomeCategories : this.expenseCategories)[0],
    );
  }

  // Plain native (submit) rather than Angular's (ngSubmit) - the latter is
  // an output of the NgForm directive from FormsModule, which this
  // signal-driven form never imports, so it would silently never fire.
  onSubmit(event: Event) {
    event.preventDefault();
    this.submit();
  }

  submit() {
    const name = this.formName().trim();
    const amount = this.formAmount();
    if (!name || !amount || amount <= 0 || !this.formDate() || !this.formCategory()) {
      this.formError.set('Kérlek tölts ki minden mezőt.');
      return;
    }

    this.saving.set(true);
    this.formError.set(null);
    this.financeService
      .createTransaction({
        date: this.formDate(),
        name,
        type: this.formType(),
        category: this.formCategory(),
        amount,
        currency: this.formCurrency(),
      })
      .subscribe({
        next: (res) => {
          this.transactions.update((list) => [...list, res.data.transaction]);
          this.period.set(this.formDate().slice(0, 4));
          this.saving.set(false);
          this.showModal.set(false);
        },
        error: (err) => {
          console.error('Failed to save transaction', err);
          this.formError.set('Nem sikerült menteni a tételt.');
          this.saving.set(false);
        },
      });
  }
}
