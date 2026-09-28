import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { PaymentService } from '../../../../services/payment';
import { BarionWallet, BarionWalletKey, SettingsService } from '../../../../services/settings';

// Mirrors utils/barion.js's own WITHDRAWAL_FEE_RATE/WITHDRAWAL_MIN_FEE
// server-side - shown here purely so the admin sees the real net amount
// before withdrawing; the server computes the authoritative figure itself.
const WITHDRAWAL_FEE_RATE = 0.001;
const WITHDRAWAL_MIN_FEE = 70;

function withdrawalFee(amount: number): number {
  return Math.max(Math.round(amount * WITHDRAWAL_FEE_RATE), WITHDRAWAL_MIN_FEE);
}

// One Barion wallet's card on Beállítások (admins only, like the page) -
// Tagdíjak or Előlegek: where its payments land and which bank account
// its money goes to (editable; every change is e-mailed to all admins),
// and withdrawing to that account. The wallet's API key is a secret in the
// server's .env - without it the withdraw button stays inactive.
@Component({
  selector: 'app-barion-withdraw',
  imports: [FormsModule, MatIconModule],
  templateUrl: './barion-withdraw.html',
  styleUrl: './barion-withdraw.scss',
})
export class BarionWithdraw implements OnInit {
  private paymentService = inject(PaymentService);
  private settingsService = inject(SettingsService);

  wallet = input.required<BarionWalletKey>();
  title = computed(() => (this.wallet() === 'membership' ? 'Tagdíjak' : 'Előlegek'));
  private purpose = computed(() =>
    this.wallet() === 'membership' ? 'membershipFee' : 'tourAdvance',
  );

  // --- Its settings: shown, or edited ---

  account = signal<BarionWallet | null>(null);
  editing = signal(false);
  saving = signal(false);
  formError = signal<string | null>(null);
  form = { payeeEmail: '', withdrawName: '', withdrawIban: '' };

  startEdit() {
    const a = this.account();
    this.form = {
      payeeEmail: a?.payeeEmail ?? '',
      withdrawName: a?.withdrawName ?? '',
      withdrawIban: a?.withdrawIban ?? '',
    };
    this.formError.set(null);
    this.editing.set(true);
  }

  save() {
    if (this.saving()) return;
    this.saving.set(true);
    this.formError.set(null);
    this.settingsService.updateBarionWallet(this.wallet(), this.form).subscribe({
      next: (res) => {
        this.account.set(res.data);
        this.saving.set(false);
        this.editing.set(false);
        this.loadStatus(); // an account just set can make it withdrawable
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(err?.error?.message ?? 'A mentés nem sikerült.');
      },
    });
  }

  // --- Withdrawing ---

  // True once the server says both the bank account (here) and the API key
  // (.env) are set - see paymentController.js's getWithdrawalStatus.
  configured = signal(false);
  amount = signal<number | null>(null);
  withdrawing = signal(false);
  notice = signal<{ kind: 'success' | 'error'; text: string } | null>(null);

  fee = computed(() => {
    const amount = this.amount();
    return amount ? withdrawalFee(amount) : 0;
  });
  net = computed(() => (this.amount() ?? 0) - this.fee());

  ngOnInit() {
    this.settingsService.getBarionSettings().subscribe({
      next: (res) => this.account.set(res.data[this.wallet()]),
      error: (err) => console.error('Failed to load Barion settings', err),
    });
    this.loadStatus();
  }

  private loadStatus() {
    this.paymentService.getWithdrawalStatus(this.purpose()).subscribe({
      next: (res) => this.configured.set(res.data.configured),
      error: (err) => console.error('Failed to load withdrawal status', err),
    });
  }

  money(amount: number): string {
    return `${new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 }).format(amount)} Ft`;
  }

  withdraw() {
    const amount = this.amount();
    if (!amount || amount <= 0 || this.withdrawing()) return;

    this.withdrawing.set(true);
    this.notice.set(null);
    this.paymentService.withdraw(this.purpose(), amount).subscribe({
      next: (res) => {
        this.notice.set({
          kind: 'success',
          text: `Sikeres kiutalás: ${this.money(res.data.net)} nettó (${this.money(res.data.fee)} díj levonva).`,
        });
        this.amount.set(null);
        this.withdrawing.set(false);
      },
      error: (err) => {
        this.notice.set({
          kind: 'error',
          text: err?.error?.message ?? 'Nem sikerült a kiutalás.',
        });
        this.withdrawing.set(false);
      },
    });
  }
}
