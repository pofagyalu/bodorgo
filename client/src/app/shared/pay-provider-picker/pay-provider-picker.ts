import { Component, computed, effect, inject, input, model, signal } from '@angular/core';
import {
  PAYMENT_METHOD_LOGOS,
  PAYMENT_METHOD_NAMES,
  PaymentMethodKey,
  PaymentMethods,
  PaymentWallet,
  SettingsService,
  paymentFee,
} from '../../services/settings';

// Which online gateway to pay with (Stripe or Barion) - both always shown,
// one switched off on Klub → Beállítások greyed out ("hamarosan"). Each
// shows the fee it adds to the sum being paid. The first one that's on is
// picked to start with; `fee` is the picked one's fee for the host's totals.
@Component({
  selector: 'app-pay-provider-picker',
  template: `
    <div class="providers" role="radiogroup" aria-label="Fizetési mód">
      @for (p of providers(); track p.key) {
        <button
          type="button"
          role="radio"
          class="provider"
          [class.provider--selected]="selected() === p.key"
          [attr.aria-checked]="selected() === p.key"
          [disabled]="!p.enabled || disabled()"
          (click)="selected.set(p.key)"
        >
          <span class="provider-logo">
            <img [src]="p.logo" [alt]="p.name" [class]="'logo-' + p.key" />
          </span>
          <span class="provider-note">
            @if (p.enabled) {
              bankkártya · díj: {{ p.fee }} Ft
            } @else {
              hamarosan
            }
          </span>
        </button>
      }
    </div>
    @if (loaded() && !selected()) {
      <p class="providers-none">Az online fizetés most nem érhető el.</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .providers {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.6rem;
    }

    .provider {
      display: grid;
      gap: 0.15rem;
      padding: 0.65rem 0.75rem;
      border: 0.125rem solid #dbe3df;
      border-radius: 0.6rem;
      background: #fff;
      color: #23354a;
      font: inherit;
      text-align: left;
      cursor: pointer;

      &:disabled {
        background: #f3f3f3;
        color: #9aa3a0;
        cursor: default;
      }
    }

    .provider--selected {
      border-color: #1a796c;
      background: #f1f8f5;
    }

    /* The official logos, unchanged (Barion's rules: its whole banner, not
       cropped, recoloured or faded - even when switched off). */
    .provider-logo {
      display: flex;
      align-items: center;
      height: 2.4rem;

      img {
        display: block;
        max-width: 100%;
      }
    }

    .logo-stripe {
      height: 2.4rem;
      margin-left: -0.5rem; /* the wordmark file's own empty margin */
    }

    .logo-barion {
      height: auto;
      max-height: 2.4rem;
    }

    .provider-note {
      font-size: 0.8rem;
    }

    .providers-none {
      margin: 0.5rem 0 0;
      color: #b00020;
      font-size: 0.9rem;
    }
  `,
})
export class PayProviderPicker {
  private settingsService = inject(SettingsService);

  // The sum being paid, before the fee, and what for - a gateway without an
  // account for it yet (Stripe for advances) is greyed out too.
  subtotal = input.required<number>();
  wallet = input.required<PaymentWallet>();
  disabled = input(false);
  // The picked gateway - null while loading, or when none is switched on.
  selected = model<PaymentMethodKey | null>(null);
  // The picked gateway's fee on the subtotal.
  fee = model(0);

  private methods = signal<PaymentMethods | null>(null);
  loaded = computed(() => this.methods() !== null);

  providers = computed(() => {
    const methods = this.methods();
    return (Object.keys(PAYMENT_METHOD_NAMES) as PaymentMethodKey[]).map((key) => ({
      key,
      name: PAYMENT_METHOD_NAMES[key],
      logo: PAYMENT_METHOD_LOGOS[key],
      enabled: !!methods?.[key]?.enabled && methods[key].wallets?.[this.wallet()] !== false,
      fee: methods?.[key] ? paymentFee(this.subtotal(), methods[key]) : 0,
    }));
  });

  constructor() {
    this.settingsService.getPaymentMethods().subscribe({
      next: (res) => {
        this.methods.set(res.data);
        this.selected.set(this.providers().find((p) => p.enabled)?.key ?? null);
      },
      error: () => this.methods.set({} as PaymentMethods),
    });
    effect(() => {
      const picked = this.providers().find((p) => p.key === this.selected());
      this.fee.set(picked?.fee ?? 0);
    });
  }
}
