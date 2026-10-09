import { blockPageZoom } from './page-zoom';

// No zooming the page while a Kvíz game is open - and a Leaflet map on it
// still zooms in itself.

describe('blockPageZoom', () => {
  let viewport: HTMLMetaElement;
  let page: HTMLElement;
  let onMap: HTMLElement;

  // A touch event with this many fingers down, sent from that element.
  function touch(type: string, from: Element, fingers: number) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: new Array(fingers).fill({}) });
    from.dispatchEvent(event);
    return event.defaultPrevented;
  }

  function gesture(type: string, from: Element) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    from.dispatchEvent(event);
    return event.defaultPrevented;
  }

  beforeEach(() => {
    viewport = document.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width, initial-scale=1';
    document.head.append(viewport);

    page = document.createElement('div');
    page.innerHTML = `<button>Válasz</button><div class="leaflet-container"><div class="pane"></div></div>`;
    document.body.append(page);
    onMap = page.querySelector('.pane')!;
  });

  afterEach(() => {
    viewport.remove();
    page.remove();
    document.documentElement.classList.remove('no-pinch-zoom');
  });

  it('tells the page not to scale, and marks the root for the styles', () => {
    const allow = blockPageZoom();
    expect(document.documentElement.classList.contains('no-pinch-zoom')).toBe(true);
    expect(viewport.content).toBe(
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
    );
    allow();
    expect(document.documentElement.classList.contains('no-pinch-zoom')).toBe(false);
    expect(viewport.content).toBe('width=device-width, initial-scale=1');
  });

  it('refuses a second finger anywhere on the page - one finger scrolls and taps as ever', () => {
    const button = page.querySelector('button')!;
    const allow = blockPageZoom();
    expect(touch('touchstart', button, 2)).toBe(true);
    expect(touch('touchmove', button, 2)).toBe(true);
    expect(touch('touchmove', document.body, 3)).toBe(true);
    expect(touch('touchstart', button, 1)).toBe(false);
    expect(touch('touchmove', button, 1)).toBe(false);
    // An iPhone's own pinch.
    expect(gesture('gesturestart', button)).toBe(true);
    expect(gesture('gesturechange', button)).toBe(true);
    allow();
  });

  it('leaves two fingers on a map to the map', () => {
    const allow = blockPageZoom();
    expect(touch('touchstart', onMap, 2)).toBe(false);
    expect(touch('touchmove', onMap, 2)).toBe(false);
    expect(gesture('gesturestart', onMap)).toBe(false);
    allow();
  });

  it('gives everything back once it is let go', () => {
    const button = page.querySelector('button')!;
    blockPageZoom()();
    expect(touch('touchmove', button, 2)).toBe(false);
    expect(gesture('gesturestart', button)).toBe(false);
  });

  it('works on a page without a viewport setting too', () => {
    viewport.remove();
    const allow = blockPageZoom();
    expect(touch('touchmove', page, 2)).toBe(true);
    expect(() => allow()).not.toThrow();
  });
});
