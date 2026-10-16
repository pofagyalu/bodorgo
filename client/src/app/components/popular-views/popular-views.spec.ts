import { ComponentFixture, TestBed } from '@angular/core/testing';

import { pageTesting, respond, settle } from '../../../testing/component';
import { API } from '../../../testing/http';
import { Popular } from '../../services/view-tracker';
import { PhotoGalleryService } from '../../shared/photo-gallery';
import { MusicPlayerService } from '../../services/music-player';
import { PopularViews } from './popular-views';

const POPULAR: Popular = {
  days: 30,
  photo: {
    source: 'tour',
    key: 'tour:t1:IMG_1.jpg',
    title: '12. Sarud',
    link: '/taborok/sarud',
    filename: 'IMG_1.jpg',
    width: 1200,
    height: 800,
    fullUrl: '/tours/t1/images/IMG_1.jpg',
    thumbUrl: '/tours/t1/images/IMG_1.jpg/thumb',
    downloadUrl: '/tours/t1/images/IMG_1.jpg/download',
    views: 1234,
    viewers: 40,
  },
  video: {
    source: 'media',
    key: 'media:farsang:abc',
    title: 'Farsang',
    subtitle: 'Farsangok · 2025',
    link: '/media/videok/farsang',
    coverUrl: '/media/videos/farsang/abc/cover',
    src: '/media/videos/farsang/abc/video?quality=original',
    smallSrc: '/media/videos/farsang/abc/video?quality=small',
    subtitlesSrc: null,
    height: 1080,
    smallHeight: 720,
    views: 8,
    viewers: 5,
  },
  tour: {
    key: 't1',
    id: 't1',
    title: 'Sarud',
    order: 12,
    link: '/taborok/sarud',
    coverUrl: null,
    views: 20,
    viewers: 9,
  },
  track: {
    key: 'song2',
    playlist: 'bodorgo-fm',
    id: 'song2',
    title: 'Második dal',
    artist: 'Zenekar',
    imageUrl: null,
    views: 3,
    viewers: 2,
  },
  song: {
    key: 'd1',
    title: 'Eső után',
    artist: '',
    link: '/media/zene/daloskonyv/eso-utan',
    views: 6,
    viewers: 4,
  },
};

describe('PopularViews', () => {
  let fixture: ComponentFixture<PopularViews>;
  const el = () => fixture.nativeElement as HTMLElement;
  const cards = () => [...el().querySelectorAll<HTMLElement>('.pop-card')];

  function open(popular: Popular) {
    TestBed.configureTestingModule({ providers: [pageTesting()] });
    fixture = TestBed.createComponent(PopularViews);
    fixture.detectChanges();
    respond({ 'GET /views/popular': { data: popular } });
    fixture.detectChanges();
  }

  it('shows nothing while nothing has been seen', () => {
    open({ days: 30, photo: null, video: null, tour: null, track: null, song: null });
    expect(el().querySelector('.popular-section')).toBeNull();
  });

  it('shows the photo, the video, the tour and the song with their counts', () => {
    open(POPULAR);
    expect(cards().map((c) => c.querySelector('.pop-kicker')!.textContent!.trim())).toEqual([
      'A hónap képe',
      'A hónap videója',
      'Legnézettebb tábor',
      'Legtöbbet hallgatott szám',
      'A hónap dala',
    ]);
    const [photo, video, tour, track] = cards();
    expect(photo.querySelector('img')!.getAttribute('src')).toBe(
      `${API}/tours/t1/images/IMG_1.jpg/thumb`,
    );
    expect(photo.textContent).toContain('12. Sarud');
    expect(photo.querySelector('.pop-count')!.textContent!.replace(/\s/g, ' ')).toContain(
      'megtekintés',
    );
    expect(video.textContent).toContain('Farsangok · 2025');
    expect(tour.getAttribute('href')).toBe('/taborok/sarud');
    expect(tour.textContent).toContain('12. Sarud');
    expect(track.textContent).toContain('Második dal');
    expect(track.textContent).toContain('3 lejátszás');
    // The songbook's song goes to its page.
    const song = cards()[4];
    expect(song.getAttribute('href')).toBe('/media/zene/daloskonyv/eso-utan');
    expect(song.textContent).toContain('6 megnyitás');
  });

  it('shows only the kinds there is one of', () => {
    open({ ...POPULAR, video: null, track: null, song: null });
    expect(cards().length).toBe(2);
  });

  it('opens the photo in the viewer, counted as a view of it', () => {
    open(POPULAR);
    const gallery = TestBed.inject(PhotoGalleryService);
    const openSpy = vi.spyOn(gallery, 'open').mockResolvedValue();
    cards()[0].querySelector<HTMLButtonElement>('.pop-picture')!.click();
    expect(openSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'IMG_1.jpg',
        fullUrl: `${API}/tours/t1/images/IMG_1.jpg`,
        viewKey: 'tour:t1:IMG_1.jpg',
      }),
    ]);
  });

  it('plays the video right here - the small copy first', () => {
    open(POPULAR);
    cards()[1].querySelector<HTMLButtonElement>('.pop-picture')!.click();
    fixture.detectChanges();
    expect(el().querySelector('app-video-player source')!.getAttribute('src')).toBe(
      `${API}/media/videos/farsang/abc/video?quality=small`,
    );
  });

  it('plays the song from its playlist', async () => {
    open(POPULAR);
    const music = TestBed.inject(MusicPlayerService);
    music.lists.set({
      'bodorgo-fm': ['song1', 'song2'].map((id) => ({
        id,
        title: id,
        artist: 'Zenekar',
        durationMs: null,
        streamUrl: `/music/bodorgo-fm/stream/${id}`,
        imageUrl: null,
      })),
    });
    const playAt = vi.spyOn(music, 'playAt').mockResolvedValue();
    cards()[3].querySelector<HTMLButtonElement>('.pop-picture')!.click();
    await settle();
    expect(playAt).toHaveBeenCalledWith(1, 'bodorgo-fm');
  });
});
