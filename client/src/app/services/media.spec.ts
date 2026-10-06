import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { API, httpTesting } from '../../testing/http';
import { NotificationsService } from '../notifications/notifications.service';
import { DiscoveryStatus, MediaService, MediaVideoCategory } from './media';

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
      const photo = (filename: string) => ({ filename, width: 1, height: 1, takenAt: null });
      service.photoCategories.set([
        { key: 'régi képek', title: 'Régi képek', photos: [photo('a b.jpg'), photo('c.jpg')] },
        { key: 'más', title: 'Más', photos: [photo('a b.jpg')] },
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
      },
    };

    beforeEach(() => vi.useFakeTimers());

    it('starts, polls every two seconds, then reports and reloads the photos', () => {
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
      http.expectOne(`${media}/photos`).flush({ data: { categories: [] } });
      expect(service.discoveryReport()).toEqual([
        'Új tábormappa: 2026 Mátra',
        'Új tábori videó: Mátra film – értesítés kiküldve',
        'Mátra: +3 új fotó, 1 törölve, 2 nem sikerült, kihagyott almappa: raw, tmp',
        'Zemplén: hiba – nincs mappa',
        'Média – Régi képek: +1 új fotó',
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
