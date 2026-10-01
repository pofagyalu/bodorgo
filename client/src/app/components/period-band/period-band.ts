import {
  afterRenderEffect,
  Component,
  ElementRef,
  input,
  model,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';

export interface PeriodOption {
  value: string;
  label: string;
}

// How long the band has to rest before the one in the middle is taken as
// chosen - a swipe across several doesn't choose each on its way.
const SETTLE_MS = 120;
// A press that moved less than this is a click on an item, not a drag.
const DRAG_THRESHOLD_PX = 4;

// A choice of periods (years) on a band: swipe it, drag it with the mouse,
// or step with the arrows (the ones on screen or on the keyboard), and the
// one that comes to rest in the middle is chosen. Tapping one beside the
// middle brings it there. The band is a plain scrolling strip that snaps
// item by item - the sliding is the browser's own.
@Component({
  selector: 'app-period-band',
  templateUrl: './period-band.html',
  styleUrl: './period-band.scss',
})
export class PeriodBand implements OnDestroy {
  options = input.required<PeriodOption[]>();
  value = model.required<string>();
  label = input('');

  private band = viewChild.required<ElementRef<HTMLElement>>('band');

  // The item in the middle right now - ahead of `value` while the band is
  // still moving.
  centered = signal(0);
  dragging = signal(false);

  private settleTimer?: ReturnType<typeof setTimeout>;
  private placedOnce = false;
  private drag: { startX: number; startScroll: number; moved: boolean } | null = null;
  // The click that ends a drag isn't a choice of the item under it.
  private skipClick = false;

  constructor() {
    // Brings the chosen one to the middle: at once the first time, sliding
    // when the choice changes from outside (or the list itself does).
    afterRenderEffect(() => {
      const index = this.options().findIndex((o) => o.value === this.value());
      if (index < 0) return;
      this.centered.set(index);
      this.scrollToIndex(index, this.placedOnce ? 'smooth' : 'instant');
      this.placedOnce = true;
    });
  }

  ngOnDestroy() {
    clearTimeout(this.settleTimer);
  }

  private itemWidth(): number {
    return this.band().nativeElement.querySelector<HTMLElement>('.item')?.offsetWidth ?? 1;
  }

  private scrollToIndex(index: number, behavior: ScrollBehavior) {
    this.band().nativeElement.scrollTo({ left: index * this.itemWidth(), behavior });
  }

  onScroll() {
    const band = this.band().nativeElement;
    const last = this.options().length - 1;
    const index = Math.min(last, Math.max(0, Math.round(band.scrollLeft / this.itemWidth())));
    this.centered.set(index);
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      if (!this.drag) this.value.set(this.options()[this.centered()].value);
    }, SETTLE_MS);
  }

  step(by: number) {
    const index = this.centered() + by;
    if (index >= 0 && index < this.options().length) this.scrollToIndex(index, 'smooth');
  }

  pick(index: number) {
    if (this.skipClick) return;
    this.scrollToIndex(index, 'smooth');
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    this.step(event.key === 'ArrowLeft' ? -1 : 1);
  }

  // Dragging with the mouse - a finger scrolls the band by itself.
  onPointerDown(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    this.skipClick = false;
    this.drag = {
      startX: event.clientX,
      startScroll: this.band().nativeElement.scrollLeft,
      moved: false,
    };
  }

  onPointerMove(event: PointerEvent) {
    if (!this.drag) return;
    const dx = event.clientX - this.drag.startX;
    if (!this.drag.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    if (!this.drag.moved) {
      this.drag.moved = true;
      // Snapping is off while it follows the mouse (see the styles).
      this.dragging.set(true);
      this.band().nativeElement.setPointerCapture(event.pointerId);
    }
    this.band().nativeElement.scrollLeft = this.drag.startScroll - dx;
  }

  onPointerUp() {
    if (!this.drag) return;
    this.skipClick = this.drag.moved;
    this.drag = null;
    if (!this.skipClick) return;
    this.dragging.set(false);
    // Let go between two: slides on to the nearer one.
    this.scrollToIndex(this.centered(), 'smooth');
    this.onScroll();
  }
}
