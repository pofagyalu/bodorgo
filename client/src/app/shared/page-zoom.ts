// No zooming the page while this holds - not with two fingers, not with a
// double tap. For a screen where a zoomed-in page spoils things (a Kvíz
// game: a picture seen closer gives the answer away, a stray pinch loses
// the buttons). Returns what gives the zoom back.
//
// Three locks, because no single one holds on every phone:
// - the page's own setting (<meta name="viewport">): no scaling by the
//   user - which also brings an already zoomed page back to its size;
// - touch-action on the root (styles.scss's html.no-pinch-zoom): only
//   moving up-down and left-right;
// - a second finger's move is refused outright (and an iPhone's own
//   gesture events) - what an Android phone set to "always allow zoom"
//   still listens to.
//
// A map drawn by Leaflet stays zoomable in itself: it takes two fingers on
// it as its own (quiz-map), so those are left alone here.

const ROOT_CLASS = 'no-pinch-zoom';
const NO_SCALING = 'maximum-scale=1, user-scalable=no';
const OWN_ZOOM = '.leaflet-container';

const onOwnZoom = (event: Event) =>
  event.target instanceof Element && event.target.closest(OWN_ZOOM) !== null;

function refuseSecondFinger(event: TouchEvent) {
  if (event.touches.length > 1 && event.cancelable && !onOwnZoom(event)) event.preventDefault();
}

function refuseGesture(event: Event) {
  if (event.cancelable && !onOwnZoom(event)) event.preventDefault();
}

const TOUCHES = ['touchstart', 'touchmove'] as const;
const GESTURES = ['gesturestart', 'gesturechange'] as const;
// (Not passive: only then may a move be refused. Capture: before anything
// on the page takes it.)
const LISTEN = { passive: false, capture: true } as const;

export function blockPageZoom(): () => void {
  const root = document.documentElement;
  root.classList.add(ROOT_CLASS);

  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const before = viewport?.content ?? null;
  if (viewport) viewport.content = before ? `${before}, ${NO_SCALING}` : NO_SCALING;

  for (const type of TOUCHES) document.addEventListener(type, refuseSecondFinger, LISTEN);
  for (const type of GESTURES) document.addEventListener(type, refuseGesture, LISTEN);

  return () => {
    root.classList.remove(ROOT_CLASS);
    if (viewport && before !== null) viewport.content = before;
    for (const type of TOUCHES) document.removeEventListener(type, refuseSecondFinger, LISTEN);
    for (const type of GESTURES) document.removeEventListener(type, refuseGesture, LISTEN);
  };
}
