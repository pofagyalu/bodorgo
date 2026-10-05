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
import { MatIconModule } from '@angular/material/icon';

export interface TabOption {
  value: string;
  label: string;
  // How many there are of it (e.g. a category's videos) - shown beside
  // the label.
  count?: number;
}

// How far from an end the row still counts as being at it.
const EDGE = 4;

// A page's tabs: one row of labels, the open one underlined - the same on
// a phone as on a wide screen. When they don't all fit, the row scrolls
// sideways (a finger, or the arrows): the side with more tabs fades out
// under an arrow, so it shows that there is more than what's on screen.
// The open tab is brought to the middle, with its neighbours beside it.
@Component({
  selector: 'app-tab-strip',
  imports: [MatIconModule],
  templateUrl: './tab-strip.html',
  styleUrl: './tab-strip.scss',
})
export class TabStrip {
  // What the tabs choose between, for screen readers (e.g. "Kategória").
  label = input.required<string>();
  options = input.required<TabOption[]>();
  value = model.required<string>();

  private scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  // Tabs are left off screen on this side.
  moreBefore = signal(false);
  moreAfter = signal(false);
  // The first time the open tab is just there; later it slides.
  private shown = false;

  constructor() {
    afterRenderEffect(() => {
      this.options();
      this.value();
      this.showCurrent();
      this.measure();
    });

    // The row getting narrower or wider (a turned phone, a page that was
    // hidden) changes what fits.
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => this.measure());
      observer.observe(this.scroller().nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  measure() {
    const row = this.scroller().nativeElement;
    this.moreBefore.set(row.scrollLeft > EDGE);
    this.moreAfter.set(row.scrollLeft < row.scrollWidth - row.clientWidth - EDGE);
  }

  // The arrows: most of a screenful that way.
  page(direction: -1 | 1) {
    const row = this.scroller().nativeElement;
    row.scrollBy?.({ left: direction * row.clientWidth * 0.7, behavior: 'smooth' });
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
}
