import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

// How much smaller the text may get to stay on one line: a tenth - about
// three characters of an address. More than that, and it breaks into lines.
const SMALLEST = 0.9;

// Text that misses fitting its line by a character or two: made a little
// smaller so it stays on one line, rather than leaving those characters
// alone on a second one. For an element whose width is its place's, not
// its text's (a flex item that fills the rest of a row).
@Directive({ selector: '[appFitLine]' })
export class FitLine {
  private el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  // What it was last fitted to: making the text smaller changes the
  // element's height, which must not start another round.
  private fitted = '';

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.fit();
      // The font arriving changes how wide the text is.
      document.fonts?.ready.then(() => this.fit(true));
      if (typeof ResizeObserver === 'undefined') return;
      const sizes = new ResizeObserver(() => this.fit());
      sizes.observe(this.el);
      const texts = new MutationObserver(() => this.fit());
      texts.observe(this.el, { childList: true, characterData: true, subtree: true });
      destroyRef.onDestroy(() => {
        sizes.disconnect();
        texts.disconnect();
      });
    });
  }

  fit(again = false) {
    const { el } = this;
    const key = `${el.clientWidth}|${el.textContent}`;
    if (!again && key === this.fitted) return;
    this.fitted = key;

    // Measured on one line, at its own size.
    el.style.fontSize = '';
    el.style.whiteSpace = 'nowrap';
    const room = el.clientWidth;
    const needs = el.scrollWidth;
    const scale = needs > room && room > 0 ? room / needs : 1;
    if (scale < 1 && scale >= SMALLEST) {
      // A touch under, so rounding doesn't leave it a pixel too wide.
      el.style.fontSize = `${Math.floor(scale * 1000 - 5) / 1000}em`;
    } else {
      el.style.whiteSpace = '';
    }
  }
}
