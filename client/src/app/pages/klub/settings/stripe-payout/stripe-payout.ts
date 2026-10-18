import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FreshLoginService } from '../../../../auth/fresh-login.service';
import { PaymentService, StripePayout, StripePayoutState } from '../../../../services/payment';
import { PaymentWallet } from '../../../../services/settings';

import { Loading } from '../../../../shared/loading/loading';
const STATUS_LABELS: Record<StripePayout['status'], string> = {
  paid: 'megérkezett',
  pending: 'elindítva',
  in_transit: 'úton a bankba',
  canceled: 'visszavonva',
  failed: 'sikertelen',
};

// One Stripe account's row on the Kiutalás számlára card (Beállítások →
// Fizetések) - Tagdíjak or Előlegek: the money paid by card that Stripe
// holds, and paying it out to the account's bank account. That bank account
// is set in the Stripe Dashboard, never here - this row only shows it.
// Hidden while the account has no key on the server (Előlegek, until it has
// its own).
@Component({
  selector: 'app-stripe-payout',
  imports: [Loading, DatePipe],
  templateUrl: './stripe-payout.html',
  styleUrls: ['../barion-withdraw/barion-withdraw.scss', './stripe-payout.scss'],
  host: { '[hidden]': '!configured()' },
})
export class StripePayoutCard implements OnInit {
  private paymentService = inject(PaymentService);
  private freshLogin = inject(FreshLoginService);

  wallet = input.required<PaymentWallet>();
  title = computed(() => (this.wallet() === 'membership' ? 'Tagdíjak' : 'Előlegek'));

  state = signal<StripePayoutState | null>(null);
  loadError = signal(false);
  configured = computed(() => !!this.state()?.configured || this.loadError());

  available = computed(() => this.state()?.available ?? 0);
  minPayout = computed(() => this.state()?.minPayout ?? 360);
  // Stripe also pays out by itself unless its schedule is manual.
  automatic = computed(() => {
    const schedule = this.state()?.schedule;
    return !!schedule && schedule !== 'manual';
  });

  amount = signal<number | null>(null);
  paying = signal(false);
  notice = signal<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Why the amount can't be paid out - shown under the field.
  amountProblem = computed(() => {
    const amount = this.amount();
    if (!amount) return null;
    if (!Number.isInteger(amount)) return 'Egész forintot adj meg.';
    if (amount < this.minPayout()) return `Legalább ${this.money(this.minPayout())}.`;
    if (amount > this.available()) return `Legfeljebb ${this.money(this.available())}.`;
    return null;
  });
  canPay = computed(() => !!this.amount() && !this.amountProblem() && !this.paying());

  ngOnInit() {
    this.load();
  }

  private load() {
    this.paymentService.getStripePayouts(this.wallet()).subscribe({
      next: (res) => {
        this.state.set(res.data);
        this.loadError.set(false);
      },
      error: () => this.loadError.set(true),
    });
  }

  money(amount: number): string {
    return `${new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 }).format(amount)} Ft`;
  }

  statusLabel(status: StripePayout['status']): string {
    return STATUS_LABELS[status] ?? status;
  }

  async payOut() {
    const amount = this.amount();
    if (!amount || !this.canPay()) return;
    if (!(await this.freshLogin.ensure('Kiutalás a számlára'))) return;
    // A second click got this far meanwhile: one payout only.
    if (this.paying()) return;

    this.paying.set(true);
    this.notice.set(null);
    this.paymentService.createStripePayout(this.wallet(), amount).subscribe({
      next: () => {
        this.notice.set({
          kind: 'success',
          text: `Kiutalás elindítva: ${this.money(amount)}. 1–4 munkanap alatt érkezik meg a bankszámlára.`,
        });
        this.amount.set(null);
        this.paying.set(false);
        this.load();
      },
      error: (err) => {
        this.notice.set({
          kind: 'error',
          text: err?.error?.message ?? 'Nem sikerült a kiutalás.',
        });
        this.paying.set(false);
      },
    });
  }
}
