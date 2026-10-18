import { Component, input } from '@angular/core';
import { LoadingSpinner } from '../../components/loading-spinner/loading-spinner';

// "It's on its way": the app's one look for anything loading - the
// logo-colour ring (components/loading-spinner) and what's coming.
// `<app-loading />` - a box, list or picker on a page that's otherwise
// there: a small ring, the text beside it. `size="large"` - a whole page
// (or its main part): a big ring, the text under it.
// `text` - "Betöltés..." unless it says what ("Tagok betöltése…").
@Component({
  selector: 'app-loading',
  imports: [LoadingSpinner],
  template: `<app-loading-spinner
      [size]="size() === 'large' ? '3rem' : '1.5rem'"
      [label]="text()"
    />
    <span>{{ text() }}</span>`,
  styleUrl: './loading.scss',
  host: { '[class.large]': "size() === 'large'" },
})
export class Loading {
  text = input('Betöltés...');
  size = input<'small' | 'large'>('small');
}
