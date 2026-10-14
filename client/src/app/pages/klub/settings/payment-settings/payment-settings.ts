import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin, map } from 'rxjs';
import {
  PAYMENT_METHOD_NAMES,
  PaymentMethodKey,
  PaymentMethodSettings,
  PaymentMethods,
  SettingsService,
  paymentFee,
} from '../../../../services/settings';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { BankAccount } from '../bank-account/bank-account';
import { BarionWithdraw } from '../barion-withdraw/barion-withdraw';
import { StripePayoutCard } from '../stripe-payout/stripe-payout';

// Klub → Beállítások → Fizetések: the fee the payer pays on top
// (Átutalási díjak), the two bank accounts the money goes to - Tagdíjak and
// Előlegek, whichever gateway it came through (Kiutalási számlaadatok) - and
// paying out from Stripe and Barion to them (Kiutalás számlára). One of the
// settings page's tabs (settings.ts shows them; every tab stays in the DOM,
// only hidden).
@Component({
  selector: 'app-payment-settings',
  imports: [FormsModule, BankAccount, BarionWithdraw, StripePayoutCard],
  templateUrl: './payment-settings.html',
  styleUrl: './payment-settings.scss',
})
export class PaymentSettingsTab implements OnInit {
  private settingsService = inject(SettingsService);
  private notifications = inject(NotificationsService);

  ngOnInit() {
    this.loadPayMethods();
  }

  // --- Átutalási díjak: Stripe's and Barion's fee on top - both always on ---

  readonly payMethodKeys: PaymentMethodKey[] = ['stripe', 'barion'];
  readonly payMethodNames = PAYMENT_METHOD_NAMES;
  // What's saved, and the form - always switched on: there's no turning a
  // method off here, so one saved as off is switched on with the next Mentés.
  private payMethods = signal<PaymentMethods | null>(null);
  payForm = signal<PaymentMethods | null>(null);
  savingPay = signal(false);

  private loadPayMethods() {
    this.settingsService.getPaymentMethods().subscribe({
      next: (res) => {
        this.payMethods.set(res.data);
        this.payForm.set({
          stripe: { ...res.data.stripe, enabled: true },
          barion: { ...res.data.barion, enabled: true },
        });
      },
      error: () => {},
    });
  }

  payMethodDirty(key: PaymentMethodKey): boolean {
    return JSON.stringify(this.payMethods()?.[key]) !== JSON.stringify(this.payForm()?.[key]);
  }

  payDirty = computed(() => this.payMethodKeys.some((key) => this.payMethodDirty(key)));

  // A method saved as off - the next Mentés switches it on.
  payMethodOff(key: PaymentMethodKey): boolean {
    return this.payMethods()?.[key].enabled === false;
  }

  setPayField(key: PaymentMethodKey, field: 'feePercent' | 'feeFixed' | 'feeMin', value: unknown) {
    this.payForm.update(
      (form) => form && { ...form, [key]: { ...form[key], [field]: Number(value) } },
    );
  }

  // What a sum becomes with the fee in the form right now.
  payExample(key: PaymentMethodKey, sum: number): string {
    const method = this.payForm()?.[key];
    const total = method ? sum + paymentFee(sum, method) : sum;
    return new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 }).format(total);
  }

  resetPayMethods() {
    const saved = this.payMethods();
    if (!saved) return;
    this.payForm.set({
      stripe: { ...saved.stripe, enabled: true },
      barion: { ...saved.barion, enabled: true },
    });
  }

  // One Mentés for both: each changed method saved (the server keeps them
  // apart).
  savePayMethods() {
    const form = this.payForm();
    const keys = this.payMethodKeys.filter((key) => this.payMethodDirty(key));
    if (!form || !keys.length || this.savingPay()) return;
    this.savingPay.set(true);
    forkJoin(
      keys.map((key) =>
        this.settingsService
          .updatePaymentMethod(key, form[key])
          .pipe(map((res) => [key, res.data as PaymentMethodSettings] as const)),
      ),
    ).subscribe({
      next: (saved) => {
        for (const [key, method] of saved) {
          this.payMethods.update((all) => all && { ...all, [key]: method });
          this.payForm.update((all) => all && { ...all, [key]: { ...method, enabled: true } });
        }
        this.savingPay.set(false);
        this.notifications.addSuccess('Átutalási díjak mentve.');
      },
      error: (err) => {
        this.savingPay.set(false);
        this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
      },
    });
  }

  // --- Kiutalási számlaadatok: a saved bank account is told to the Barion
  // payout rows, which then ask again whether they can pay out ---

  accountsSaved = signal(0);
}
