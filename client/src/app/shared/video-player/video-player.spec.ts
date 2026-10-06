import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VideoPlayer } from './video-player';

describe('VideoPlayer', () => {
  let fixture: ComponentFixture<VideoPlayer>;
  const el = () => fixture.nativeElement as HTMLElement;
  const source = () => el().querySelector('source')!.getAttribute('src');
  const qualityButtons = () =>
    [...el().querySelectorAll<HTMLButtonElement>('.player-quality button')].map((b) => [
      b.textContent!.trim(),
      b.classList.contains('active'),
    ]);

  function open(smallSrc: string | null) {
    fixture = TestBed.createComponent(VideoPlayer);
    fixture.componentRef.setInput('title', 'Farsang');
    fixture.componentRef.setInput('src', '/video?quality=original');
    fixture.componentRef.setInput('smallSrc', smallSrc);
    fixture.detectChanges();
  }

  beforeEach(() => localStorage.clear());

  it('plays the original, with nothing to pick, when there is no small copy', () => {
    open(null);
    expect(source()).toBe('/video?quality=original');
    expect(el().querySelector('.player-quality')).toBeNull();
  });

  it('starts with the small copy, and switches to the original from the same place', () => {
    open('/video?quality=small');
    expect(source()).toBe('/video?quality=small');
    expect(qualityButtons()).toEqual([
      ['Tömörített', true],
      ['Eredeti', false],
    ]);

    el().querySelector<HTMLVideoElement>('video')!.currentTime = 42;
    el().querySelectorAll<HTMLButtonElement>('.player-quality button')[1].click();
    fixture.detectChanges();
    expect(source()).toBe('/video?quality=original');
    expect(qualityButtons()).toEqual([
      ['Tömörített', false],
      ['Eredeti', true],
    ]);
    // Another <video> - it goes on from where the first one was.
    const video = el().querySelector<HTMLVideoElement>('video')!;
    expect(video.currentTime).toBe(0);
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(42);
  });

  it('shows the resolution of the one playing, next to the switch', () => {
    const resolution = () => el().querySelector('.player-resolution')?.textContent?.trim();
    open('/video?quality=small');
    expect(resolution()).toBeUndefined(); // not known: nothing
    fixture.componentRef.setInput('height', 1080);
    fixture.componentRef.setInput('smallHeight', 720);
    fixture.detectChanges();
    expect(resolution()).toBe('720p');
    fixture.componentInstance.setQuality('original');
    fixture.detectChanges();
    expect(resolution()).toBe('1080p');

    // An old video: its copy is the same size - the switch is still there.
    fixture.componentRef.setInput('height', 576);
    fixture.componentRef.setInput('smallHeight', 576);
    fixture.componentInstance.setQuality('small');
    fixture.detectChanges();
    expect(resolution()).toBe('576p');
    expect(qualityButtons()).toHaveLength(2);

    // One without a copy: only the original's.
    open(null);
    fixture.componentRef.setInput('height', 720);
    fixture.detectChanges();
    expect(resolution()).toBe('720p');
  });

  it('shows the subtitles with either quality', () => {
    const track = () => el().querySelector('track');
    open('/video?quality=small');
    fixture.componentRef.setInput('subtitlesSrc', '/subtitles.vtt');
    fixture.detectChanges();
    expect(track()?.getAttribute('src')).toBe('/subtitles.vtt');
    expect(track()?.hasAttribute('default')).toBe(true);

    fixture.componentInstance.setQuality('original');
    fixture.detectChanges();
    expect(source()).toBe('/video?quality=original');
    expect(track()?.getAttribute('src')).toBe('/subtitles.vtt');
    expect(track()?.hasAttribute('default')).toBe(true);
  });

  it('remembers the picked quality for the next video', () => {
    open('/video?quality=small');
    fixture.componentInstance.setQuality('original');
    open('/other?quality=small');
    expect(source()).toBe('/video?quality=original');
    expect(fixture.componentInstance.quality()).toBe('original');
  });

  it('closes on Esc', () => {
    open(null);
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toHaveBeenCalled();
  });
});
