import { Component, input } from '@angular/core';

export type PayMethodKey = 'cash' | 'card' | 'szep';

// How the rest of a tour's accommodation can be paid at the house (a
// tour's Fizetési módok) - each as a small card of the same size: a green
// banknote, a blue bank card, and the SZÉP kártya (our own drawing - the
// card issuers' logos are theirs): "SZÉP" with a thin red-white-green
// stripe. Sized by the host's width (height follows, 34:22).
@Component({
  selector: 'app-pay-method-icon',
  template: `
    <svg viewBox="0 0 34 22" aria-hidden="true">
      @switch (method()) {
        @case ('cash') {
          <rect
            x="0.75"
            y="0.75"
            width="32.5"
            height="20.5"
            rx="3"
            fill="#2e9e57"
            stroke="#23804a"
            stroke-width="1.5"
          />
          <rect
            x="3.5"
            y="3.5"
            width="27"
            height="15"
            rx="1.5"
            fill="none"
            stroke="#fff"
            stroke-opacity="0.45"
            stroke-width="0.8"
          />
          <circle cx="17" cy="11" r="5.2" fill="#fff" fill-opacity="0.92" />
          <!-- prettier-ignore -->
          <text x="17" y="13.4" text-anchor="middle" class="t" fill="#23804a" font-size="6.5">Ft</text>
          <circle cx="7" cy="11" r="1.3" fill="#fff" fill-opacity="0.6" />
          <circle cx="27" cy="11" r="1.3" fill="#fff" fill-opacity="0.6" />
        }
        @case ('card') {
          <rect
            x="0.75"
            y="0.75"
            width="32.5"
            height="20.5"
            rx="3.5"
            fill="#096396"
            stroke="#064b72"
            stroke-width="1.5"
          />
          <rect x="0.75" y="4.5" width="32.5" height="3.2" fill="#064b72" />
          <rect x="4.5" y="10" width="6.5" height="4.8" rx="1" fill="#f6c453" />
          <rect x="14" y="15.5" width="15" height="1.6" rx="0.8" fill="#fff" fill-opacity="0.75" />
        }
        @default {
          <rect
            x="0.75"
            y="0.75"
            width="32.5"
            height="20.5"
            rx="3.5"
            fill="#f07827"
            stroke="#c95f16"
            stroke-width="1.5"
          />
          <!-- prettier-ignore -->
          <text x="17" y="12.6" text-anchor="middle" class="t" fill="#fff" font-size="9.5" letter-spacing="0.4">SZÉP</text>
          <rect x="4" y="16" width="8.67" height="2" fill="#ce2939" />
          <rect x="12.67" y="16" width="8.67" height="2" fill="#fff" />
          <rect x="21.33" y="16" width="8.67" height="2" fill="#477050" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-block;
      width: 1.6rem;
      line-height: 0;
    }

    svg {
      width: 100%;
      height: auto;
      filter: drop-shadow(0 0.0625rem 0.0625rem rgba(0, 0, 0, 0.15));
    }

    .t {
      font-family: Arial, Helvetica, sans-serif;
      font-weight: 900;
    }
  `,
})
export class PayMethodIcon {
  method = input.required<PayMethodKey>();
}
