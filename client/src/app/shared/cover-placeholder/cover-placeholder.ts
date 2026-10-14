import { Component, input } from '@angular/core';

// A tour's cover before it has one (or when it can't be loaded): a green
// panel with a tilted rubber-stamp "Hamarosan" - instead of a broken
// picture. It fills its box; the page gives it the cover's size and shape
// (its own classes on the host, e.g. the card's clip-path).
@Component({
  selector: 'app-cover-placeholder',
  template: `<span class="stamp">{{ text() }}</span>`,
  styleUrl: './cover-placeholder.scss',
  host: { role: 'img', '[attr.aria-label]': 'text()' },
})
export class CoverPlaceholder {
  text = input('Hamarosan');
}
