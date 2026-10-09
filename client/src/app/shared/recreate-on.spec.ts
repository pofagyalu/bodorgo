import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RecreateOn } from './recreate-on';

@Component({
  imports: [RecreateOn],
  template: `<span *appRecreateOn="score(); let s" class="score">{{ s }}{{ unit() }}</span>`,
})
class Host {
  score = signal<number | null>(501);
  unit = signal('');
}

describe('RecreateOn', () => {
  let fixture: ComponentFixture<Host>;
  const element = () => (fixture.nativeElement as HTMLElement).querySelector('.score')!;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('draws its element with the value', () => {
    expect(element().textContent).toBe('501');
  });

  it('makes a new element when the value changes - so what starts on a new one starts again', () => {
    const first = element();
    fixture.componentInstance.score.set(441);
    fixture.detectChanges();
    expect(element().textContent).toBe('441');
    expect(element()).not.toBe(first);
  });

  it('keeps the element while the value stays, whatever else changes in it', () => {
    const first = element();
    fixture.componentInstance.unit.set(' pont');
    fixture.detectChanges();
    expect(element()).toBe(first);
    expect(element().textContent).toBe('501 pont');
  });

  it('draws for an empty value too', () => {
    fixture.componentInstance.score.set(null);
    fixture.detectChanges();
    expect(element().textContent).toBe('');
  });

  it('says nothing on the console about it', () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    for (const score of [400, 300, 200]) {
      fixture.componentInstance.score.set(score);
      fixture.detectChanges();
    }
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
