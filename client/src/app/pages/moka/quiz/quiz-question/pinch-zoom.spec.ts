import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { PinchZoom } from './pinch-zoom';

// A picture question's picture, looked at closer (pinch-zoom.ts).

@Component({
  imports: [PinchZoom],
  template: `<div class="box" [appPinchZoom]="picture()">
    <div class="content"><img alt="" /></div>
  </div>`,
})
class Host {
  picture = signal('a');
}

describe('PinchZoom', () => {
  let box: HTMLElement;
  let content: HTMLElement;
  let zoom: PinchZoom;
  let host: Host;
  let at = 0;

  // Directly on the directive (the test browser's PointerEvent is thin).
  const ev = (id: number, x: number, y: number, type = 'pointermove') =>
    ({
      pointerId: id,
      clientX: x,
      clientY: y,
      timeStamp: (at += 50),
      type,
      preventDefault() {},
    }) as unknown as PointerEvent;

  function pinch(from: number, to: number) {
    zoom.down(ev(1, 200 - from, 150));
    zoom.down(ev(2, 200 + from, 150));
    zoom.move(ev(1, 200 - to, 150));
    zoom.move(ev(2, 200 + to, 150));
    zoom.up(ev(1, 200 - to, 150, 'pointerup'));
    zoom.up(ev(2, 200 + to, 150, 'pointerup'));
  }

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
    } as DOMRect);
    // A 1600 x 1200 picture in a 400 x 300 box: four times its size at most.
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1600);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(1200);
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    host = fixture.componentInstance;
    box = fixture.nativeElement.querySelector('.box');
    content = fixture.nativeElement.querySelector('.content');
    zoom = fixture.debugElement.children[0].injector.get(PinchZoom);
    TestBed.tick();
  });

  afterEach(() => vi.restoreAllMocks());

  it('two fingers zoom it - no further than its own pixels, no smaller than the box', () => {
    pinch(50, 100);
    expect(zoom.scale()).toBeCloseTo(2);
    expect(content.style.transform).toContain('scale(2)');
    pinch(10, 190); // as far apart as they go
    expect(zoom.scale()).toBe(4);
    pinch(190, 5);
    expect(zoom.scale()).toBe(1);
    expect(content.style.transform).toBe('');
  });

  it('one finger moves it once it is bigger - never past its edges', () => {
    pinch(50, 100);
    zoom.down(ev(1, 200, 150));
    zoom.move(ev(1, 2000, 2000)); // far right and down
    zoom.up(ev(1, 2000, 2000, 'pointerup'));
    expect(content.style.transform).toContain('translate(0px, 0px)');
    zoom.down(ev(1, 200, 150));
    zoom.move(ev(1, -5000, -5000));
    zoom.up(ev(1, -5000, -5000, 'pointerup'));
    // Twice the box: at most one box's width and height to the other way.
    expect(content.style.transform).toContain('translate(-400px, -300px)');
  });

  it('a double tap puts it back; so does the next question', () => {
    pinch(50, 100);
    zoom.down(ev(1, 100, 100));
    zoom.up(ev(1, 100, 100, 'pointerup'));
    zoom.down(ev(1, 100, 100));
    zoom.up(ev(1, 100, 100, 'pointerup'));
    expect(zoom.scale()).toBe(1);

    pinch(50, 100);
    host.picture.set('b');
    TestBed.tick();
    expect(zoom.scale()).toBe(1);
    expect(content.style.transform).toBe('');
  });

  it('a finger on it still scrolls the page until it is zoomed', () => {
    TestBed.tick();
    expect(box.style.touchAction).toBe('pan-y');
    pinch(50, 100);
    TestBed.tick();
    expect(box.style.touchAction).toBe('none');
  });
});
