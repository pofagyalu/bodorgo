import { TestBed } from '@angular/core/testing';

import { Loading } from './loading';

// The app's one look for anything loading (loading.ts).
describe('Loading', () => {
  function show(inputs: Record<string, string> = {}) {
    const fixture = TestBed.createComponent(Loading);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('the logo-colour ring and "Betöltés..." - small by default', () => {
    const el = show();
    expect(el.querySelector('app-loading-spinner')).toBeTruthy();
    expect(el.textContent?.trim()).toBe('Betöltés...');
    expect(el.classList.contains('large')).toBe(false);
  });

  it('says what is coming, and a whole page gets the large one', () => {
    const el = show({ text: 'Tagok betöltése…', size: 'large' });
    expect(el.textContent?.trim()).toBe('Tagok betöltése…');
    expect(el.classList.contains('large')).toBe(true);
    expect(el.querySelector('app-loading-spinner')?.getAttribute('aria-label')).toBe(
      'Tagok betöltése…',
    );
  });
});
