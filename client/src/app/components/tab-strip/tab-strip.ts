import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';

export interface TabOption {
  value: string;
  label: string;
  // How many there are of it (e.g. a category's videos, or a tour's
  // "36/40" places taken) - shown beside the label.
  count?: number | string;
}

// How far from an end the row still counts as being at it.
const EDGE = 4;

// A page's tabs: one row of labels, the open one underlined - the same on
// a phone as on a wide screen. When they don't all fit, the row scrolls
// sideways under a finger (no arrows): the side with more tabs fades out,
// so it shows that there is more than what's on screen. The open tab is
// brought to the middle, with its neighbours beside it.
@Component({
  selector: 'app-tab-strip',
  templateUrl: './tab-strip.html',
  styleUrl: './tab-strip.scss',
})
export class TabStrip {
  // What the tabs choose between, for screen readers (e.g. "Kategória").
  label = input.required<string>();
  options = input.required<TabOption[]>();
  value = model.required<string>();
  // The tabs always fit the row (the page shares the row out among them -
  // the tour page): nothing scrolls, and no end is ever faded out.
  fit = input(false);

  private scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private ink = viewChild.required<ElementRef<HTMLElement>>('ink');
  // Tabs are left off screen on this side.
  moreBefore = signal(false);
  moreAfter = signal(false);
  // The first time the open tab is just there; later it slides.
  private shown = false;

  constructor() {
    afterRenderEffect(() => {
      this.options();
      this.value();
      this.placeInk(this.shown);
      this.showCurrent();
      this.measure();
    });

    // The row getting narrower or wider (a turned phone, a page that was
    // hidden) changes what fits - and where the open tab is.
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // The tabs' widths change once the page's own font is in - and with
      // them whether they all fit (the faded ends).
      document.fonts?.ready.then(() => {
        this.measure();
        this.placeInk(false);
      });
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => {
        this.measure();
        this.placeInk(false);
      });
      observer.observe(this.scroller().nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  measure() {
    if (this.fit()) return;
    const row = this.scroller().nativeElement;
    this.moreBefore.set(row.scrollLeft > EDGE);
    this.moreAfter.set(row.scrollLeft < row.scrollWidth - row.clientWidth - EDGE);
  }

  private showCurrent() {
    const row = this.scroller().nativeElement;
    const tab = row.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!tab || !row.clientWidth) return;
    row.scrollTo?.({
      left: tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2,
      behavior: this.shown ? 'smooth' : 'auto',
    });
    this.shown = true;
  }

  // The underline goes under the open tab, as wide as the tab - travelling
  // there from where it was, or (the first time, or when only the layout
  // changed) just put there.
  private placeInk(slide: boolean) {
    const row = this.scroller().nativeElement;
    const tab = row.querySelector<HTMLElement>('[aria-selected="true"]');
    const ink = this.ink().nativeElement;
    // No tab is open (a page above them all, like Futókörök's first one):
    // no underline.
    if (!tab) ink.style.width = '0';
    if (!tab || !row.clientWidth) return;
    ink.style.transition = slide ? '' : 'none';
    ink.style.transform = `translateX(${tab.offsetLeft}px)`;
    ink.style.width = `${tab.offsetWidth}px`;
  }
}
