// jsdom (used by the Vitest-based test runner) doesn't implement the
// Geolocation API. Stub it as a no-op so ForecastService's
// getCurrentPosition() call doesn't throw during component construction.
Object.defineProperty(window.navigator, 'geolocation', {
  value: {
    getCurrentPosition: () => {},
  },
  writable: true,
});

// jsdom has <audio>/<video> elements but can't play them: calling play(),
// pause() or load() only logs "Not implemented". Quiet no-ops instead; a
// spec that cares about playback spies on these.
window.HTMLMediaElement.prototype.play = async () => {};
window.HTMLMediaElement.prototype.pause = () => {};
window.HTMLMediaElement.prototype.load = () => {};

// jsdom has no matchMedia either (used for "prefers-reduced-motion" and the
// installed-app check). Nothing matches by default.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }) as MediaQueryList;
}

// jsdom has no 2D canvas: getContext() logs "Not implemented" and gives
// nothing. The same nothing, quietly - a chart then simply isn't drawn.
window.HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;

// jsdom lays nothing out, so it has neither ResizeObserver nor
// IntersectionObserver. Observers that never fire; a spec that needs one to
// fire puts its own in place with vi.stubGlobal.
class IdleObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
window.ResizeObserver ??= IdleObserver as unknown as typeof ResizeObserver;
window.IntersectionObserver ??= IdleObserver as unknown as typeof IntersectionObserver;
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView ??= () => {};

// No blob URLs in jsdom: a fixed stand-in, enough for "a preview was made".
URL.createObjectURL ??= () => 'blob:test';
URL.revokeObjectURL ??= () => {};

// jsdom's Range has no geometry; the rich text editor asks for it on focus.
const noBox = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 };
window.Range.prototype.getBoundingClientRect ??= () => ({ ...noBox, toJSON: () => noBox });
window.Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
