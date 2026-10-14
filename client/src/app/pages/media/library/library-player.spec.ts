import { ComponentFixture, TestBed } from '@angular/core/testing';

import { logIn, pageTesting } from '../../../../testing/component';
import { MusicPlayerService } from '../../../services/music-player';
import { LibraryPlayer, clock } from './library-player';

// The <audio> as the test drives it: where it is, how long it is, and
// whether it plays - jsdom plays nothing itself.
interface FakeAudio extends HTMLAudioElement {
  now: number;
  length: number;
  stopped: boolean;
}

let fixture: ComponentFixture<LibraryPlayer>;
let audio: FakeAudio;
const el = () => fixture.nativeElement as HTMLElement;
const button = (text: string) =>
  [...el().querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes(text),
  ) as HTMLButtonElement;

// before: runs once the test module is set up, before the player is made.
function open(src = '/library/books/b1/audio/02.mp3', before?: () => void) {
  TestBed.configureTestingModule({ providers: [pageTesting()] });
  before?.();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function (this: FakeAudio) {
    this.stopped = false;
    this.dispatchEvent(new Event('play'));
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: FakeAudio) {
    this.stopped = true;
    this.dispatchEvent(new Event('pause'));
  });
  fixture = TestBed.createComponent(LibraryPlayer);
  audio = el().querySelector('audio') as FakeAudio;
  audio.now = 0;
  audio.length = 0;
  audio.stopped = true;
  Object.defineProperties(audio, {
    currentTime: {
      get: () => audio.now,
      set: (v: number) => (audio.now = v),
      configurable: true,
    },
    duration: { get: () => audio.length, configurable: true },
    paused: { get: () => audio.stopped, configurable: true },
  });
  fixture.componentRef.setInput('src', src);
  fixture.componentRef.setInput('title', 'Example A1 - C Major Scale');
  fixture.detectChanges();
}

// The track moves on to `seconds`.
function at(seconds: number) {
  audio.now = seconds;
  audio.dispatchEvent(new Event('timeupdate'));
  fixture.detectChanges();
}

function loaded(seconds: number) {
  audio.length = seconds;
  audio.dispatchEvent(new Event('loadedmetadata'));
  fixture.detectChanges();
}

afterEach(() => vi.restoreAllMocks());

describe('clock', () => {
  it('writes seconds as m:ss', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(75.9)).toBe('1:15');
    expect(clock(NaN)).toBe('0:00');
  });
});

describe('LibraryPlayer', () => {
  it('starts the track at once, pausing the club radio, and shows where it is', () => {
    let toggle!: ReturnType<typeof vi.spyOn>;
    open(undefined, () => {
      // (Logged out, the radio silences itself.)
      logIn({ role: 'admin', canManageRoles: true });
      const music = TestBed.inject(MusicPlayerService);
      music.isPlaying.set(true);
      toggle = vi.spyOn(music, 'toggle').mockResolvedValue();
    });
    expect(toggle).toHaveBeenCalled();
    expect(audio.getAttribute('src')).toBe('/library/books/b1/audio/02.mp3');
    expect(audio.stopped).toBe(false);
    expect(el().querySelector('.name')?.textContent).toBe('Example A1 - C Major Scale');

    loaded(130);
    at(65);
    expect([...el().querySelectorAll('.time')].map((t) => t.textContent)).toEqual(['1:05', '2:10']);
    (el().querySelector('.play') as HTMLButtonElement).click();
    expect(audio.stopped).toBe(true);
    fixture.detectChanges();
    expect(el().querySelector('.play')?.getAttribute('title')).toBe('Lejátszás');

    // 5 seconds back.
    button('replay_5').click();
    expect(audio.now).toBe(60);
  });

  it('plays slower at a picked speed, and keeps it for the next track', () => {
    open();
    button('100%').click();
    fixture.detectChanges();
    const speeds = [...el().querySelectorAll('.speeds button')].map((b) => b.textContent?.trim());
    expect(speeds).toEqual(['50%', '60%', '70%', '75%', '80%', '85%', '90%', '95%', '100%']);
    (el().querySelectorAll('.speeds button')[3] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(audio.playbackRate).toBe(0.75);
    expect(el().querySelector('.speeds')).toBeNull();

    fixture.componentRef.setInput('src', '/library/books/b1/audio/03.mp3');
    fixture.detectChanges();
    expect(audio.playbackRate).toBe(0.75);
    expect(button('75%')).toBeTruthy();
  });

  it('loops the part between A and B, and lets it go on the third press', () => {
    open();
    loaded(120);
    at(10);
    button('A').click(); // A at 0:10
    fixture.detectChanges();
    at(30);
    button('B').click(); // B at 0:30
    fixture.detectChanges();
    expect(button('0:10–0:30')).toBeTruthy();
    const part = el().querySelector('.part') as HTMLElement;
    expect(part.style.left).toMatch(/^8\.33/);

    at(29);
    expect(audio.now).toBe(29);
    at(30.2); // past B: back to A
    expect(audio.now).toBe(10);

    button('0:10–0:30').click();
    fixture.detectChanges();
    expect(el().querySelector('.part')).toBeNull();
    at(31);
    expect(audio.now).toBe(31);
  });

  it('takes B before A as the part the other way round', () => {
    open();
    loaded(60);
    at(40);
    button('A').click();
    fixture.detectChanges();
    at(20);
    button('B').click();
    fixture.detectChanges();
    expect(button('0:20–0:40')).toBeTruthy();
  });

  it('at the end: again from the start when repeating, from A with only A set, else stops', () => {
    open();
    loaded(60);
    audio.dispatchEvent(new Event('ended'));
    fixture.detectChanges();
    expect(el().querySelector('.play')?.getAttribute('title')).toBe('Lejátszás');

    button('Ismétlés').click();
    fixture.detectChanges();
    at(59);
    audio.dispatchEvent(new Event('ended'));
    expect(audio.now).toBe(0);
    expect(audio.stopped).toBe(false);

    at(12);
    button('A').click();
    at(60);
    audio.dispatchEvent(new Event('ended'));
    expect(audio.now).toBe(12);
  });

  it('closes: stops and says so', () => {
    open();
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    button('close').click();
    expect(audio.stopped).toBe(true);
    expect(closed).toHaveBeenCalled();
  });
});
