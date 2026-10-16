import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AI_LINES, VideoPlayer } from './video-player';
import { ViewTrackerService } from '../../services/view-tracker';

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

  describe('the view count', () => {
    const video = () => el().querySelector<HTMLVideoElement>('video')!;
    const playTo = (from: number, to: number) => {
      for (let t = from; t <= to; t++) {
        video().currentTime = t;
        video().dispatchEvent(new Event('timeupdate'));
      }
    };

    function openCounted(duration?: number) {
      open('/video?quality=small');
      fixture.componentRef.setInput('viewKey', 'media:farsang:abc');
      fixture.detectChanges();
      if (duration) Object.defineProperty(video(), 'duration', { value: duration });
      return vi.spyOn(TestBed.inject(ViewTrackerService), 'seen');
    }

    it('counts the video as seen after 30 seconds played - across a quality switch', () => {
      const seen = openCounted();
      playTo(0, 20);
      video().currentTime = 300; // a jump ahead isn't watching
      video().dispatchEvent(new Event('timeupdate'));
      el().querySelectorAll<HTMLButtonElement>('.player-quality button')[1].click();
      fixture.detectChanges();
      playTo(0, 9);
      expect(seen).not.toHaveBeenCalled();
      playTo(10, 40);
      expect(seen).toHaveBeenCalledExactlyOnceWith({ type: 'video', key: 'media:farsang:abc' });
    });

    it('counts a short video at its half', () => {
      const seen = openCounted(30);
      playTo(0, 15);
      expect(seen).toHaveBeenCalledTimes(1);
    });

    it('counts nothing without a key', () => {
      open(null);
      const seen = vi.spyOn(TestBed.inject(ViewTrackerService), 'seen');
      playTo(0, 60);
      expect(seen).not.toHaveBeenCalled();
    });
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

  it('starts at half volume, and keeps the sound when the quality changes', () => {
    const video = () => el().querySelector<HTMLVideoElement>('video')!;
    open('/video?quality=small');
    video().dispatchEvent(new Event('loadstart'));
    expect(video().volume).toBe(0.5);
    expect(video().muted).toBe(false);

    // The viewer turns it up; the other quality is another <video>.
    video().volume = 0.9;
    video().dispatchEvent(new Event('volumechange'));
    fixture.componentInstance.setQuality('original');
    fixture.detectChanges();
    video().dispatchEvent(new Event('loadstart'));
    expect(video().volume).toBe(0.9);

    // Muted, and back to the small one: still muted, as loud as it was.
    video().muted = true;
    video().dispatchEvent(new Event('volumechange'));
    fixture.componentInstance.setQuality('small');
    fixture.detectChanges();
    video().dispatchEvent(new Event('loadstart'));
    expect(video().muted).toBe(true);
    expect(video().volume).toBe(0.9);

    // The next video opens with it too.
    open(null);
    video().dispatchEvent(new Event('loadstart'));
    expect(video().volume).toBe(0.9);
    expect(video().muted).toBe(true);
  });

  it('closes on Esc', () => {
    open(null);
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toHaveBeenCalled();
  });

  it('marks a video made with AI in the header, with a wink', () => {
    open(null);
    expect(el().querySelector('.ai-badge')).toBeNull();
    expect(el().querySelector('.ai-line')).toBeNull();
    fixture.componentRef.setInput('aiGenerated', true);
    fixture.detectChanges();
    expect(el().querySelector('.player-stage .ai-badge')!.textContent).toContain('AI');
    expect(AI_LINES).toContain(el().querySelector('.ai-line')!.textContent!.trim());
  });
});
