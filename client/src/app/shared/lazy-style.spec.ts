import { TestBed } from '@angular/core/testing';

import { lazyStyle, lazyStyleReady } from './lazy-style';

// (test-setup.ts makes every added stylesheet link "load" at once.)
describe('lazyStyle', () => {
  const links = (name: string) =>
    [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter((l) =>
      l.getAttribute('href')?.startsWith(name),
    );

  it('adds the stylesheet once, before every other one, and is done when it is in', async () => {
    const other = document.createElement('style');
    document.head.append(other);

    const first = lazyStyle('quill');
    expect(lazyStyle('quill')).toBe(first);
    await first;
    await lazyStyle('quill');
    expect(links('quill').length).toBe(1);
    expect(links('quill')[0].getAttribute('href')).toBe('quill.css');
    // The app's own styles come after it, and keep overriding it.
    expect(
      links('quill')[0].compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    other.remove();
  });

  it('tells a map when its stylesheet is in - at once the second time', async () => {
    const ready = TestBed.runInInjectionContext(() => lazyStyleReady('photoswipe'));
    expect(ready()).toBe(false);
    await lazyStyle('photoswipe');
    await Promise.resolve();
    expect(ready()).toBe(true);
    expect(lazyStyleReady('photoswipe')()).toBe(true);
  });
});
