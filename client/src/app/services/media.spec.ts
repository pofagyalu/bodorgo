import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { API, httpTesting } from '../../testing/http';
import { NotificationsService } from '../notifications/notifications.service';
import {
  DiscoveryStatus,
  MediaPhoto,
  MediaPhotoCategory,
  MediaService,
  MediaVideoCategory,
  photoNewCount,
} from './media';

const videos = `${API}/media/videos`;
const media = `${API}/media`;

const category = (key: string, ids: string[]): MediaVideoCategory => ({
  key,
  title: key,
  description: '',
  hasCover: false,
  videos: ids.map((id) => ({
    id,
    title: `régi ${id}`,
    discoveredTitle: id,
    year: null,
    season: null,
    episode: null,
    hasCover: false,
    hasSubtitles: false,
  })),
});

const photo = (filename: string): MediaPhoto => ({ filename, width: 1, height: 1, takenAt: null });

const photoCategory = (key: string, photos: MediaPhoto[]): MediaPhotoCategory => ({
  key,
  title: key,
  discoveredTitle: key,
  photos,
  albums: [],
  count: photos.length,
});

describe('MediaService', () => {
  let service: MediaService;
  let http: HttpTestingController;
  let notifications: NotificationsService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [httpTesting()] });
    service = TestBed.inject(MediaService);
    http = TestBed.inject(HttpTestingController);
    notifications = TestBed.inject(NotificationsService);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  describe('videos', () => {
    it('loads the categories once', () => {
      service.loadVideos();
      expect(service.loading()).toBe(true);
      service.loadVideos(); // already under way - no second request
      http.expectOne(videos).flush({ data: { categories: [category('tabor', ['v1'])] } });
      expect(service.loading()).toBe(false);
      expect(service.categories()).toHaveLength(1);

      service.loadVideos();
      http.expectNone(videos);
    });

    it('flags an error, and tries again the next time', () => {
      service.loadVideos();
      http.expectOne(videos).flush('', { status: 500, statusText: 'Error' });
      expect(service.error()).toBe(true);
      expect(service.loading()).toBe(false);

      service.loadVideos();
      expect(service.error()).toBe(false);
      http.expectOne(videos).flush({ data: { categories: [] } });
    });

    it('renames a video and sets its viewers in the loaded list, leaving the others alone', () => {
      service.categories.set([category('tabor', ['v1', 'v2']), category('egyeb', ['v1'])]);
      service.updateVideo('tabor', 'v1', { title: 'Új cím', viewers: ['u1'] }).subscribe();
      const req = http.expectOne(`${videos}/tabor/v1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ title: 'Új cím', viewers: ['u1'] });
      req.flush({
        data: { video: { id: 'v1', title: 'Új cím', discoveredTitle: 'v1', viewers: ['u1'] } },
      });

      const [tabor, egyeb] = service.categories();
      expect(tabor.videos.map((v) => v.title)).toEqual(['Új cím', 'régi v2']);
      expect(tabor.videos.map((v) => v.viewers)).toEqual([['u1'], undefined]);
      expect(egyeb.videos[0].title).toBe('régi v1');
    });

    it('builds the video URLs', () => {
      expect(service.videoUrl('tabor', 'v1', 'original')).toBe(
        `${videos}/tabor/v1/video?quality=original`,
      );
      expect(service.videoUrl('tabor', 'v1', 'small')).toBe(
        `${videos}/tabor/v1/video?quality=small`,
      );
      expect(service.coverUrl('tabor', 'v1')).toBe(`${videos}/tabor/v1/cover`);
      // A cover's version rides in its address: a replaced one is another address.
      expect(service.coverUrl('tabor', 'v1', 1790000000000)).toBe(
        `${videos}/tabor/v1/cover?v=1790000000000`,
      );
      expect(service.categoryCoverUrl('tabor', 5)).toBe(`${videos}/tabor/cover?v=5`);
      expect(service.subtitlesUrl('tabor', 'v1')).toBe(`${videos}/tabor/v1/subtitles.vtt`);
      expect(service.categoryCoverUrl('tabor')).toBe(`${videos}/tabor/cover`);
    });
  });

  describe('photos', () => {
    it('loads once, unless forced', () => {
      service.loadPhotos();
      service.loadPhotos();
      http.expectOne(`${media}/photos`).flush({ data: { categories: [{ key: 'a', photos: [] }] } });
      expect(service.photoCategories()).toHaveLength(1);
      expect(service.photosLoading()).toBe(false);

      service.loadPhotos();
      http.expectNone(`${media}/photos`);
      service.loadPhotos(true);
      http.expectOne(`${media}/photos`).flush({ data: { categories: [] } });
      expect(service.photoCategories()).toEqual([]);
    });

    it('names a photo and sets its viewers in the loaded list, leaving the others alone', () => {
      service.photoCategories.set([
        photoCategory('régi képek', [photo('a b.jpg'), photo('c.jpg')]),
        photoCategory('más', [photo('a b.jpg')]),
      ]);
      service
        .updatePhoto('régi képek', 'a b.jpg', { title: 'Nagyapa', viewers: ['u1'] })
        .subscribe();
      const req = http.expectOne(`${media}/photos/r%C3%A9gi%20k%C3%A9pek/a%20b.jpg`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ title: 'Nagyapa', viewers: ['u1'] });
      req.flush({ data: { photo: { filename: 'a b.jpg', title: 'Nagyapa', viewers: ['u1'] } } });

      const [regi, mas] = service.photoCategories();
      expect(regi.photos).toEqual([
        { ...photo('a b.jpg'), title: 'Nagyapa', viewers: ['u1'] },
        photo('c.jpg'),
      ]);
      expect(mas.photos).toEqual([photo('a b.jpg')]);
    });

    it("fetches an album's photos once, when it is opened", () => {
      const url = `${media}/photo-albums/farsangok/2019%20b%C3%A1l`;
      service.loadAlbum('farsangok', '2019 bál');
      service.loadAlbum('farsangok', '2019 bál'); // already under way
      http.expectOne(url).flush({ data: { photos: [photo('2019 bál/a.jpg')] } });
      expect(service.albumPhotos()).toEqual({ 'farsangok/2019 bál': [photo('2019 bál/a.jpg')] });

      service.loadAlbum('farsangok', '2019 bál');
      http.expectNone(url);
    });

    it('flags the album that could not be loaded, and tries again the next time', () => {
      service.loadAlbum('farsangok', '2019');
      http
        .expectOne(`${media}/photo-albums/farsangok/2019`)
        .flush('', { status: 404, statusText: 'Not Found' });
      expect(service.albumError()).toBe('farsangok/2019');

      service.loadAlbum('farsangok', '2019');
      expect(service.albumError()).toBeNull();
      http.expectOne(`${media}/photo-albums/farsangok/2019`).flush({ data: { photos: [] } });
    });

    it("names a photo in an opened album's list", () => {
      service.albumPhotos.set({
        'farsangok/2019': [photo('2019/a.jpg'), photo('2019/b.jpg')],
        'farsangok/2020': [photo('2020/a.jpg')],
      });
      service.updatePhoto('farsangok', '2019/a.jpg', { title: 'Bohóc', viewers: [] }).subscribe();
      http
        .expectOne(`${media}/photos/farsangok/2019%2Fa.jpg`)
        .flush({ data: { photo: { filename: '2019/a.jpg', title: 'Bohóc', viewers: [] } } });

      expect(service.albumPhotos()['farsangok/2019']).toEqual([
        { ...photo('2019/a.jpg'), title: 'Bohóc', viewers: [] },
        photo('2019/b.jpg'),
      ]);
      expect(service.albumPhotos()['farsangok/2020']).toEqual([photo('2020/a.jpg')]);
    });

    it('saves a category or an album, and reads the list again', () => {
      service.updateCategory('régi képek', { title: 'Régiek', viewers: ['u1'] }).subscribe();
      const category = http.expectOne(`${media}/photos/r%C3%A9gi%20k%C3%A9pek`);
      expect(category.request.method).toBe('PATCH');
      expect(category.request.body).toEqual({ title: 'Régiek', viewers: ['u1'] });
      category.flush({ data: {} });
      http.expectOne(`${media}/photos`).flush({ data: { categories: [] } });

      service.updateAlbum('farsangok', '2019', { cover: '2019/a.jpg' }).subscribe();
      const album = http.expectOne(`${media}/photo-albums/farsangok/2019`);
      expect(album.request.method).toBe('PATCH');
      expect(album.request.body).toEqual({ cover: '2019/a.jpg' });
      album.flush({ data: {} });
      http.expectOne(`${media}/photos`).flush({ data: { categories: [] } });
    });

    it('counts the new photos of a category with its albums', () => {
      const category = photoCategory('farsangok', [{ ...photo('a.jpg'), isNew: true }]);
      category.albums = [
        { key: '2020', title: '2020', discoveredTitle: '2020', count: 3, cover: 'x', newCount: 2 },
        { key: '2019', title: '2019', discoveredTitle: '2019', count: 1, cover: 'y' },
      ];
      expect(photoNewCount(category)).toBe(3);
    });

    it('flags an error', () => {
      service.loadPhotos();
      http.expectOne(`${media}/photos`).flush('', { status: 500, statusText: 'Error' });
      expect(service.photosError()).toBe(true);
      expect(service.photosLoading()).toBe(false);
    });

    it('escapes folder and file names in the photo URLs', () => {
      const base = `${media}/photos/r%C3%A9gi%20k%C3%A9pek/a%20b.jpg`;
      expect(service.photoUrl('régi képek', 'a b.jpg')).toBe(base);
      expect(service.photoThumbUrl('régi képek', 'a b.jpg')).toBe(`${base}/thumb`);
      expect(service.photoDownloadUrl('régi képek', 'a b.jpg')).toBe(`${base}/download`);
    });
  });

  describe('discovery', () => {
    const running: DiscoveryStatus = { running: true };
    const done: DiscoveryStatus = {
      running: false,
      report: {
        matched: ['2026 Mátra'],
        videos: ['Mátra film'],
        tours: [
          { title: 'Mátra', added: 3, removed: 1, failures: 2, skipped: ['raw', 'tmp'] },
          { title: 'Bükk' }, // nothing changed - not listed
          { title: 'Zemplén', error: 'nincs mappa' },
        ],
        media: [{ title: 'Régi képek', added: 1 }, { title: 'Üres' }],
        newVideos: 2,
      },
    };

    beforeEach(() => vi.useFakeTimers());

    it('starts, polls every two seconds, then reports and reloads the photos and videos', () => {
      const success = vi.spyOn(notifications, 'addSuccess');
      service.discover();
      http.expectOne(`${media}/discover`).flush({ data: running });
      expect(service.discovery()?.running).toBe(true);

      service.discover(); // already running - no second start
      http.expectNone(`${media}/discover`);
      service.closeDiscoveryReport(); // can't be closed while running
      expect(service.discovery()).not.toBeNull();

      vi.advanceTimersByTime(2000);
      http.expectOne(`${media}/discover`).flush({ data: running });
      vi.advanceTimersByTime(2000);
      http.expectOne(`${media}/discover`).flush({ data: done });

      expect(success).toHaveBeenCalledWith('Új média felfedezése kész');
      // What it brought carries "Új" from now - both lists are asked for anew.
      http.expectOne(`${media}/photos`).flush({ data: { categories: [] } });
      http.expectOne(`${media}/videos`).flush({ data: { categories: [] } });
      expect(service.discoveryReport()).toEqual([
        'Új tábormappa: 2026 Mátra',
        'Új tábori videó: Mátra film – értesítés kiküldve',
        'Mátra: +3 új fotó, 1 törölve, 2 nem sikerült, kihagyott almappa: raw, tmp',
        'Zemplén: hiba – nincs mappa',
        'Média – Régi képek: +1 új fotó',
        '2 új videó',
      ]);

      service.closeDiscoveryReport();
      expect(service.discovery()).toBeNull();
      expect(service.discoveryReport()).toEqual([]);
    });

    it('reports a discovery that broke off', () => {
      const error = vi.spyOn(notifications, 'addError');
      service.discover();
      http.expectOne(`${media}/discover`).flush({ data: running });
      vi.advanceTimersByTime(2000);
      http.expectOne(`${media}/discover`).flush({ data: { running: false, error: 'elfogyott' } });
      expect(error).toHaveBeenCalledWith('A felfedezés megszakadt: elfogyott');
      http.expectOne(`${media}/photos`).flush({ data: { categories: [] } });
      http.expectOne(`${media}/videos`).flush({ data: { categories: [] } });
    });

    it('keeps polling over a failed status request', () => {
      service.discover();
      http.expectOne(`${media}/discover`).flush({ data: running });
      vi.advanceTimersByTime(2000);
      http.expectOne(`${media}/discover`).flush('', { status: 502, statusText: 'Bad Gateway' });
      vi.advanceTimersByTime(2000);
      http.expectOne(`${media}/discover`).flush({ data: running });
    });

    it('joins a discovery someone else started (409) instead of failing', () => {
      service.discover();
      http
        .expectOne(`${media}/discover`)
        .flush({ data: running }, { status: 409, statusText: 'Conflict' });
      expect(service.discovery()?.running).toBe(true);
    });

    it('says so when it cannot start', () => {
      const error = vi.spyOn(notifications, 'addError');
      service.discover();
      http.expectOne(`${media}/discover`).flush('', { status: 500, statusText: 'Error' });
      expect(error).toHaveBeenCalledWith('Nem sikerült elindítani a felfedezést.');
      expect(service.discovery()).toBeNull();
    });

    it('picks a running discovery up again after a page reload', () => {
      service.resumeDiscovery();
      http.expectOne(`${media}/discover`).flush({ data: { running: false } });
      expect(service.discovery()).toBeNull();

      service.resumeDiscovery();
      http.expectOne(`${media}/discover`).flush({ data: running });
      expect(service.discovery()?.running).toBe(true);
    });
  });
});
