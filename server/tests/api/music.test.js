import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember } from '../helpers/factories.js';
import config from '../../src/config.js';
import { clearPlaylistCache } from '../../src/music/jellyfin.js';

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
beforeEach(() => {
  calls = [];
  clearPlaylistCache();
  Object.assign(config.jellyfin, {
    url: 'https://jellyfin.test',
    apiKey: 'secret-key',
    playlistId: 'pl1',
    buliPlaylistId: 'pl2',
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
        return new Response(JSON.stringify({ Items: [{ Id: 'p9', Name: 'Buli dal' }] }), {
          status: 200,
        });
      }
      if (String(url).endsWith('/Items/art1/Images')) {
        return new Response(JSON.stringify([{ ImageType: 'Primary' }]), { status: 200 });
      }
      if (String(url).endsWith('/Items/art2/Images')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (/\/Items\/(art1|alb2)\/Images\/Primary/.test(String(url))) {
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
afterEach(() => vi.unstubAllGlobals());

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
        imageUrl: '/music/bodorgo-fm/image/a1',
      },
      {
        id: 'b2',
        title: 'Második',
        artist: 'Énekes',
        durationMs: 240000,
        streamUrl: '/music/bodorgo-fm/stream/b2',
        imageUrl: '/music/bodorgo-fm/image/b2',
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
    expect(calls.at(-1).headers.Range).toBe('bytes=0-');
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

  it('once loaded, answers at once - an old list is refreshed in the background', async () => {
    const guest = await createGuest();
    const list = async () =>
      (
        await request(app).get('/music/bodorgo-fm/playlist').set(asUser(guest))
      ).body.data.tracks.map((t) => t.id);
    expect(await list()).toEqual(['a1', 'b2', 'c3']);

    // Jellyfin's list changes; hours later someone asks.
    ITEMS.push({ Id: 'd4', Name: 'Új dal' });
    const playlistCalls = () => calls.filter((c) => c.url.includes('/Playlists/')).length;
    const before = playlistCalls();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000);
    try {
      expect(await list()).toEqual(['a1', 'b2', 'c3']); // the old one, at once
      await vi.waitFor(() => expect(playlistCalls()).toBe(before + 1));
      await vi.waitFor(async () => expect(await list()).toEqual(['a1', 'b2', 'c3', 'd4']));
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

  it('Buli: members and admins only - its songs only through Buli', async () => {
    const guest = await request(app)
      .get('/music/buli/playlist')
      .set(asUser(await createGuest()));
    expect(guest.status).toBe(403);
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
