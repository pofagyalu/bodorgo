import { Component, input } from '@angular/core';

// "A page is on its way": a ring turning round, the logo's green flowing
// into orange and blue towards its head, its tail fading away behind it -
// for a whole page or a big part of one. `<app-loading-spinner />`, or with
// `size="1.5rem"`; `label` is what a screen reader says.
@Component({
  selector: 'app-loading-spinner',
  template: '<span class="ring"></span>',
  styleUrls: ['./loading-spinner.scss'],
  host: {
    role: 'status',
    '[attr.aria-label]': 'label()',
    '[style.--ring-size]': 'size()',
  },
})
export class LoadingSpinner {
  size = input('3rem');
  label = input('Betöltés');
}
