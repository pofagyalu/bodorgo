import { Directive, ElementRef, effect, inject, input, signal, untracked } from '@angular/core';

interface Point {
  x: number;
  y: number;
}

const DOUBLE_TAP_MS = 300;
const TAP_MOVE_PX = 10;

// A picture question's picture, looked at closer: two fingers zoom it in
// its box - the tiles over it too, so they keep covering the same parts -,
// one finger moves it about once it's bigger, a double tap puts it back.
// The rest of the page stays as it is. No smaller than the box, no further
// than the picture's own pixels (one to a point on the screen), never past
// its edges. On the box (the host); what moves is its first child. Back to
// the whole picture whenever `appPinchZoom` changes (the next question).
@Directive({
  selector: '[appPinchZoom]',
  host: {
    '(pointerdown)': 'down($event)',
    '(pointermove)': 'move($event)',
    '(pointerup)': 'up($event)',
    '(pointercancel)': 'up($event)',
    // Unzoomed, a finger on it still scrolls the page; zoomed, it moves the
    // picture. Never the browser's own zoom of the page.
    '[style.touch-action]': 'scale() > 1 ? "none" : "pan-y"',
  },
})
export class PinchZoom {
  private host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly resetOn = input<unknown>(null, { alias: 'appPinchZoom' });

  readonly scale = signal(1);
  private x = 0;
  private y = 0;

  private pointers = new Map<number, Point>();
  // Where the gesture began: the picture's place and size then, and the
  // fingers' middle and spread.
  private from = { scale: 1, x: 0, y: 0, mid: { x: 0, y: 0 }, spread: 1 };
  private tap: { at: number; start: Point; moved: boolean } | null = null;
  private lastTapAt = 0;

  constructor() {
    effect(() => {
      this.resetOn();
      untracked(() => this.reset());
    });
  }

  reset() {
    this.pointers.clear();
    this.apply(1, 0, 0);
  }

  down(e: PointerEvent) {
    this.host.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, this.local(e));
    if (this.pointers.size === 1) {
      this.tap = { at: e.timeStamp, start: this.local(e), moved: false };
    } else {
      this.tap = null;
    }
    this.begin();
  }

  move(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.tap && distance(p, this.tap.start) > TAP_MOVE_PX) this.tap.moved = true;

    const [a, b] = [...this.pointers.values()];
    if (b) {
      const mid = middle(a, b);
      const scale = this.clampScale((this.from.scale * distance(a, b)) / this.from.spread);
      // The spot of the picture under the fingers' middle stays under it.
      const spotX = (this.from.mid.x - this.from.x) / this.from.scale;
      const spotY = (this.from.mid.y - this.from.y) / this.from.scale;
      this.apply(scale, mid.x - spotX * scale, mid.y - spotY * scale);
      e.preventDefault();
    } else if (this.scale() > 1) {
      this.apply(
        this.scale(),
        this.from.x + a.x - this.from.mid.x,
        this.from.y + a.y - this.from.mid.y,
      );
      e.preventDefault();
    }
  }

  up(e: PointerEvent) {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size) {
      // One finger left of two: it moves the picture from here on.
      this.begin();
      return;
    }
    const tap = this.tap;
    this.tap = null;
    if (!tap || tap.moved || e.type === 'pointercancel') return;
    if (e.timeStamp - this.lastTapAt < DOUBLE_TAP_MS) {
      this.lastTapAt = 0;
      this.apply(1, 0, 0);
    } else {
      this.lastTapAt = e.timeStamp;
    }
  }

  private begin() {
    const [a, b] = [...this.pointers.values()];
    this.from = {
      scale: this.scale(),
      x: this.x,
      y: this.y,
      mid: b ? middle(a, b) : a,
      spread: b ? Math.max(1, distance(a, b)) : 1,
    };
  }

  // The most it may grow: until one pixel of the picture is one point on
  // the screen (object-fit: contain shows it at the smaller of the box's
  // two ratios to it).
  private maxScale() {
    const img = this.host.querySelector('img');
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!img?.naturalWidth || !img.naturalHeight || !w || !h) return 1;
    const shown = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    return Math.max(1, 1 / shown);
  }

  private clampScale(scale: number) {
    return Math.min(this.maxScale(), Math.max(1, scale));
  }

  // Never past its edges: the box is always full of picture.
  private apply(scale: number, x: number, y: number) {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.x = Math.min(0, Math.max(w - w * scale, x));
    this.y = Math.min(0, Math.max(h - h * scale, y));
    this.scale.set(scale);
    const content = this.host.firstElementChild as HTMLElement | null;
    if (content) {
      content.style.transform =
        scale === 1 ? '' : `translate(${this.x}px, ${this.y}px) scale(${scale})`;
    }
  }

  private local(e: PointerEvent): Point {
    const box = this.host.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
