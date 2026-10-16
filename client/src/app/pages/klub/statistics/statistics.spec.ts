import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { fail, pageTesting, respond } from '../../../../testing/component';
import { API } from '../../../../testing/http';
import { ViewStats } from '../../../services/view-tracker';
import { activityLabel } from '../../../components/activity-chart/activity-chart';
import { DeviceChart } from '../../../components/device-chart/device-chart';
import { Statistics } from './statistics';

const STATS: ViewStats = {
  days: 30,
  since: '2026-09-17',
  activity: {
    unit: 'day',
    points: [
      { label: '2026-10-15', people: 3 },
      { label: '2026-10-16', people: 5 },
    ],
  },
  people: { today: 5, week: 8, period: 12, personDays: 40, returning: 9 },
  devices: { phone: 30, tablet: 2, desktop: 8 },
  app: { days: 10, people: 4 },
  top: {
    photo: [],
    video: [],
    tour: [
      {
        key: 't1',
        id: 't1',
        title: 'Sarud',
        order: 12,
        link: '/taborok/sarud',
        coverUrl: null,
        views: 1234,
        viewers: 30,
      },
    ],
    track: [
      {
        key: 's1',
        playlist: 'bodorgo-fm',
        id: 's1',
        title: 'Első dal',
        artist: 'Zenekar',
        imageUrl: null,
        views: 7,
        viewers: 3,
      },
    ],
    song: [
      {
        key: 'd1',
        title: 'Eső után',
        artist: '',
        link: '/media/zene/daloskonyv/eso-utan',
        views: 4,
        viewers: 2,
      },
    ],
  },
  searches: [{ words: 'szep kek eg', times: 3, people: 2 }],
};

describe('Statistics', () => {
  let fixture: ComponentFixture<Statistics>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent!.replace(/\s+/g, ' ');
  const panel = (title: string) =>
    [...el().querySelectorAll<HTMLElement>('.panel')].find(
      (p) => p.querySelector('h2')?.textContent?.trim() === title,
    )!;

  function open(reply: ViewStats | ReturnType<typeof fail> = STATS) {
    TestBed.configureTestingModule({ providers: [pageTesting()] });
    fixture = TestBed.createComponent(Statistics);
    fixture.detectChanges();
    respond({
      'GET /views/stats': reply instanceof Object && 'days' in reply ? { data: reply } : reply,
    });
    fixture.detectChanges();
  }

  it('shows the headline numbers of the last 30 days', () => {
    open();
    const tiles = [...el().querySelectorAll('.tile')].map((t) =>
      [...t.children].map((c) => c.textContent!.trim()).join(' '),
    );
    expect(tiles).toEqual([
      '5 ma',
      '8 az elmúlt 7 napban',
      '12 az elmúlt 30 napban',
      '75% visszatért (legalább 2 napon)',
    ]);
    // A quarter of the days with the installed app.
    expect(panel('Eszközök').textContent).toContain('25%');
  });

  it('lists the most viewed of each kind - an empty kind says so', () => {
    open();
    const tours = panel('Táborok');
    expect(tours.querySelector('a')!.getAttribute('href')).toBe('/taborok/sarud');
    expect(tours.textContent!.replace(/\s+/g, ' ')).toContain('12. Sarud');
    expect(tours.textContent!.replace(/\s+/g, ' ')).toContain('1234 megnyitás');
    expect(panel('Zenék').textContent!.replace(/\s+/g, ' ')).toContain('7 lejátszás · 3 fő');
    expect(panel('Fotók').textContent).toContain('Ebben az időszakban még semmi.');
    expect(panel('Hiába keresték').textContent).toContain('„szep kek eg”');
  });

  it('asks again for another period', () => {
    open();
    fixture.componentInstance.period.set('7');
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    const req = http.expectOne(`${API}/views/stats?days=7`);
    req.flush({ data: { ...STATS, days: 7 } });
    fixture.detectChanges();
    expect(text()).toContain('az elmúlt 7 napban');
  });

  it('says so when it can not be loaded', () => {
    open(fail(500));
    expect(text()).toContain('A statisztikát most nem sikerült betölteni.');
  });
});

describe('the charts', () => {
  it('names a day and a month the Hungarian way', () => {
    expect(activityLabel('2026-10-16')).toBe('10. 16.');
    expect(activityLabel('2026-03')).toBe('2026. márc.');
  });

  it('gives each device its share in percents', () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(DeviceChart);
    fixture.componentRef.setInput('devices', { phone: 30, tablet: 2, desktop: 8 });
    fixture.detectChanges();
    const rows = [...(fixture.nativeElement as HTMLElement).querySelectorAll('li')].map((li) =>
      li.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(rows).toEqual(['Telefon 75%', 'Számítógép 20%', 'Tablet 5%']);
  });
});
