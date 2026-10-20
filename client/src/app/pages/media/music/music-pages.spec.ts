import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';

import { logIn, pageTesting, respond, settle, waiting } from '../../../../testing/component';
import { NotificationsService } from '../../../notifications/notifications.service';
import { MusicPlayerService, MusicTrack, PlaylistKey } from '../../../services/music-player';
import { FmRadio } from './fm-radio/fm-radio';
import { Music } from './music';
import { playTime } from './playlist-page';
import { StyledPlaylist } from './styled-playlist/styled-playlist';
import { TrackList, TrackListLook } from './track-list/track-list';

const track = (id: string, over: Partial<MusicTrack> = {}): MusicTrack => ({
  id,
  title: `Dal ${id}`,
  artist: 'Zenekar',
  durationMs: 180_000,
  streamUrl: `/music/stream/${id}`,
  imageUrl: null,
  ...over,
});
const TRACKS = [track('a'), track('b', { imageUrl: '/music/image/b' }), track('c')];

let music: MusicPlayerService;

/** The playlist as loaded - and, with `on`, song `on` of it playing. */
function have(key: PlaylistKey, on?: number) {
  music.lists.update((lists) => ({ ...lists, [key]: TRACKS }));
  if (on === undefined) return;
  music.activeKey.set(key);
  music.index.set(on);
  music.isPlaying.set(true);
}

function setup(list?: 'buli' | 'hatter') {
  TestBed.configureTestingModule({
    providers: [
      pageTesting(),
      ...(list ? [{ provide: ActivatedRoute, useValue: { snapshot: { data: { list } } } }] : []),
    ],
  });
  music = TestBed.inject(MusicPlayerService);
}

afterEach(() => vi.restoreAllMocks());

describe('playTime', () => {
  it('writes seconds as minutes, and hours when there are any', () => {
    expect(playTime(156)).toBe('2:36');
    expect(playTime(3725)).toBe('1:02:05');
    expect(playTime(null)).toBe('0:00');
    expect(playTime(Infinity)).toBe('0:00');
  });
});

describe('TrackList', () => {
  let fixture: ComponentFixture<TrackList>;
  const el = () => fixture.nativeElement as HTMLElement;

  function open(look: TrackListLook, tracks = TRACKS) {
    fixture = TestBed.createComponent(TrackList);
    fixture.componentRef.setInput('look', look);
    fixture.componentRef.setInput('tracks', tracks);
    fixture.detectChanges();
  }

  beforeEach(() => setup());

  it('lists the songs with their number, picture, names and length', () => {
    open('radio');
    const rows = el().querySelectorAll('.track');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('1');
    expect(rows[0].textContent).toContain('Dal a');
    expect(rows[0].textContent).toContain('Zenekar');
    expect(rows[0].textContent).toContain('3:00');
    // A song without a picture gets the note in its place.
    expect(rows[0].querySelector('.thumb--none')).not.toBeNull();
    expect(rows[1].querySelector('img.thumb')).not.toBeNull();
  });

  it('wears the look of its page, with a head row only in the party look', () => {
    open('party');
    expect(el().classList.contains('party')).toBe(true);
    expect(el().querySelector('.table-head')).not.toBeNull();
    open('lounge');
    expect(el().classList.contains('lounge')).toBe(true);
    expect(el().querySelector('.table-head')).toBeNull();
  });

  it('marks the song that is on - bars while it plays, a flame in the lounge look', () => {
    open('party');
    fixture.componentRef.setInput('currentIndex', 1);
    fixture.detectChanges();
    const rows = () => el().querySelectorAll('.track');
    expect(rows()[1].classList.contains('track--current')).toBe(true);
    // Paused: still its number.
    expect(rows()[1].querySelector('.eq')).toBeNull();
    fixture.componentRef.setInput('playing', true);
    fixture.detectChanges();
    expect(rows()[1].querySelector('.eq')).not.toBeNull();
    expect(rows()[0].querySelector('.eq')).toBeNull();

    open('lounge');
    fixture.componentRef.setInput('currentIndex', 1);
    fixture.componentRef.setInput('playing', true);
    fixture.detectChanges();
    expect(rows()[1].querySelector('.flame')).not.toBeNull();
    expect(rows()[1].querySelector('.eq')).toBeNull();
  });

  it('tells which song was tapped', () => {
    open('radio');
    const picked: number[] = [];
    fixture.componentInstance.picked.subscribe((i) => picked.push(i));
    el().querySelectorAll<HTMLElement>('.track')[2].click();
    expect(picked).toEqual([2]);
  });

  it('says so while the list loads, when it failed, and when it is empty', () => {
    open('radio', []);
    expect(el().querySelector('.empty-note')!.textContent).toContain('Üres a lista.');
    music.error.set('A zene most nem érhető el.');
    fixture.detectChanges();
    expect(el().querySelector('.empty-note')!.textContent).toContain('A zene most nem érhető el.');
    music.loading.set(true);
    fixture.detectChanges();
    expect(el().querySelector('.empty-note')!.textContent).toContain('Betöltés...');
  });

  it('scrolls the list to a playing song that is out of sight', async () => {
    open('radio');
    const list = el().querySelector<HTMLElement>('.tracks')!;
    list.scrollTo = vi.fn();
    const box = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(box(0, 100));
    const row = list.querySelector<HTMLElement>('[data-index="2"]')!;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(box(300, 340));
    fixture.componentRef.setInput('currentIndex', 2);
    fixture.detectChanges();
    await settle();
    expect(list.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));

    // In sight: the list stays.
    vi.mocked(list.scrollTo).mockClear();
    const first = list.querySelector<HTMLElement>('[data-index="0"]')!;
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(box(10, 50));
    fixture.componentRef.setInput('currentIndex', 0);
    fixture.detectChanges();
    await settle();
    expect(list.scrollTo).not.toHaveBeenCalled();
  });
});

describe('StyledPlaylist', () => {
  let fixture: ComponentFixture<StyledPlaylist>;
  let page: StyledPlaylist;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent as string;

  function open(list: 'buli' | 'hatter', role = 'member') {
    setup(list);
    logIn({ role });
    fixture = TestBed.createComponent(StyledPlaylist);
    page = fixture.componentInstance;
    fixture.detectChanges();
    respond({ [`GET /music/${list}/playlist`]: { data: { tracks: TRACKS } } });
    fixture.detectChanges();
  }

  // Both looks: shuffle ⏮ ▶ ⏹ ⏭ repeat in the now-playing bar, no other
  // button row.
  function expectAllControlsInBar() {
    expect(el().querySelector('.actions')).toBeNull();
    expect(el().querySelector('.play-big')).toBeNull();
    const buttons = el().querySelectorAll('.now-controls .buttons > button');
    expect([...buttons].map((b) => b.getAttribute('title'))).toEqual([
      'Véletlen sorrend',
      'Előző dal',
      'Lejátszás',
      'Leállítás',
      'Következő dal',
      'Ez a dal ismétlődjön',
    ]);
  }

  it('shows Buli in the party look: whose list it is, every control in the now-playing bar', async () => {
    open('buli');
    await settle();
    fixture.detectChanges();
    expect(el().querySelector('.page.look--party')).not.toBeNull();
    expect(el().querySelector('.list-chips.look--party')).not.toBeNull();
    expect(el().querySelector('h1')!.textContent).toBe('Buli rádió');
    expect(el().querySelector('.cover')!.getAttribute('src')).toBe('assets/images/buli-cover.svg');
    expect(el().querySelector('.tagline')).toBeNull();
    expect(el().querySelector('.hero-text .owner')!.textContent).toBe('Csűrdöngölő kultúrpajta');
    expect(el().querySelector('.meta')!.textContent).toMatch(/^\s*3 dal\s+· kb\. 9 perc\s*$/);
    expectAllControlsInBar();
    expect(text()).toContain('Indítsd el a bulit!');
    expect(fixture.debugElement.query(By.directive(TrackList)).componentInstance.look()).toBe(
      'party',
    );
  });

  it('shows Duruzsoló in the lounge look: a tagline, every control in the now-playing bar', async () => {
    open('hatter');
    await settle();
    fixture.detectChanges();
    expect(el().querySelector('.page.look--lounge')).not.toBeNull();
    expect(el().querySelector('h1')!.textContent).toBe('Duruzsoló');
    expect(el().querySelector('.tagline')!.textContent).toBe('Zene a beszélgetések mellé');
    expect(el().querySelector('.owner')).toBeNull();
    expectAllControlsInBar();
    expect(text()).toContain('Gyújts gyertyát, tölts egy pohárral…');
    expect(el().querySelectorAll('.track').length).toBe(3);
  });

  it('gives an admin the Duruzsoló reload in the header’s top right corner', async () => {
    open('hatter', 'admin');
    await settle();
    fixture.detectChanges();
    const reload = el().querySelector('.hero .hero-refresh button')!;
    expect(reload.getAttribute('title')).toBe('Lista frissítése');
    expectAllControlsInBar();
  });

  it('shows what is on, and plays the song picked in the list', async () => {
    open('buli');
    await settle();
    have('buli', 1);
    fixture.detectChanges();
    expect(el().querySelector('.page--on')).not.toBeNull();
    expect(el().querySelector('.now-text strong')!.textContent).toBe('Dal b');
    expect(el().querySelector('.now-bar--idle')).toBeNull();

    const playAt = vi.spyOn(music, 'playAt').mockResolvedValue();
    el().querySelectorAll<HTMLElement>('.track')[2].click();
    expect(playAt).toHaveBeenCalledWith(2, 'buli');
  });

  it('acts on its own list only while that one is on', async () => {
    open('buli');
    await settle();
    const start = vi.spyOn(music, 'playPlaylist').mockResolvedValue();
    const next = vi.spyOn(music, 'next').mockImplementation(() => {});
    const previous = vi.spyOn(music, 'previous').mockImplementation(() => {});
    const stop = vi.spyOn(music, 'stop').mockImplementation(() => {});
    const seek = vi.spyOn(music, 'seek').mockImplementation(() => {});
    const input = (value: string) => ({ target: { value } }) as unknown as Event;

    // Another list is on: ⏭ and ⏮ start this one, ⏹ and the bar do nothing.
    page.next();
    page.previous();
    page.stop();
    page.onSeek(input('30'));
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledWith('buli');
    expect(next).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(seek).not.toHaveBeenCalled();

    have('buli', 0);
    page.next();
    page.previous();
    page.stop();
    page.onSeek(input('30'));
    expect(next).toHaveBeenCalled();
    expect(previous).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
    expect(seek).toHaveBeenCalledWith(30);

    const volume = vi.spyOn(music, 'setVolume').mockImplementation(() => {});
    page.onVolume(input('0.4'));
    expect(volume).toHaveBeenCalledWith(0.4);
  });

  it('has no reload button for a member', async () => {
    open('buli');
    await settle();
    fixture.detectChanges();
    expect(el().querySelector('.hero-refresh')).toBeNull();
  });

  it('lets an admin reload the list from Jellyfin', async () => {
    open('buli', 'admin');
    await settle();
    fixture.detectChanges();
    expect(el().querySelector('.hero .hero-refresh button')!.getAttribute('title')).toBe(
      'Lista frissítése',
    );
    expectAllControlsInBar();
    const notifications = TestBed.inject(NotificationsService);
    const success = vi.spyOn(notifications, 'addSuccess').mockImplementation(() => {});
    const error = vi.spyOn(notifications, 'addError').mockImplementation(() => {});

    let done = page.refresh();
    expect(page.refreshing()).toBe(true);
    void page.refresh(); // already going: not asked twice
    respond({ 'POST /music/buli/refresh': { data: { tracks: [...TRACKS, track('d')] } } });
    await done;
    expect(success).toHaveBeenCalledWith('Lista frissítve: 4 dal.');
    expect(page.refreshing()).toBe(false);

    done = page.refresh();
    respond({ 'POST /music/buli/refresh': { data: { tracks: [] } } });
    await done;
    expect(error).toHaveBeenCalledWith('Nem sikerült frissíteni a listát.');
  });
});

describe('FmRadio', () => {
  let fixture: ComponentFixture<FmRadio>;
  let radio: FmRadio;
  const el = () => fixture.nativeElement as HTMLElement;

  function open(on?: number) {
    setup();
    // The player forgets its lists while nobody is logged in.
    logIn({ role: 'member' });
    TestBed.tick();
    have('bodorgo-fm', on);
    fixture = TestBed.createComponent(FmRadio);
    radio = fixture.componentInstance;
    fixture.detectChanges();
  }

  const key = (k: string) => new KeyboardEvent('keydown', { key: k, cancelable: true });

  it('shows the station idle, with the band at its low end', () => {
    open();
    expect(el().querySelector('.station-title')!.textContent).toContain('Bódorgó FM');
    expect(el().querySelector('.station--on')).toBeNull();
    // Not started yet: the list's first song is the one waiting.
    expect(el().querySelector('.now-title')!.textContent).toBe('Dal a');
    expect(el().querySelector('.on-air--lit')).toBeNull();
    expect(radio.frequency()).toBe('88.0');
    // One knob, in two places (beside the faceplate, and on the photo).
    expect(el().querySelectorAll('.tuner').length).toBe(2);
    // The list is the page's to load.
    expect(waiting()).toEqual([]);
  });

  it('moves the frequency through the whole list as it plays', () => {
    open(1);
    expect(el().querySelector('.station--on')).not.toBeNull();
    expect(el().querySelector('.on-air--lit')).not.toBeNull();
    expect(el().querySelector('.now-title')!.textContent).toBe('Dal b');
    // The second of three equal songs starts a third of the way up the band.
    expect(radio.bandShare()).toBeCloseTo(1 / 3);
    expect(radio.frequency()).toBe('94.7');
    expect(radio.knobAngle()).toBe(30);
  });

  it('tunes to another song with the arrow keys, and plays it a moment later', async () => {
    vi.useFakeTimers();
    try {
      open(0);
      const playAt = vi.spyOn(music, 'playAt').mockResolvedValue();
      const event = key('ArrowRight');
      radio.knobKey(event);
      expect(event.defaultPrevented).toBe(true);
      expect(radio.isTuning()).toBe(true);
      expect(radio.frequency()).toBe('94.7');
      radio.knobKey(key('ArrowUp'));
      // The list's end: no further.
      radio.knobKey(key('ArrowRight'));
      expect(radio.knobAngle()).toBe(60);
      radio.knobKey(key('ArrowLeft'));
      // Any other key leaves it alone.
      radio.knobKey(key('a'));
      expect(playAt).not.toHaveBeenCalled();
      vi.advanceTimersByTime(600);
      expect(playAt).toHaveBeenCalledWith(1, 'bodorgo-fm');
      await vi.runAllTimersAsync();
      expect(radio.isTuning()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tunes with the wheel, and stays on a song that is already playing', () => {
    vi.useFakeTimers();
    try {
      open(1);
      const playAt = vi.spyOn(music, 'playAt').mockResolvedValue();
      const wheel = (deltaY: number) => new WheelEvent('wheel', { deltaY, cancelable: true });
      radio.knobWheel(wheel(-100));
      radio.knobWheel(wheel(100));
      vi.advanceTimersByTime(600);
      expect(playAt).not.toHaveBeenCalled();
      expect(radio.isTuning()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns with a drag: a song a notch, played when let go', () => {
    open(0);
    const playAt = vi.spyOn(music, 'playAt').mockResolvedValue();
    const knob = el().querySelector<HTMLElement>('.tuner')!;
    knob.setPointerCapture = vi.fn();
    vi.spyOn(knob, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    } as DOMRect);
    // Around the knob's middle (50, 50): from 3 o'clock to 6 o'clock is a
    // quarter turn - three notches, but the list has only two more songs.
    const at = (x: number, y: number) =>
      ({ currentTarget: knob, clientX: x, clientY: y, pointerId: 1, preventDefault() {} }) as never;
    radio.knobMove(at(50, 100)); // not down yet: nothing
    expect(radio.isTuning()).toBe(false);
    radio.knobDown(at(100, 50));
    radio.knobMove(at(50, 100));
    expect(radio.knobAngle()).toBe(60);
    // And back by one notch.
    radio.knobMove(at(85, 85));
    expect(radio.knobAngle()).toBe(30);
    radio.knobUp();
    expect(playAt).toHaveBeenCalledWith(1, 'bodorgo-fm');
    radio.knobUp(); // already let go
    expect(playAt).toHaveBeenCalledTimes(1);
  });

  it('has nothing to tune without songs', () => {
    setup();
    fixture = TestBed.createComponent(FmRadio);
    radio = fixture.componentInstance;
    fixture.detectChanges();
    radio.knobKey(key('ArrowRight'));
    expect(radio.isTuning()).toBe(false);
    expect(radio.frequency()).toBe('88.0');
    expect(el().querySelector<HTMLButtonElement>('.tuner')!.disabled).toBe(true);
  });
});

describe('Music', () => {
  it('shows the radio and under it the whole playlist', async () => {
    setup();
    logIn({ role: 'member' });
    const fixture = TestBed.createComponent(Music);
    fixture.detectChanges();
    respond({ 'GET /music/bodorgo-fm/playlist': { data: { tracks: TRACKS } } });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(fixture.debugElement.query(By.directive(FmRadio))).not.toBeNull();
    expect(el.querySelector('.count')!.textContent).toContain('3 dal');
    expect(el.querySelector('.refresh')).toBeNull();
    const list = fixture.debugElement.query(By.directive(TrackList)).componentInstance as TrackList;
    expect(list.look()).toBe('radio');
    expect(el.querySelectorAll('.track').length).toBe(3);

    const playAt = vi.spyOn(music, 'playAt').mockResolvedValue();
    el.querySelectorAll<HTMLElement>('.track')[1].click();
    expect(playAt).toHaveBeenCalledWith(1, 'bodorgo-fm');
  });
});
