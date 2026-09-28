import { Component, OnInit, inject, signal, computed } from '@angular/core';
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

const MONTH_LABELS = [
  'jan',
  'feb',
  'márc',
  'ápr',
  'máj',
  'jún',
  'júl',
  'aug',
  'szept',
  'okt',
  'nov',
  'dec',
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
  private auth = inject(AuthService);

  readonly incomeCategories = INCOME_CATEGORIES;
  readonly expenseCategories = EXPENSE_CATEGORIES;
  readonly monthLabels = MONTH_LABELS;

  isAdmin = computed(() => this.auth.user()?.role === 'admin');

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
    // (Kiutalás Barionból moved to Beállítások - settings/barion-withdraw.)
  }

  money(amount: number, currency: TransactionCurrency = 'HUF') {
    return formatMoney(amount, currency);
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
    this.formCategory.set((type === 'income' ? this.incomeCategories : this.expenseCategories)[0]);
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
