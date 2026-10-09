import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TabStrip } from './tab-strip';

describe('TabStrip', () => {
  let fixture: ComponentFixture<TabStrip>;
  let strip: TabStrip;
  let row: HTMLElement;

  const tabs = () => [...fixture.nativeElement.querySelectorAll('[role="tab"]')] as HTMLElement[];
  const arrows = () =>
    [...fixture.nativeElement.querySelectorAll('.arrow')].map((a: HTMLElement) => a.className);

  /** The row as a browser would lay it out: this wide, with this much in it. */
  function layOut(clientWidth: number, scrollWidth: number, scrollLeft = 0) {
    Object.defineProperties(row, {
      clientWidth: { value: clientWidth, configurable: true },
      scrollWidth: { value: scrollWidth, configurable: true },
      scrollLeft: { value: scrollLeft, configurable: true, writable: true },
    });
    row.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    fixture = TestBed.createComponent(TabStrip);
    strip = fixture.componentInstance;
    fixture.componentRef.setInput('label', 'Kategória');
    fixture.componentRef.setInput('options', [
      { value: 'all', label: 'Összes', count: 12 },
      { value: 'a', label: 'Szilveszter', count: 0 },
      { value: 'b', label: 'Farsang' },
    ]);
    fixture.componentRef.setInput('value', 'all');
    fixture.detectChanges();
    row = fixture.nativeElement.querySelector('[role="tablist"]');
  });

  it('shows every tab, the open one marked, each with its count', () => {
    expect(row.getAttribute('aria-label')).toBe('Kategória');
    expect(tabs().map((t) => t.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Összes 12',
      'Szilveszter 0',
      'Farsang',
    ]);
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
  });

  it('opens the tab that is clicked', () => {
    tabs()[2].click();
    fixture.detectChanges();
    expect(strip.value()).toBe('b');
    expect(tabs()[2].classList.contains('active')).toBe(true);
  });

  it('has no arrows while every tab fits', () => {
    layOut(300, 300);
    expect(arrows()).toEqual([]);
    expect(row.classList.contains('more-after')).toBe(false);
  });

  it('shows on which side there are more tabs', () => {
    layOut(300, 500);
    expect(arrows()).toEqual(['arrow arrow--after']);
    expect(row.classList.contains('more-after')).toBe(true);

    layOut(300, 500, 100);
    expect(arrows()).toEqual(['arrow arrow--before', 'arrow arrow--after']);

    layOut(300, 500, 200);
    expect(arrows()).toEqual(['arrow arrow--before']);
    expect(row.classList.contains('more-after')).toBe(false);
  });

  it('scrolls most of a screenful with an arrow', () => {
    row.scrollBy = vi.fn() as unknown as typeof row.scrollBy;
    layOut(300, 500);
    fixture.nativeElement.querySelector('.arrow--after').click();
    expect(row.scrollBy).toHaveBeenCalledWith({ left: 210, behavior: 'smooth' });
  });

  it('brings the open tab to the middle', () => {
    row.scrollTo = vi.fn() as unknown as typeof row.scrollTo;
    layOut(300, 500);
    const tab = tabs()[2];
    Object.defineProperties(tab, { offsetLeft: { value: 400 }, offsetWidth: { value: 100 } });
    fixture.componentRef.setInput('value', 'b');
    fixture.detectChanges();
    expect(row.scrollTo).toHaveBeenCalledWith({ left: 300, behavior: 'auto' });
  });

  it('puts the underline under the open tab, sliding there from the second time on', () => {
    const ink = fixture.nativeElement.querySelector('.ink') as HTMLElement;
    layOut(300, 300);
    Object.defineProperties(tabs()[1], { offsetLeft: { value: 80 }, offsetWidth: { value: 120 } });
    Object.defineProperties(tabs()[2], { offsetLeft: { value: 200 }, offsetWidth: { value: 90 } });

    fixture.componentRef.setInput('value', 'a');
    fixture.detectChanges();
    expect(ink.style.transform).toBe('translateX(80px)');
    expect(ink.style.width).toBe('120px');
    expect(ink.style.transition).toBe('none');

    fixture.componentRef.setInput('value', 'b');
    fixture.detectChanges();
    expect(ink.style.transform).toBe('translateX(200px)');
    expect(ink.style.width).toBe('90px');
    expect(ink.style.transition).toBe('');
  });
});
