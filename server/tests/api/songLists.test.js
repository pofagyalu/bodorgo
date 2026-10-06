import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember } from '../helpers/factories.js';
import SongList from '../../src/models/songListModel.js';

// The Daloskönyv's playlists (songListController.js): each user's own.

// Only the role manager's songs are the book's; anyone may add one.
const createOwner = () => createAdmin({ name: 'Nagy Zoli', canManageRoles: true });
const addSong = async (user, title) =>
  (await request(app).post('/songs').set(asUser(user)).send({ title, chordpro: '[C]la' })).body.data
    .song;

const lists = (user) => request(app).get('/songs/lists').set(asUser(user));
const create = (user, body) => request(app).post('/songs/lists').set(asUser(user)).send(body);
const patch = (user, id, body) =>
  request(app).patch(`/songs/lists/${id}`).set(asUser(user)).send(body);
const remove = (user, id) => request(app).delete(`/songs/lists/${id}`).set(asUser(user));

describe('Daloskönyv: playlists', () => {
  it('needs a login', async () => {
    expect((await request(app).get('/songs/lists')).status).toBe(401);
    expect((await request(app).post('/songs/lists').send({ name: 'X' })).status).toBe(401);
  });

  it('keeps each user’s own lists, by name - a guest’s too', async () => {
    const member = await createMember();
    const guest = await createGuest();
    expect((await lists(member)).body.data.lists).toEqual([]);

    expect((await create(member, { name: '  Tábortűz ' })).status).toBe(201);
    await create(member, { name: 'Álmos dalok' });
    await create(guest, { name: 'A vendégé' });

    // By name, the Hungarian way; nobody sees anyone else's.
    expect((await lists(member)).body.data.lists.map((l) => l.name)).toEqual([
      'Álmos dalok',
      'Tábortűz',
    ]);
    expect((await lists(guest)).body.data.lists.map((l) => l.name)).toEqual(['A vendégé']);

    // A list needs a name, of a sane length.
    expect((await create(member, { name: '  ' })).status).toBe(400);
    expect((await create(member, { name: 'x'.repeat(61) })).status).toBe(400);
  });

  it('holds songs in the order given - each once, only songs that exist', async () => {
    const owner = await createOwner();
    const member = await createMember();
    const a = await addSong(owner, 'Alma');
    const b = await addSong(owner, 'Bor');
    // Someone else's song may stand in a list too.
    const c = await addSong(await createMember(), 'Cica');
    const { list } = (await create(member, { name: 'Lista' })).body.data;
    expect(list.songs).toEqual([]);

    const filled = await patch(member, list._id, { songs: [c._id, a._id, c._id, b._id] });
    expect(filled.status).toBe(200);
    expect(filled.body.data.list.songs).toEqual([c._id, a._id, b._id]);
    // Reordered, one taken out.
    expect((await patch(member, list._id, { songs: [b._id, c._id] })).body.data.list.songs).toEqual(
      [b._id, c._id],
    );
    // Renamed: the songs stay.
    const renamed = (await patch(member, list._id, { name: 'Esti lista' })).body.data.list;
    expect(renamed).toMatchObject({ name: 'Esti lista', songs: [b._id, c._id] });

    // A song that doesn't exist is left out; what isn't an id is refused.
    const ghost = '64b000000000000000000000';
    expect((await patch(member, list._id, { songs: [ghost, a._id] })).body.data.list.songs).toEqual(
      [a._id],
    );
    expect((await patch(member, list._id, { songs: ['nem-id'] })).status).toBe(400);
    expect((await patch(member, list._id, { songs: 'a' })).status).toBe(400);
  });

  it('is nobody else’s to see, change or delete - not even an admin’s', async () => {
    const member = await createMember();
    const { list } = (await create(member, { name: 'Az enyém' })).body.data;
    for (const other of [await createMember(), await createOwner()]) {
      expect((await patch(other, list._id, { name: 'X' })).status).toBe(404);
      expect((await remove(other, list._id)).status).toBe(404);
    }
    expect((await patch(member, 'nem-id', { name: 'X' })).status).toBe(404);
    expect((await remove(member, list._id)).status).toBe(204);
    expect(await SongList.countDocuments()).toBe(0);
  });

  it('loses a song that is deleted from the songbook', async () => {
    const owner = await createOwner();
    const member = await createMember();
    const a = await addSong(owner, 'Alma');
    const b = await addSong(owner, 'Bor');
    const { list } = (await create(member, { name: 'Lista', songs: [a._id, b._id] })).body.data;
    expect(list.songs).toEqual([a._id, b._id]);

    expect((await request(app).delete(`/songs/${a._id}`).set(asUser(owner))).status).toBe(204);
    expect((await lists(member)).body.data.lists[0].songs).toEqual([b._id]);
    // The list itself is not a song: its address isn't taken for one.
    expect((await request(app).get('/songs/lists').set(asUser(member))).status).toBe(200);
  });
});
