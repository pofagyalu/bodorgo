import { Signal, signal } from '@angular/core';

// The stylesheets of the libraries only some pages use - built as files of
// their own (angular.json: "inject": false), not as part of the styles
// every visit starts with.
export type LazyStyle = 'quill' | 'leaflet' | 'photoswipe';

const loading = new Map<LazyStyle, Promise<void>>();
const done = new Set<LazyStyle>();

// Loads a library's stylesheet the first time something needs it: Quill's
// with an editor, Leaflet's with a map, PhotoSwipe's with the photo viewer.
// Done once it is in (or couldn't be fetched - the feature still works,
// just plainer). It goes before every other stylesheet, where it was when
// it was part of the first one: the app's own rules keep overriding it.
export function lazyStyle(name: LazyStyle): Promise<void> {
  let ready = loading.get(name);
  if (!ready) {
    ready = new Promise<void>((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${name}.css`;
      link.onload = link.onerror = () => {
        done.add(name);
        resolve();
      };
      document.head.prepend(link);
    });
    loading.set(name, ready);
  }
  return ready;
}

// The same as a signal - true once the stylesheet is in (at once, if an
// earlier map already brought it): what is drawn in a render effect (a map)
// waits for it there.
export function lazyStyleReady(name: LazyStyle): Signal<boolean> {
  const ready = signal(done.has(name));
  if (!ready()) void lazyStyle(name).then(() => ready.set(true));
  return ready.asReadonly();
}
