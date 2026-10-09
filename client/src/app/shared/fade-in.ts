// A tab's content coming in softly: fades in, without moving (the same
// as styles.scss's tab-panel-in) - for a page whose tabs only change what
// one list holds, so no new element arrives for a CSS animation to start
// on. Nothing where animations are turned off on the device.
export function fadeIn(element: HTMLElement | undefined) {
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  element?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
}
