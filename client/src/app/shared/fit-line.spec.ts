import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FitLine } from './fit-line';

@Component({
  imports: [FitLine],
  template: `<span appFitLine>Fő utca 12.</span>`,
})
class Host {}

describe('FitLine', () => {
  /** The text's element, as a browser would lay it out: this much room, this much needed. */
  function fitted(room: number, needs: number) {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('span') as HTMLElement;
    Object.defineProperties(el, {
      clientWidth: { value: room, configurable: true },
      scrollWidth: { value: needs, configurable: true },
    });
    fixture.debugElement.children[0].injector.get(FitLine).fit(true);
    return el.style;
  }

  it('leaves text that fits as it is', () => {
    const style = fitted(300, 280);
    expect(style.fontSize).toBe('');
    expect(style.whiteSpace).toBe('');
  });

  it('makes text a little smaller when it misses by a few characters', () => {
    const style = fitted(300, 315);
    expect(style.fontSize).toBe('0.947em');
    expect(style.whiteSpace).toBe('nowrap');
  });

  it('lets text that is much too long break into lines', () => {
    const style = fitted(300, 400);
    expect(style.fontSize).toBe('');
    expect(style.whiteSpace).toBe('');
  });
});
