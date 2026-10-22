import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember } from '../helpers/factories.js';
import config from '../../src/config.js';
import { clearPlaylistCache, titleAndArtist } from '../../src/music/jellyfin.js';

// The background music (see music/jellyfin.js): a fake Jellyfin stands in
// for the real one - global fetch is replaced for these tests.
// a1: the artist has a photo; b2: only an album cover; c3: no picture.
const ITEMS = [
  {
    Id: 'a1',
    Name: 'Első dal',
    AlbumArtist: 'Zenekar',
    AlbumArtists: [{ Id: 'art1' }],
    RunTimeTicks: 1_800_000_000,
  },
  {
    Id: 'b2',
    Name: 'Második',
    Artists: ['Énekes'],
    ArtistItems: [{ Id: 'art2' }],
    AlbumId: 'alb2',
    AlbumPrimaryImageTag: 't',
    RunTimeTicks: 2_400_000_000,
  },
  { Id: 'c3', Name: 'Harmadik' },
];

let calls;
beforeEach(async () => {
  calls = [];
  clearPlaylistCache();
  Object.assign(config.jellyfin, {
    // The pictures' folder: an empty one for every test.
    imageCacheDir: await fs.mkdtemp(path.join(os.tmpdir(), 'music-test-')),
    url: 'https://jellyfin.test',
    apiKey: 'secret-key',
    playlistId: 'pl1',
    buliPlaylistId: 'pl2',
    hatterPlaylistId: 'pl3',
    userId: undefined,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), headers: init.headers });
      if (String(url).endsWith('/Users')) {
        return new Response(JSON.stringify([{ Id: 'u1', Name: 'gazda' }]), { status: 200 });
      }
      // Like the real one: a playlist's items only for some user.
      if (String(url).includes('/Playlists/pl1/Items')) {
        return String(url).includes('userId=u1')
          ? new Response(JSON.stringify({ Items: ITEMS }), { status: 200 })
          : new Response('Error processing request.', { status: 400 });
      }
      if (String(url).includes('/Playlists/pl2/Items')) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Id: 'p9',
                Name: 'Buli dal',
                ImageTags: { Primary: 'own9' },
                AlbumId: 'alb2',
                AlbumPrimaryImageTag: 't',
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (String(url).includes('/Playlists/pl3/Items')) {
        // A song with its own picture - and an artist with a photo, and an
        // album with a cover too.
        return new Response(
          JSON.stringify({
            Items: [
              {
                Id: 'h7',
                Name: 'Halk dal',
                ImageTags: { Primary: 'own7' },
                ArtistItems: [{ Id: 'art1' }],
                AlbumId: 'alb2',
                AlbumPrimaryImageTag: 't',
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (String(url).endsWith('/Items/art1/Images')) {
        return new Response(JSON.stringify([{ ImageType: 'Primary' }]), { status: 200 });
      }
      if (String(url).endsWith('/Items/art2/Images')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (/\/Items\/(art1|alb2|h7|p9)\/Images\/Primary/.test(String(url))) {
        return new Response('JPEGDATA', { status: 200, headers: { 'content-type': 'image/jpeg' } });
      }
      if (String(url).includes('/Audio/a1/stream')) {
        const ranged = !!init.headers?.Range;
        return new Response('ID3fakeaudio', {
          status: ranged ? 206 : 200,
          headers: {
            'content-type': 'audio/mpeg',
            'accept-ranges': 'bytes',
            ...(ranged ? { 'content-range': 'bytes 0-11/12' } : {}),
          },
        });
      }
      return new Response('nope', { status: 404 });
    }),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(config.jellyfin.imageCacheDir, { recursive: true, force: true }).catch(() => {});
});

describe('background music', () => {
  it('lists the playlist for anyone logged in - with our own stream addresses', async () => {
    expect((await request(app).get('/music/bodorgo-fm/playlist')).status).toBe(401);
    const res = await request(app)
      .get('/music/bodorgo-fm/playlist')
      .set(asUser(await createGuest()));
    expect(res.status).toBe(200);
    expect(res.body.data.tracks).toEqual([
      {
        id: 'a1',
        title: 'Első dal',
        artist: 'Zenekar',
        durationMs: 180000,
        streamUrl: '/music/bodorgo-fm/stream/a1',
        // The picture's tag in it: a changed picture, a new address.
        imageUrl: expect.stringMatching(/^\/music\/bodorgo-fm\/image\/a1\?v=/),
      },
      {
        id: 'b2',
        title: 'Második',
        artist: 'Énekes',
        durationMs: 240000,
        streamUrl: '/music/bodorgo-fm/stream/b2',
        imageUrl: '/music/bodorgo-fm/image/b2?v=t',
      },
      {
        id: 'c3',
        title: 'Harmadik',
        artist: 'Ismeretlen előadó',
        durationMs: null,
        streamUrl: '/music/bodorgo-fm/stream/c3',
        imageUrl: null,
      },
    ]);
    // The key goes as a header, never in the address.
    expect(calls.every((c) => !c.url.includes('secret-key'))).toBe(true);
    expect(calls[0].headers.Authorization).toContain('secret-key');
    expect(JSON.stringify(res.body)).not.toContain('secret-key');
  });

  it('pipes a track through, passing the byte range on', async () => {
    const guest = await createGuest();
    const whole = await request(app).get('/music/bodorgo-fm/stream/a1').set(asUser(guest));
    expect(whole.status).toBe(200);
    expect(whole.headers['content-type']).toBe('audio/mpeg');
    expect(whole.headers['accept-ranges']).toBe('bytes');

    const part = await request(app)
      .get('/music/bodorgo-fm/stream/a1')
      .set(asUser(guest))
      .set('Range', 'bytes=0-');
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe('bytes 0-11/12');
    // The audio request's own (the playlist's pictures may still be loading
    // in the background, after it).
    const audio = calls.filter((c) => c.url.includes('/Audio/a1/stream'));
    expect(audio.at(-1).headers.Range).toBe('bytes=0-');
  });

  it("a song's thumbnail: the artist's photo, else the album cover, else none", async () => {
    const guest = await createGuest();
    const a1 = await request(app).get('/music/bodorgo-fm/image/a1').set(asUser(guest));
    expect(a1.status).toBe(200);
    expect(a1.headers['content-type']).toBe('image/jpeg');
    expect(calls.some((c) => c.url.includes('/Items/art1/Images/Primary'))).toBe(true);
    expect((await request(app).get('/music/bodorgo-fm/image/b2').set(asUser(guest))).status).toBe(
      200,
    );
    expect(calls.some((c) => c.url.includes('/Items/alb2/Images/Primary'))).toBe(true);
    expect((await request(app).get('/music/bodorgo-fm/image/c3').set(asUser(guest))).status).toBe(
      404,
    );
  });

  it("Buli, Duruzsoló: a song's own picture first - before the artist's photo and the album cover", async () => {
    const guest = await createGuest();
    expect((await request(app).get('/music/buli/image/p9').set(asUser(guest))).status).toBe(200);
    expect(calls.some((c) => c.url.includes('/Items/p9/Images/Primary'))).toBe(true);
    const res = await request(app).get('/music/hatter/image/h7').set(asUser(guest));
    expect(res.status).toBe(200);
    const pictures = calls.filter((c) => c.url.includes('/Images/Primary')).map((c) => c.url);
    expect(pictures.some((u) => u.includes('/Items/h7/Images/Primary'))).toBe(true);
    expect(pictures.some((u) => /\/Items\/(art1|alb2)\/Images\/Primary/.test(u))).toBe(false);
  });

  it('the pictures are kept on the server: Jellyfin is asked for each only once', async () => {
    const guest = await createGuest();
    const pictureCalls = (id) =>
      calls.filter((c) => c.url.includes(`/Items/${id}/Images/Primary`)).length;
    // Loading the list fetches them all, before anyone asks for one.
    await request(app).get('/music/bodorgo-fm/playlist').set(asUser(guest));
    await vi.waitFor(async () =>
      expect((await fs.readdir(config.jellyfin.imageCacheDir)).sort()).toEqual([
        'alb2.t.webp',
        'art1.x.webp',
      ]),
    );
    expect([pictureCalls('art1'), pictureCalls('alb2')]).toEqual([1, 1]);

    const a1 = await request(app).get('/music/bodorgo-fm/image/a1').set(asUser(guest));
    expect(a1.status).toBe(200);
    expect(a1.body.toString()).toBe('JPEGDATA');
    // Not even after a restart (the list forgotten, the files still there).
    clearPlaylistCache();
    await request(app).get('/music/bodorgo-fm/image/b2').set(asUser(guest));
    await request(app).get('/music/bodorgo-fm/playlist').set(asUser(guest));
    expect([pictureCalls('art1'), pictureCalls('alb2')]).toEqual([1, 1]);
    // The server's own notes about the picture never reach the browser.
    const list = await request(app).get('/music/bodorgo-fm/playlist').set(asUser(guest));
    expect(JSON.stringify(list.body)).not.toMatch(/imageFrom|imageTag/);
  });

  it('once loaded, never reloaded by the clock - only by an admin', async () => {
    const guest = await createGuest();
    const list = async () =>
      (
        await request(app).get('/music/bodorgo-fm/playlist').set(asUser(guest))
      ).body.data.tracks.map((t) => t.id);
    expect(await list()).toEqual(['a1', 'b2', 'c3']);

    // Jellyfin's list changes; days later someone asks.
    ITEMS.push({ Id: 'd4', Name: 'Új dal' });
    const playlistCalls = () => calls.filter((c) => c.url.includes('/Playlists/')).length;
    const before = playlistCalls();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3 * 24 * 60 * 60 * 1000);
    try {
      expect(await list()).toEqual(['a1', 'b2', 'c3']);
      await new Promise((resolve) => setImmediate(resolve));
      expect(playlistCalls()).toBe(before);
      // The admin's reload brings the new song - for everyone.
      const reload = await request(app)
        .post('/music/bodorgo-fm/refresh')
        .set(asUser(await createAdmin()));
      expect(reload.status).toBe(200);
      expect(playlistCalls()).toBe(before + 1);
      expect(await list()).toEqual(['a1', 'b2', 'c3', 'd4']);
    } finally {
      vi.useRealTimers();
      ITEMS.pop();
    }
  });

  it('only streams tracks of the playlist, and says so when it is not set up', async () => {
    const guest = await createGuest();
    expect((await request(app).get('/music/bodorgo-fm/stream/zz9').set(asUser(guest))).status).toBe(
      404,
    );

    config.jellyfin.apiKey = undefined;
    clearPlaylistCache();
    expect((await request(app).get('/music/bodorgo-fm/playlist').set(asUser(guest))).status).toBe(
      503,
    );
    expect((await request(app).get('/music/nincs/playlist').set(asUser(guest))).status).toBe(404);
  });

  it('Buli: for guests too - its songs only through Buli', async () => {
    const guest = await request(app)
      .get('/music/buli/playlist')
      .set(asUser(await createGuest()));
    expect(guest.status).toBe(200);
    const member = await createMember();
    const res = await request(app).get('/music/buli/playlist').set(asUser(member));
    expect(res.status).toBe(200);
    expect(res.body.data.tracks.map((t) => t.streamUrl)).toEqual(['/music/buli/stream/p9']);
    // A Bódorgó FM song isn't reachable through Buli, and the other way round.
    expect((await request(app).get('/music/buli/stream/a1').set(asUser(member))).status).toBe(404);
    expect((await request(app).get('/music/bodorgo-fm/stream/p9').set(asUser(member))).status).toBe(
      404,
    );
  });

  it('Duruzsoló (hatter): for guests too - a list of its own', async () => {
    const guest = await request(app)
      .get('/music/hatter/playlist')
      .set(asUser(await createGuest()));
    expect(guest.status).toBe(200);
    const member = await createMember();
    const res = await request(app).get('/music/hatter/playlist').set(asUser(member));
    expect(res.status).toBe(200);
    expect(res.body.data.tracks.map((t) => t.streamUrl)).toEqual(['/music/hatter/stream/h7']);
    expect((await request(app).get('/music/hatter/stream/p9').set(asUser(member))).status).toBe(
      404,
    );
    // Not set up (no JELLYFIN_HATTER_PLAYLIST_ID): the other lists still work.
    config.jellyfin.hatterPlaylistId = undefined;
    expect((await request(app).get('/music/hatter/playlist').set(asUser(member))).status).toBe(503);
    expect((await request(app).get('/music/buli/playlist').set(asUser(member))).status).toBe(200);
  });

  it("a collection's songs: the artist read out of the title", () => {
    const collections = ['Házigazda kedvencei'];
    const of = (Name, Artists = [], AlbumArtist = 'Házigazda kedvencei') =>
      titleAndArtist({ Name, Artists, AlbumArtist }, collections);
    expect(of('Depeche Mode - Personal Jesus (Official Video)', ['Cutt & Shutt'])).toEqual({
      title: 'Personal Jesus',
      artist: 'Depeche Mode',
    });
    expect(of('Rosa Linn - Snap - (Official Video)')).toEqual({
      title: 'Snap',
      artist: 'Rosa Linn',
    });
    expect(of('Alkyone - Mine [Official Audio]')).toEqual({ title: 'Mine', artist: 'Alkyone' });
    expect(of('Bohemian Betyars - Csavargó // Official Music Video')).toEqual({
      title: 'Csavargó',
      artist: 'Bohemian Betyars',
    });
    expect(of('Robbie Williams | Love My Life (Official Video)')).toEqual({
      title: 'Love My Life',
      artist: 'Robbie Williams',
    });
    expect(of('Sean Rowe - "To Leave Something Behind"')).toEqual({
      title: 'To Leave Something Behind',
      artist: 'Sean Rowe',
    });
    // The artist second: known from the track's own tag.
    expect(of('Golden Brown - The Stranglers', ['The Stranglers'])).toEqual({
      title: 'Golden Brown',
      artist: 'The Stranglers',
    });
    expect(of('Los Chocolatinos "Chocolatineando"')).toEqual({
      title: 'Chocolatineando',
      artist: 'Los Chocolatinos',
    });
    // No artist in the name: the track's tag, or nobody - never the collection.
    expect(of('Je Veux', ['Zaz'])).toEqual({ title: 'Je Veux', artist: 'Zaz' });
    expect(of('03.Viva Cuba')).toEqual({ title: 'Viva Cuba', artist: 'Ismeretlen előadó' });
    expect(of('16 tonna fekete szén', ['Republic']).title).toBe('16 tonna fekete szén');
    // A properly tagged song stays as it is.
    expect(of('Hála Veled', ['Kowalsky meg a Vega'], 'Kowalsky meg a Vega')).toEqual({
      title: 'Hála Veled',
      artist: 'Kowalsky meg a Vega',
    });
    // The other playlists: Jellyfin's own, untouched.
    expect(titleAndArtist({ Name: 'A - B (Official Video)', AlbumArtist: 'X' })).toEqual({
      title: 'A - B (Official Video)',
      artist: 'X',
    });
  });

  it('an admin reloads a list from Jellyfin at once', async () => {
    const member = await createMember();
    await request(app).get('/music/bodorgo-fm/playlist').set(asUser(member));
    ITEMS.push({ Id: 'd4', Name: 'Új dal' });
    try {
      expect(
        (await request(app).post('/music/bodorgo-fm/refresh').set(asUser(member))).status,
      ).toBe(403);
      const res = await request(app)
        .post('/music/bodorgo-fm/refresh')
        .set(asUser(await createAdmin()));
      expect(res.status).toBe(200);
      expect(res.body.data.tracks.map((t) => t.id)).toEqual(['a1', 'b2', 'c3', 'd4']);
    } finally {
      ITEMS.pop();
    }
  });
});
