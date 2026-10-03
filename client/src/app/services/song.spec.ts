import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { API, httpTesting } from '../../testing/http';
import { AuthService } from '../auth/auth.service';
import { Song, SongService } from './song';

const songs = `${API}/songs`;

function setUp() {
  TestBed.configureTestingModule({ providers: [httpTesting()] });
  return {
    service: TestBed.inject(SongService),
    http: TestBed.inject(HttpTestingController),
  };
}

function logIn(http: HttpTestingController, role: string) {
  TestBed.inject(AuthService).checkAuth().subscribe();
  http.expectOne(`${API}/auth/me`).flush({ loggedIn: true, id: 'u1', role });
}

describe('SongService', () => {
  beforeEach(() => localStorage.clear());

  it('lives under Média for members and on its own for everyone else', () => {
    const { service, http } = setUp();
    expect(service.base()).toBe('/daloskonyv');
    logIn(http, 'guest');
    expect(service.base()).toBe('/daloskonyv');
    logIn(http, 'member');
    expect(service.base()).toBe('/media/zene/daloskonyv');
    logIn(http, 'admin');
    expect(service.base()).toBe('/media/zene/daloskonyv');
  });

  it('remembers the instrument on this device', () => {
    const first = setUp().service;
    expect(first.instrument()).toBe('guitar');
    first.setInstrument('ukulele');
    expect(localStorage.getItem('daloskonyv-instrument')).toBe('ukulele');

    TestBed.resetTestingModule();
    expect(setUp().service.instrument()).toBe('ukulele');
  });

  it('remembers which songs were played, until cleared', () => {
    const first = setUp().service;
    first.setPlayed('s1', true);
    first.setPlayed('s2', true);
    first.setPlayed('s1', false);
    expect([...first.played()]).toEqual(['s2']);

    TestBed.resetTestingModule();
    const second = setUp().service;
    expect([...second.played()]).toEqual(['s2']);
    second.clearPlayed();
    expect(second.played().size).toBe(0);
    expect(localStorage.getItem('daloskonyv-played')).toBe('[]');
  });

  it('ignores a damaged list of played songs', () => {
    localStorage.setItem('daloskonyv-played', '{not json');
    expect(setUp().service.played().size).toBe(0);

    TestBed.resetTestingModule();
    localStorage.setItem('daloskonyv-played', '["s1", 7, null]');
    expect([...setUp().service.played()]).toEqual(['s1']);

    TestBed.resetTestingModule();
    localStorage.setItem('daloskonyv-played', '"s1"');
    expect(setUp().service.played().size).toBe(0);
  });

  it('still works when the browser refuses to store anything', () => {
    const { service } = setUp();
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    service.setInstrument('ukulele');
    service.setPlayed('s1', true);
    expect(service.instrument()).toBe('ukulele');
    expect(service.played().has('s1')).toBe(true);
    refuse.mockRestore();
  });

  it('loads the list with the edit right and the last change', () => {
    const { service, http } = setUp();
    expect(service.songs()).toBeNull();
    service.loadSongs();
    http.expectOne(songs).flush({
      data: {
        songs: [{ _id: 's1', title: 'A', artist: 'B', slug: 'a' }],
        canEdit: true,
        lastChanged: 'x',
      },
    });
    expect(service.songs()).toHaveLength(1);
    expect(service.canEdit()).toBe(true);
    expect(service.lastChanged()).toBe('x');
  });

  it('shows an empty list on a failed first load, but keeps a loaded one', () => {
    const { service, http } = setUp();
    service.loadSongs();
    http.expectOne(songs).flush('', { status: 500, statusText: 'Error' });
    expect(service.songs()).toEqual([]);

    service.songs.set([
      { _id: 's1', title: 'A', artist: 'B', slug: 'a', key: '', detectedKey: 'C' },
    ]);
    service.loadSongs();
    http.expectOne(songs).flush('', { status: 500, statusText: 'Error' });
    expect(service.songs()).toHaveLength(1);
  });

  it('reads, creates, updates and deletes a song', () => {
    const { service, http } = setUp();
    const song = { _id: 's1', title: 'A' } as Song;
    const got: unknown[] = [];

    service.getSong('á b').subscribe((s) => got.push(s));
    http.expectOne(`${songs}/%C3%A1%20b`).flush({ data: { song } });

    service
      .createSong({ title: 'A', artist: 'B', chordpro: '[C]la' })
      .subscribe((s) => got.push(s));
    const create = http.expectOne(songs);
    expect(create.request.method).toBe('POST');
    create.flush({ data: { song } });

    service.updateSong('s1', { originalKey: 'D' }).subscribe((s) => got.push(s));
    const update = http.expectOne(`${songs}/s1`);
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({ originalKey: 'D' });
    update.flush({ data: { song } });

    service.deleteSong('s1').subscribe();
    const del = http.expectOne(`${songs}/s1`);
    expect(del.request.method).toBe('DELETE');
    del.flush(null);

    expect(got).toEqual([song, song, song]);
  });

  it('builds the songbook URLs', () => {
    const { service } = setUp();
    expect(service.bookUrl('none')).toBe(`${songs}/book.pdf`);
    expect(service.bookUrl('guitar')).toBe(`${songs}/book.pdf?diagrams=guitar`);
    expect(service.bookUrl('none', true)).toBe(`${songs}/book.pdf?download=1`);
    expect(service.bookUrl('ukulele', true)).toBe(`${songs}/book.pdf?diagrams=ukulele&download=1`);
    expect(service.bookPreviewUrl('none', 'a b')).toBe(`${songs}/book.webp?v=a%20b`);
    expect(service.bookPreviewUrl('guitar', 'x')).toBe(`${songs}/book.webp?diagrams=guitar&v=x`);
  });
});
