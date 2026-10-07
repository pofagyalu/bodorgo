import { ComponentFixture, TestBed } from '@angular/core/testing';

import { makeTour, makeWeatherOutlook } from '../../../../testing/fixtures';
import { Tour } from '../../../services/tour';
import { TourWeatherOutlook } from './tour-weather-outlook';

describe('TourWeatherOutlook', () => {
  let fixture: ComponentFixture<TourWeatherOutlook>;
  let el: HTMLElement;

  function show(tour: Tour) {
    fixture = TestBed.createComponent(TourWeatherOutlook);
    fixture.componentRef.setInput('tour', tour);
    fixture.detectChanges();
    el = fixture.nativeElement;
  }

  const text = (selector: string) =>
    [...el.querySelectorAll(selector)].map((node) => node.textContent!.trim());

  it('is not there at all while the tour has no outlook', () => {
    show(makeTour());
    expect(el.children.length).toBe(0);
    expect(el.textContent!.trim()).toBe('');
  });

  it('shows the mood, the headline and the day lines', () => {
    show(makeTour({ weatherOutlook: makeWeatherOutlook() }));
    expect(text('.section-heading')).toEqual(['Hogy készüljünk az időjárásra?']);
    expect(text('.outlook-tag')).toEqual(['Vegyesfelvágott']);
    expect(text('.outlook-headline')).toEqual(['Lesz itt minden, mint a búcsúban']);
    expect(text('.outlook-line')).toEqual([
      'A leggyengébb napnak a szombat ígérkezik: eső, 6 és 15 °C között.',
    ]);
    expect(el.querySelector('.outlook')!.classList).toContain('outlook--mixed');
    expect(el.querySelector('.outlook-scene')!.getAttribute('src')).toContain(
      'scenes/scene-mixed.svg',
    );
    expect(el.querySelector('.outlook-badge')!.getAttribute('src')).toContain(
      'badges/badge-mixed.svg',
    );
    expect(el.querySelector('.outlook-note')).toBeNull();
  });

  it('marks the score on the bar', () => {
    show(makeTour({ weatherOutlook: makeWeatherOutlook({ score: 62.6 }) }));
    expect(text('.meter-score')).toEqual(['Bódorgó-index: 63 / 100 – Vegyes']);
    expect((el.querySelector('.meter-mark') as HTMLElement).style.left).toBe('62.6%');
    expect(el.querySelectorAll('.meter-part').length).toBe(5);
  });

  it('lists what to pack, each with its reason', () => {
    show(makeTour({ weatherOutlook: makeWeatherOutlook() }));
    expect(text('.pack-heading')).toEqual(['Mit pakoljunk?']);
    expect(text('.pack-text strong')).toEqual(['Meleg pulóver', 'Esőkabát vagy esernyő']);
    expect(text('.pack-text small')).toEqual([
      'Estére 6 °C-ra hűl a levegő',
      'Egy napon várható csapadék',
    ]);
    expect(fixture.componentInstance.packIconMask('umbrella')).toBe(
      'url(assets/images/weather-outlook/icons/umbrella.svg)',
    );

    show(makeTour({ weatherOutlook: makeWeatherOutlook({ pack: [] }) }));
    expect(el.querySelector('.outlook-pack')).toBeNull();
  });

  it('says so while it is still an early guess', () => {
    show(makeTour({ weatherOutlook: makeWeatherOutlook({ note: 'Ez még korai jóslat.' }) }));
    expect(text('.outlook-note')).toEqual(['Ez még korai jóslat.']);
  });

  it('becomes what was promised once the tour has started', () => {
    show(makeTour({ weatherOutlook: makeWeatherOutlook({ frozen: true }) }));
    expect(text('.section-heading')).toEqual(['Ezt ígérték']);
    expect(text('.outlook-note')[0]).toContain('az indulás előtti utolsó jóslat');
  });
});
