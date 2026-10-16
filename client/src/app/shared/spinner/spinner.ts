import { Component, input } from '@angular/core';

// "Something is happening, wait": a turning ring in the text's own colour,
// for a button or a line that waits on the server -
// `<app-spinner />`, or `<app-spinner size="2rem" />` on its own.
// `label` is what a screen reader says instead.
@Component({
  selector: 'app-spinner',
  template: '',
  styleUrl: './spinner.scss',
  host: {
    role: 'status',
    '[attr.aria-label]': 'label()',
    '[style.--spinner-size]': 'size()',
  },
})
export class Spinner {
  size = input('1.125rem');
  label = input('Folyamatban…');
}
