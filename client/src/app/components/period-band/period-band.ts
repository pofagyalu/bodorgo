import {
  afterNextRender,
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  input,
  model,
  OnDestroy,
  signal,
  untracked,
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
// The vertical wheel is calmer than its small items would make it: the
// mouse wheel moves it one item at a time, at most this often, and a drag
// moves it by half of what the mouse travels.
const WHEEL_STEP_MS = 280;
const VERTICAL_DRAG_RATIO = 0.5;

// A choice of periods (years) on a band: swipe it, drag it with the mouse,
// or step with the arrows (the ones on screen or on the keyboard), and the
// one that comes to rest in the middle is chosen. Tapping one beside the
// middle brings it there. The band is a plain scrolling strip that snaps
// item by item - the sliding is the browser's own.
//
// `vertical`: a wheel instead - one item high, the neighbors peeking in
// above and below, rolled up and down (the mouse wheel rolls it too); no
// arrows on screen.
@Component({
  selector: 'app-period-band',
  host: { '[class.vertical]': 'vertical()' },
  templateUrl: './period-band.html',
  styleUrl: './period-band.scss',
})
export class PeriodBand implements OnDestroy {
  options = input.required<PeriodOption[]>();
  value = model.required<string>();
  label = input('');
  vertical = input(false);
  // Goes round: after the last option the first one follows again (and
  // the last before the first).
  loop = input(false);

  // What is on the band. Looping, the options are there three times over:
  // the band rests in the middle copy and so always has neighbors on both
  // sides; resting in an outer copy, it jumps (unseen - the copies look the
  // same) to the same option in the middle one.
  items = computed(() => {
    const options = this.options();
    return this.loop() ? [...options, ...options, ...options] : options;
  });

  private band = viewChild.required<ElementRef<HTMLElement>>('band');

  // The item in the middle right now - ahead of `value` while the band is
  // still moving.
  centered = signal(0);
  dragging = signal(false);

  private settleTimer?: ReturnType<typeof setTimeout>;
  private placedOnce = false;
  private drag: { start: number; startScroll: number; moved: boolean } | null = null;
  // The click that ends a drag isn't a choice of the item under it.
  private skipClick = false;
  private lastWheelStep = 0;

  constructor() {
    // Brings the chosen one to the middle: at once the first time, sliding
    // when the choice changes from outside (or the list itself does).
    afterRenderEffect(() => {
      const option = this.options().findIndex((o) => o.value === this.value());
      if (option < 0) return;
      // Already in the middle (the choice came from the band itself): it
      // stays where it is.
      if (this.placedOnce && this.items()[untracked(this.centered)]?.value === this.value()) {
        return;
      }
      const index = this.loop() ? this.options().length + option : option;
      this.centered.set(index);
      this.scrollToIndex(index, this.placedOnce ? 'smooth' : 'instant');
      this.placedOnce = true;
    });

    // The mouse wheel over the vertical wheel: one item per notch, instead
    // of the browser's own scroll (which flew past several). Not passive -
    // it has to stop that scroll - so it's added by hand.
    afterNextRender(() => {
      this.band().nativeElement.addEventListener(
        'wheel',
        (event) => {
          if (!this.vertical()) return;
          event.preventDefault();
          const now = Date.now();
          if (now - this.lastWheelStep < WHEEL_STEP_MS) return;
          this.lastWheelStep = now;
          this.step(event.deltaY > 0 ? 1 : -1);
        },
        { passive: false },
      );
    });
  }

  ngOnDestroy() {
    clearTimeout(this.settleTimer);
  }

  // An item's size along the band, and how far the band is scrolled.
  private itemSize(): number {
    const item = this.band().nativeElement.querySelector<HTMLElement>('.item');
    return (this.vertical() ? item?.offsetHeight : item?.offsetWidth) || 1;
  }

  private scrolled(): number {
    const band = this.band().nativeElement;
    return this.vertical() ? band.scrollTop : band.scrollLeft;
  }

  private scrollToIndex(index: number, behavior: ScrollBehavior) {
    const to = index * this.itemSize();
    this.band().nativeElement.scrollTo(
      this.vertical() ? { top: to, behavior } : { left: to, behavior },
    );
  }

  onScroll() {
    const last = this.items().length - 1;
    const index = Math.min(last, Math.max(0, Math.round(this.scrolled() / this.itemSize())));
    this.centered.set(index);
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      if (this.drag) return;
      this.value.set(this.items()[this.centered()].value);
      this.backToMiddleCopy();
    }, SETTLE_MS);
  }

  // Looping: at rest in the first or the last copy, over to the same
  // option in the middle one - there's always more to roll to both ways.
  private backToMiddleCopy() {
    const count = this.options().length;
    const index = this.centered();
    if (!this.loop() || !count || (index >= count && index < 2 * count)) return;
    const middle = count + (index % count);
    this.centered.set(middle);
    this.scrollToIndex(middle, 'instant');
  }

  step(by: number) {
    const index = this.centered() + by;
    if (index >= 0 && index < this.items().length) this.scrollToIndex(index, 'smooth');
  }

  pick(index: number) {
    if (this.skipClick) return;
    this.scrollToIndex(index, 'smooth');
  }

  onKeydown(event: KeyboardEvent) {
    const [back, forward] = this.vertical()
      ? ['ArrowUp', 'ArrowDown']
      : ['ArrowLeft', 'ArrowRight'];
    if (event.key !== back && event.key !== forward) return;
    event.preventDefault();
    this.step(event.key === back ? -1 : 1);
  }

  // Dragging with the mouse - a finger scrolls the band by itself.
  onPointerDown(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    this.skipClick = false;
    this.drag = {
      start: this.vertical() ? event.clientY : event.clientX,
      startScroll: this.scrolled(),
      moved: false,
    };
  }

  onPointerMove(event: PointerEvent) {
    if (!this.drag) return;
    const moved = (this.vertical() ? event.clientY : event.clientX) - this.drag.start;
    if (!this.drag.moved && Math.abs(moved) < DRAG_THRESHOLD_PX) return;
    if (!this.drag.moved) {
      this.drag.moved = true;
      // Snapping is off while it follows the mouse (see the styles).
      this.dragging.set(true);
      this.band().nativeElement.setPointerCapture(event.pointerId);
    }
    const to = this.drag.startScroll - moved * (this.vertical() ? VERTICAL_DRAG_RATIO : 1);
    if (this.vertical()) this.band().nativeElement.scrollTop = to;
    else this.band().nativeElement.scrollLeft = to;
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
