// A tab's content coming in softly: fades in, without moving (the same
// as styles.scss's tab-panel-in) - for a page whose tabs only change what
// one list holds, so no new element arrives for a CSS animation to start
// on. Nothing where animations are turned off on the device.
export function fadeIn(element: HTMLElement | undefined) {
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  element?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
}

// A page turned: the new one slides in from the right (from: 1 - the next
// one) or from the left (-1 - the one before), fading in on the way. The
// animation is given back (to wait for its end) - none where animations
// are turned off on the device.
export function slideIn(element: HTMLElement | undefined, from: 1 | -1) {
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
  return element?.animate?.(
    [{ opacity: 0, transform: `translateX(${from * 4}rem)` }, { opacity: 1 }],
    { duration: 280, easing: 'ease-out' },
  );
}
