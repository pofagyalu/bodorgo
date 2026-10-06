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
      ['Kis', true],
      ['Eredeti', false],
    ]);

    el().querySelector<HTMLVideoElement>('video')!.currentTime = 42;
    el().querySelectorAll<HTMLButtonElement>('.player-quality button')[1].click();
    fixture.detectChanges();
    expect(source()).toBe('/video?quality=original');
    expect(qualityButtons()).toEqual([
      ['Kis', false],
      ['Eredeti', true],
    ]);
    // Another <video> - it goes on from where the first one was.
    const video = el().querySelector<HTMLVideoElement>('video')!;
    expect(video.currentTime).toBe(0);
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(42);
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
