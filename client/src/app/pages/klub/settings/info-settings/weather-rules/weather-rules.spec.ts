import { ComponentFixture, TestBed } from '@angular/core/testing';

import { fail, pageTesting, respond } from '../../../../../../testing/component';
import { makeWeatherRules } from '../../../../../../testing/fixtures';
import { WeatherRules } from './weather-rules';

describe('WeatherRules', () => {
  let fixture: ComponentFixture<WeatherRules>;
  let el: HTMLElement;

  function open(reply: object | null = { data: makeWeatherRules() }) {
    TestBed.configureTestingModule({ providers: [pageTesting()] });
    fixture = TestBed.createComponent(WeatherRules);
    el = fixture.nativeElement;
    fixture.detectChanges();
    if (reply) respond({ 'GET /settings/weather-outlook': reply });
    fixture.detectChanges();
  }

  const text = (selector: string) =>
    [...el.querySelectorAll(selector)].map((node) => node.textContent!.replace(/\s+/g, ' ').trim());

  // A table's rows, each as its cells side by side (the nth table of the panel).
  const rows = (table: number) =>
    [...el.querySelectorAll('.rules-table')[table].querySelectorAll('tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent!.replace(/\s+/g, ' ').trim()).join(' '),
    );

  it('waits for the numbers', () => {
    open(null);
    expect(text('h2')).toEqual(['Életviteli tanácsok']);
    expect(text('.empty-note')).toEqual(['Betöltés…']);
    expect(el.querySelector('.rules-columns')).toBeNull();
  });

  it('writes the forecast rules with the numbers of the code', () => {
    open();
    const rules = text('.rules-list li').join(' | ');
    expect(rules).toContain('legkorábban 15 nappal előtte');
    expect(rules).toContain('legfeljebb 6 óránként');
    expect(rules).toContain('több mint 5 nap van hátra');
    expect(rules).toContain('legalább 85 pontos');
    expect(rules).toContain('több mint 10 ponttal jobb');
  });

  it('gives the two sums as percentages', () => {
    open();
    expect(text('.rules-formula')).toEqual([
      '60% az időjárás fajtája + 40% a hőmérséklet',
      '70% a napok átlaga + 30% a leggyengébb nap',
    ]);
  });

  it('lists the kinds of day best first, the wet ones marked', () => {
    open();
    expect(rows(0)).toEqual([
      'napsütés 100 pont',
      'változó felhőzet 85 pont',
      'felhős ég 65 pont',
      'köd 50 pont',
      'havazás * 35 pont',
      'eső * 25 pont',
      'zivatar * 10 pont',
    ]);
    expect(text('.rules-note')[0]).toContain('× 0.5');
    expect(text('.rules-note')[0]).toContain('80%-kal');
  });

  it('gives the comfortable temperature for each month, and how it fades', () => {
    open();
    expect(rows(1)).toHaveLength(12);
    expect(rows(1)[0]).toBe('január 3–12 °C');
    expect(rows(1)[9]).toBe('október 14–23 °C');
    expect(text('.rules-note')[1]).toContain('Alatta 13 fokon, fölötte 8 fokon');
  });

  it('shows the five stretches of the index, worst first', () => {
    open();
    expect(rows(2)).toEqual([
      'Durva 0 ponttól',
      'Borongós 30 ponttól',
      'Vegyes 50 ponttól',
      'Kellemes 70 ponttól',
      'Álomszép 85 ponttól',
    ]);
    expect(el.querySelector('.rules-dot--rough')).toBeTruthy();
  });

  it('says what puts each thing on the packing list', () => {
    open();
    const packing = fixture.componentInstance.packing();
    expect(packing.map((p) => p.name)).toEqual([
      'Póló',
      'Meleg pulóver',
      'Meleg kabát',
      'Sapka, kesztyű',
      'Esőkabát vagy esernyő',
      'Széldzseki',
      'Napszemüveg, naptej',
      'Réteges öltözet',
    ]);
    const when = Object.fromEntries(packing.map((p) => [p.name, p.when]));
    expect(when['Póló']).toContain('legalább 20 °C');
    expect(when['Meleg kabát']).toContain('6 °C alatt');
    expect(when['Esőkabát vagy esernyő']).toContain('legalább 40%');
    expect(when['Széldzseki']).toContain('legalább 30 km/h');
    expect(when['Réteges öltözet']).toContain('legalább 12 fok');
    expect(el.textContent).toContain('Széldzseki, ha a legszelesebb napon');
  });

  it('follows the code when a number changes', () => {
    const rules = makeWeatherRules();
    rules.forecast.daysAhead = 10;
    rules.settings.weights = { condition: 0.5, temperature: 0.5, average: 0.8, worstDay: 0.2 };
    rules.settings.packing.windFromKmh = 45;
    open({ data: rules });
    expect(el.textContent).toContain('legkorábban 10 nappal');
    expect(text('.rules-formula')[1]).toBe('80% a napok átlaga + 20% a leggyengébb nap');
    expect(el.textContent).toContain('legalább 45 km/h');
  });

  it('stays on "Betöltés…" if the server does not answer', () => {
    TestBed.configureTestingModule({ providers: [pageTesting()] });
    fixture = TestBed.createComponent(WeatherRules);
    fixture.detectChanges();
    respond({ 'GET /settings/weather-outlook': fail(500) });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.rules-columns')).toBeNull();
  });
});
