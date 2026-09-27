import { AfterViewInit, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

// Masonry for a CSS grid of cards: each card, in order, goes into whichever
// column currently ends highest (not simply left-right-left-right), so no
// column is left with a big empty gap.
//
// The grid itself (in the page's stylesheet) has tiny rows and no row gap:
//   display: grid;
//   grid-template-columns: repeat(auto-fill, minmax(min(420px, 100%), 1fr));
//   grid-auto-rows: 1px;
//   column-gap: 18px;
// and this directive gives each card a row span as tall as the card (plus
// the column gap as spacing below it) - the grid's own placement then puts
// it into the first column with room. Re-measured whenever a card changes
// height (e.g. a list in it grows) or the grid's width changes.
@Directive({ selector: '[appMasonry]' })
export class Masonry implements AfterViewInit, OnDestroy {
  private grid = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private resize = new ResizeObserver(() => this.layout());
  // Cards added or removed (e.g. an @if showing one later).
  private mutations = new MutationObserver(() => this.observeCards());

  ngAfterViewInit() {
    this.observeCards();
    this.mutations.observe(this.grid, { childList: true });
  }

  ngOnDestroy() {
    this.resize.disconnect();
    this.mutations.disconnect();
  }

  private observeCards() {
    this.resize.disconnect();
    this.resize.observe(this.grid);
    for (const card of Array.from(this.grid.children)) this.resize.observe(card);
    this.layout();
  }

  private layout() {
    const style = getComputedStyle(this.grid);
    const row = parseFloat(style.gridAutoRows) || 1;
    const gap = parseFloat(style.columnGap) || 0;
    for (const card of Array.from(this.grid.children) as HTMLElement[]) {
      // align-self: start (below) keeps this the card's own height, not
      // the height of the rows it spans.
      const height = card.getBoundingClientRect().height;
      card.style.gridRowEnd = `span ${Math.ceil((height + gap) / row)}`;
    }
  }
}
