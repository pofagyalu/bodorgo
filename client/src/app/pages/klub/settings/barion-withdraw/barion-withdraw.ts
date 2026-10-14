import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FreshLoginService } from '../../../../auth/fresh-login.service';
import { PaymentService, WithdrawalStatusResponse } from '../../../../services/payment';
import { BarionWalletKey } from '../../../../services/settings';

// Mirrors utils/barion.js's own WITHDRAWAL_FEE_RATE/WITHDRAWAL_MIN_FEE
// server-side - shown here purely so the admin sees the real net amount
// before withdrawing; the server computes the authoritative figure itself.
const WITHDRAWAL_FEE_RATE = 0.001;
const WITHDRAWAL_MIN_FEE = 70;

function withdrawalFee(amount: number): number {
  return Math.max(Math.round(amount * WITHDRAWAL_FEE_RATE), WITHDRAWAL_MIN_FEE);
}

// One Barion wallet's row on the Kiutalás számlára card (Beállítások →
// Fizetések) - Tagdíjak or Előlegek: its balance, and withdrawing to its
// bank account (set on the Kiutalási számlaadatok card). The wallet's API
// key is a secret in the server's .env - without it the withdraw button
// stays inactive and there is no balance to show.
@Component({
  selector: 'app-barion-withdraw',
  templateUrl: './barion-withdraw.html',
  styleUrl: './barion-withdraw.scss',
})
export class BarionWithdraw {
  private paymentService = inject(PaymentService);
  private freshLogin = inject(FreshLoginService);

  wallet = input.required<BarionWalletKey>();
  // Bumped by the page when a bank account was saved: asked again whether
  // the wallet can pay out.
  refresh = input(0);
  title = computed(() => (this.wallet() === 'membership' ? 'Tagdíjak' : 'Előlegek'));
  private purpose = computed(() =>
    this.wallet() === 'membership' ? 'membershipFee' : 'tourAdvance',
  );

  // What the server says (paymentController.js's getWithdrawalStatus):
  // configured once both the bank account and the API key are set.
  status = signal<WithdrawalStatusResponse['data'] | null>(null);
  configured = computed(() => !!this.status()?.configured);
  balance = computed(() => this.status()?.balance ?? null);

  amount = signal<number | null>(null);
  withdrawing = signal(false);
  notice = signal<{ kind: 'success' | 'error'; text: string } | null>(null);

  fee = computed(() => {
    const amount = this.amount();
    return amount ? withdrawalFee(amount) : 0;
  });
  net = computed(() => (this.amount() ?? 0) - this.fee());

  constructor() {
    effect(() => {
      this.refresh();
      this.loadStatus();
    });
  }

  private loadStatus() {
    this.paymentService.getWithdrawalStatus(this.purpose()).subscribe({
      next: (res) => this.status.set(res.data),
      error: (err) => console.error('Failed to load withdrawal status', err),
    });
  }

  money(amount: number): string {
    return `${new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 }).format(amount)} Ft`;
  }

  async withdraw() {
    const amount = this.amount();
    if (!amount || amount <= 0 || this.withdrawing()) return;
    if (!(await this.freshLogin.ensure('Kiutalás a számlára'))) return;
    // A second click got this far meanwhile: one payout only.
    if (this.withdrawing()) return;

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
        this.loadStatus(); // the balance after it
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
