import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember } from '../helpers/factories.js';
import Song from '../../src/models/songModel.js';
import { songsByArtist } from '../../src/songs/songBook.js';

// Daloskönyv: the songbook (songController.js).

// Only the role manager edits it (utils/roleManager.js).
const createOwner = () => createAdmin({ name: 'Nagy Zoli', canManageRoles: true });

const add = (user, body) => request(app).post('/songs').set(asUser(user)).send(body);

describe('Daloskönyv: who gets in', () => {
  it('everyone logged in reads it - guests too', async () => {
    const owner = await createOwner();
    await add(owner, { title: 'Próbadal', chordpro: '[C]Elindultunk' });

    expect((await request(app).get('/songs')).status).toBe(401);
    expect((await request(app).get('/songs/probadal')).status).toBe(401);
    for (const user of [await createGuest(), await createMember(), await createAdmin()]) {
      const list = await request(app).get('/songs').set(asUser(user));
      expect(list.status).toBe(200);
      expect(list.body.data.canEdit).toBe(false);
      expect(list.body.data.songs).toHaveLength(1);
      expect((await request(app).get('/songs/probadal').set(asUser(user))).status).toBe(200);
    }
    expect((await request(app).get('/songs').set(asUser(owner))).body.data.canEdit).toBe(true);
  });

  it('anyone logged in adds a song - theirs to change, and beside the book, not in it', async () => {
    const owner = await createOwner();
    const mine = (await add(owner, { title: 'Könyvbeli', chordpro: '[C]la' })).body.data.song;
    // The keeper's song is the book's own, and carries no name.
    expect(mine).toMatchObject({ inBook: true, ownerName: '', canEdit: true });
    expect(mine.owner).toBeUndefined();

    const melinda = await createMember({ name: 'Kis Melinda' });
    const csaba = await createGuest({ name: 'Nagy Csaba' });
    const added = await add(melinda, { title: 'Melinda dala', chordpro: '[G]la' });
    expect(added.status).toBe(201);
    const hers = added.body.data.song;
    expect(hers).toMatchObject({ inBook: false, ownerName: 'Melinda', canEdit: true });
    // A guest too.
    expect((await add(csaba, { title: 'Csaba dala' })).status).toBe(201);

    // Everyone sees all three, each saying whose it is and who may change it.
    const seenBy = async (user) =>
      Object.fromEntries(
        (await request(app).get('/songs').set(asUser(user))).body.data.songs.map((song) => [
          song.title,
          [song.inBook, song.ownerName, song.canEdit],
        ]),
      );
    expect(await seenBy(csaba)).toEqual({
      Könyvbeli: [true, '', false],
      'Melinda dala': [false, 'Melinda', false],
      'Csaba dala': [false, 'Csaba', true],
    });
    expect(await seenBy(owner)).toEqual({
      Könyvbeli: [true, '', true],
      'Melinda dala': [false, 'Melinda', true],
      'Csaba dala': [false, 'Csaba', true],
    });
    // The song itself says the same.
    const one = await request(app).get('/songs/melinda-dala').set(asUser(csaba));
    expect(one.body.data.song).toMatchObject({
      inBook: false,
      ownerName: 'Melinda',
      canEdit: false,
    });

    const patch = (user, id, body) =>
      request(app).patch(`/songs/${id}`).set(asUser(user)).send(body);
    const remove = (user, id) => request(app).delete(`/songs/${id}`).set(asUser(user));
    // Her own: hers to change. Someone else's, and the book's: not - not
    // even for another admin.
    expect((await patch(melinda, hers._id, { artist: 'Ő maga' })).status).toBe(200);
    for (const user of [csaba, await createAdmin()]) {
      expect((await patch(user, hers._id, { title: 'X' })).status).toBe(403);
      expect((await remove(user, hers._id)).status).toBe(403);
      expect((await patch(user, mine._id, { title: 'X' })).status).toBe(403);
      expect((await remove(user, mine._id)).status).toBe(403);
    }
    // The keeper changes every song.
    expect((await patch(owner, hers._id, { tempo: 100 })).body.data.song).toMatchObject({
      tempo: 100,
      ownerName: 'Melinda',
      inBook: false,
    });
    // Her song stays hers after the keeper's change.
    expect((await patch(melinda, hers._id, { tempo: 90 })).status).toBe(200);
    expect((await remove(melinda, hers._id)).status).toBe(204);
    expect(await Song.countDocuments()).toBe(2);
  });

  it('only the keeper takes a song into the book - the book is its own songs alone', async () => {
    const owner = await createOwner();
    const melinda = await createMember({ name: 'Kis Melinda' });
    await add(owner, { title: 'Könyvbeli', chordpro: '[C]la' });
    const hers = (await add(melinda, { title: 'Melinda dala', chordpro: '[G]la' })).body.data.song;
    const patch = (user, body) =>
      request(app).patch(`/songs/${hers._id}`).set(asUser(user)).send(body);
    const pages = async () => {
      const res = await request(app)
        .get('/songs/book.pdf')
        .set(asUser(melinda))
        .buffer()
        .parse((r, done) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => done(null, Buffer.concat(chunks)));
        });
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      return (await getDocument({ data: new Uint8Array(res.body), verbosity: 0 }).promise).numPages;
    };

    // The cover, the contents, one song, two annexes, the index.
    expect(await pages()).toBe(6);
    // Her own song as a PDF: hers to print all the same.
    expect((await request(app).get('/songs/melinda-dala/pdf').set(asUser(melinda))).status).toBe(
      200,
    );

    // Not hers to say.
    expect((await patch(melinda, { inBook: true })).status).toBe(403);
    expect((await patch(owner, { inBook: true })).body.data.song).toMatchObject({
      inBook: true,
      ownerName: '',
    });
    expect(await pages()).toBe(7);
    // Taken into the book it is the keeper's own, like every song of the
    // book: no longer hers to change or delete.
    expect(String((await Song.findById(hers._id)).owner)).toBe(String(owner._id));
    expect((await patch(melinda, { artist: 'Ő maga' })).status).toBe(403);
    expect((await request(app).delete(`/songs/${hers._id}`).set(asUser(melinda))).status).toBe(403);
    const seen = (await request(app).get('/songs/melinda-dala').set(asUser(melinda))).body.data
      .song;
    expect(seen).toMatchObject({ inBook: true, ownerName: '', canEdit: false });
    // And out again: beside the book, the keeper's still - under the
    // keeper's name now.
    const out = (await patch(owner, { inBook: false })).body.data.song;
    expect(out).toMatchObject({ inBook: false, ownerName: 'Zoli' });
    expect((await patch(melinda, { artist: 'Ő maga' })).status).toBe(403);
    expect(await pages()).toBe(6);
  });

  it('takes a song from before owners for the keeper’s, and the book’s', async () => {
    // As the songs stood before: no owner, no inBook.
    await Song.collection.insertOne({
      title: 'Régi dal',
      artist: '',
      slug: 'regi-dal',
      chordpro: '[C]la',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const owner = await createOwner();
    const member = await createMember();
    const seen = (await request(app).get('/songs/regi-dal').set(asUser(member))).body.data.song;
    expect(seen).toMatchObject({ inBook: true, ownerName: '', canEdit: false });
    expect(
      (await request(app).patch(`/songs/${seen._id}`).set(asUser(member)).send({ title: 'X' }))
        .status,
    ).toBe(403);
    expect(
      (await request(app).patch(`/songs/${seen._id}`).set(asUser(owner)).send({ tempo: 80 }))
        .status,
    ).toBe(200);
    expect((await request(app).get('/songs/book.pdf').set(asUser(member))).status).toBe(200);
  });
});

describe('Daloskönyv: the songs', () => {
  it('adds songs with a slug from the title', async () => {
    const owner = await createOwner();
    const first = await add(owner, {
      title: '  Eső után ',
      artist: 'Bódorgók',
      chordpro: '[Am]Első sor\r\n[F]Második',
    });
    expect(first.status).toBe(201);
    expect(first.body.data.song).toMatchObject({
      title: 'Eső után',
      artist: 'Bódorgók',
      slug: 'eso-utan',
      chordpro: '[Am]Első sor\n[F]Második',
    });
    // The same title again: its own address.
    expect((await add(owner, { title: 'Eső után' })).body.data.song.slug).toBe('eso-utan-2');
  });

  it('lists them by title, the Hungarian way, without the lyrics', async () => {
    const owner = await createOwner();
    for (const title of ['Zöld csillag', 'Érzés', 'Első', 'Álmodtam', 'Ajándék', 'Eső után']) {
      await add(owner, { title, chordpro: '[C]la' });
    }
    const res = await request(app).get('/songs').set(asUser(owner));
    // Accents don't send a title to the end of the list.
    expect(res.body.data.songs.map((s) => s.title)).toEqual([
      'Ajándék',
      'Álmodtam',
      'Első',
      'Érzés',
      'Eső után',
      'Zöld csillag',
    ]);
    expect(res.body.data.songs[0].chordpro).toBeUndefined();

    const one = await request(app).get('/songs/elso').set(asUser(owner));
    expect(one.body.data.song.chordpro).toBe('[C]la');
    expect((await request(app).get('/songs/nincs-ilyen').set(asUser(owner))).status).toBe(404);
  });

  it('refuses a song without a title', async () => {
    const owner = await createOwner();
    expect((await add(owner, { title: '  ' })).status).toBe(400);
    expect((await add(owner, {})).status).toBe(400);
  });

  it('changes a song - a new title moves its address', async () => {
    const owner = await createOwner();
    const { song } = (await add(owner, { title: 'Régi cím', chordpro: '[C]la' })).body.data;
    const patch = (body) => request(app).patch(`/songs/${song._id}`).set(asUser(owner)).send(body);

    // Only what was sent changes.
    const lyrics = await patch({ chordpro: '[G]la la' });
    expect(lyrics.body.data.song).toMatchObject({
      title: 'Régi cím',
      slug: 'regi-cim',
      chordpro: '[G]la la',
    });
    expect((await patch({ title: 'Új cím' })).body.data.song.slug).toBe('uj-cim');
    expect((await patch({ title: '' })).status).toBe(400);
    expect(
      (await request(app).patch('/songs/nem-azonosito').set(asUser(owner)).send({ title: 'X' }))
        .status,
    ).toBe(404);
  });

  it('keeps the key a song was first written in, once it is saved in another', async () => {
    const owner = await createOwner();
    const { song } = (await add(owner, { title: 'Dal', chordpro: '[am]la [D]la' })).body.data;
    expect(song.originalKey).toBe('');
    const patch = (body) => request(app).patch(`/songs/${song._id}`).set(asUser(owner)).send(body);

    const moved = await patch({ chordpro: '[hm]la [E]la', originalKey: ' am ' });
    expect(moved.body.data.song).toMatchObject({ chordpro: '[hm]la [E]la', originalKey: 'am' });
    // Everyone reading the song gets it.
    const read = await request(app)
      .get('/songs/dal')
      .set(asUser(await createGuest()));
    expect(read.body.data.song.originalKey).toBe('am');
    // Changing the text later leaves it alone.
    expect((await patch({ chordpro: '[hm]la la' })).body.data.song.originalKey).toBe('am');
    expect((await patch({ originalKey: 'x'.repeat(13) })).status).toBe(400);
  });

  it('gives every song’s words for the search - compressed, without the chords', async () => {
    const owner = await createOwner();
    const verse = '[C]Tavaszi szél vi[G]zet áraszt, [am]virágom, vi[C]rágom\n';
    const one = (
      await add(owner, {
        title: 'Tavaszi szél',
        chordpro: `[Intro] [C] [G]\n${verse.repeat(40)}\n{comment: 2x}`,
      })
    ).body.data.song;
    await add(owner, { title: 'Akkordok', chordpro: '[C] [G] [am]' });

    expect((await request(app).get('/songs/lyrics')).status).toBe(401);
    const res = await request(app)
      .get('/songs/lyrics')
      .set(asUser(await createGuest()))
      .set('Accept-Encoding', 'gzip');
    expect(res.status).toBe(200);
    // Worth compressing, and compressed.
    expect(res.headers['content-encoding']).toBe('gzip');
    const { lyrics } = res.body.data;
    expect(lyrics).toHaveLength(2);
    const words = lyrics.find((l) => l._id === one._id).lines;
    expect(words).toHaveLength(40);
    // A chord inside a word is out of it; labels and comments aren't words.
    expect(words[0]).toBe('Tavaszi szél vizet áraszt, virágom, virágom');
    expect(lyrics.find((l) => l._id !== one._id).lines).toEqual([]);

    // A changed song's words are the new ones.
    await request(app)
      .patch(`/songs/${one._id}`)
      .set(asUser(owner))
      .send({ chordpro: '[C]Új sor' });
    const again = await request(app).get('/songs/lyrics').set(asUser(owner));
    expect(again.body.data.lyrics.find((l) => l._id === one._id).lines).toEqual(['Új sor']);
  });

  it('says the key the chords are in - in the list and with the song', async () => {
    const owner = await createOwner();
    await add(owner, { title: 'Dúr', chordpro: '[C]la [F]la [G]la [C]la' });
    await add(owner, { title: 'Moll', chordpro: '[am]la [dm]la [E]la [am]la' });
    await add(owner, { title: 'Szöveg', chordpro: 'csak szöveg' });

    const guest = await createGuest();
    const list = await request(app).get('/songs').set(asUser(guest));
    expect(list.body.data.songs.map((s) => [s.title, s.key, s.detectedKey])).toEqual([
      ['Dúr', '', 'C'],
      ['Moll', '', 'am'],
      ['Szöveg', '', ''],
    ]);
    // The list still has no lyrics.
    expect(list.body.data.songs[0].chordpro).toBeUndefined();
    const one = await request(app).get('/songs/moll').set(asUser(guest));
    expect(one.body.data.song).toMatchObject({ key: '', detectedKey: 'am' });
  });

  it('keeps a key set by hand until the chords are changed', async () => {
    const owner = await createOwner();
    const { song } = (await add(owner, { title: 'Dal', chordpro: '[C]la [F]la [G]la' })).body.data;
    expect(song).toMatchObject({ key: '', detectedKey: 'C' });
    const patch = (body) => request(app).patch(`/songs/${song._id}`).set(asUser(owner)).send(body);

    // Set by hand: it overrules what the chords say, which is still told.
    expect((await patch({ key: ' am ' })).body.data.song).toMatchObject({
      key: 'am',
      detectedKey: 'C',
    });
    // The words change, the chords don't: it stays.
    const words = await patch({ chordpro: '[C]lalala [F]la [G]la' });
    expect(words.body.data.song.key).toBe('am');
    // The chords change: it is dropped, the key is worked out again.
    const chords = await patch({ chordpro: '[G]la [C]la [D]la [G]la' });
    expect(chords.body.data.song).toMatchObject({ key: '', detectedKey: 'G' });
    // New chords with a key sent along (the editor, a song saved in a new
    // key): that key is kept.
    const both = await patch({ chordpro: '[A]la [D]la [E]la', key: 'f#m' });
    expect(both.body.data.song).toMatchObject({ key: 'f#m', detectedKey: 'A' });
    // Back to what the chords say.
    expect((await patch({ key: '' })).body.data.song.key).toBe('');
    // Only a chord's name is a key.
    expect((await patch({ key: 'Intro' })).status).toBe(400);
  });

  it('keeps a tempo given by hand - a whole number of beats a minute, or none', async () => {
    const owner = await createOwner();
    const { song } = (await add(owner, { title: 'Dal', chordpro: '[C]la [G]la', tempo: 96 })).body
      .data;
    expect(song.tempo).toBe(96);
    const patch = (body) => request(app).patch(`/songs/${song._id}`).set(asUser(owner)).send(body);

    // A song without one says null.
    const bare = (await add(owner, { title: 'Másik' })).body.data.song;
    expect(bare.tempo).toBeNull();

    // Changing the chords leaves it alone.
    expect((await patch({ chordpro: '[D]la [A]la' })).body.data.song.tempo).toBe(96);
    expect((await patch({ tempo: '120' })).body.data.song.tempo).toBe(120);
    // Taken away again.
    expect((await patch({ tempo: null })).body.data.song.tempo).toBeNull();
    expect((await patch({ tempo: '' })).body.data.song.tempo).toBeNull();
    // Out of bounds, a fraction, a word.
    for (const tempo of [29, 301, 96.5, 'gyors']) {
      expect((await patch({ tempo })).status).toBe(400);
    }
  });

  it('deletes a song', async () => {
    const owner = await createOwner();
    const { song } = (await add(owner, { title: 'Törlendő' })).body.data;
    expect((await request(app).delete(`/songs/${song._id}`).set(asUser(owner))).status).toBe(204);
    expect(await Song.countDocuments()).toBe(0);
    expect((await request(app).delete(`/songs/${song._id}`).set(asUser(owner))).status).toBe(404);
  });
});

describe('Daloskönyv: the book as a PDF', () => {
  const book = (user, query = '') =>
    request(app)
      .get(`/songs/book.pdf${query}`)
      .set(asUser(user))
      .buffer()
      .parse((res, done) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });

  it('is for everyone logged in, and there only once there is a song', async () => {
    const owner = await createOwner();
    expect((await request(app).get('/songs/book.pdf')).status).toBe(401);
    expect((await request(app).get('/songs/book.pdf').set(asUser(owner))).status).toBe(404);

    await add(owner, {
      title: 'Próbadal',
      artist: 'Bódorgók',
      chordpro: '[C]Elindultunk [am]reggel',
    });
    for (const user of [await createGuest(), await createMember()]) {
      const res = await book(user);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('inline');
      expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    }
  });

  it('draws the chord diagrams asked for, on the paper asked for, as a download', async () => {
    const owner = await createOwner();
    await add(owner, {
      title: 'Próbadal',
      chordpro: '[C]Elindultunk [am]reggel\n\n{soc}\n[F]Hej [G/H]hó\n{eoc}',
    });
    const plain = await book(owner);
    const guitar = await book(owner, '?diagrams=guitar&size=A5&download=1');
    expect(guitar.status).toBe(200);
    expect(guitar.headers['content-disposition']).toContain('attachment');
    expect(guitar.body.subarray(0, 5).toString()).toBe('%PDF-');
    // The diagrams are more to draw.
    expect(guitar.body.length).not.toBe(plain.body.length);
    // An unknown instrument or paper: the plain A4 book.
    expect((await book(owner, '?diagrams=harp&size=A0')).body.length).toBe(plain.body.length);
  });

  it('ends with the songs grouped by their artists', async () => {
    // Made-up songs. The artists in the Hungarian alphabet's order, each
    // one's songs by title, the songs without an artist last.
    const songs = [
      { title: 'Zúg az erdő', artist: 'Ökörszem' },
      { title: 'Alma', artist: '' },
      { title: 'Ősz', artist: 'Árnyék' },
      { title: 'Este', artist: 'Ökörszem' },
      { title: 'Dél', artist: ' Zenebona ' },
    ];
    expect(songsByArtist(songs)).toEqual([
      { artist: 'Árnyék', songs: [{ title: 'Ősz', at: 2 }] },
      {
        artist: 'Ökörszem',
        songs: [
          { title: 'Este', at: 3 },
          { title: 'Zúg az erdő', at: 0 },
        ],
      },
      { artist: 'Zenebona', songs: [{ title: 'Dél', at: 4 }] },
      { artist: 'Előadó nélkül', songs: [{ title: 'Alma', at: 1 }] },
    ]);

    // In the book: its last page, named in the contents.
    const owner = await createOwner();
    for (const song of songs) await add(owner, { ...song, chordpro: '[C]la' });
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await getDocument({
      data: new Uint8Array((await book(owner)).body),
      verbosity: 0,
    }).promise;
    const textOf = async (n) =>
      (await (await pdf.getPage(n)).getTextContent()).items.map((i) => i.str).join(' ');
    // The cover, the contents, five songs, two annexes, the index.
    expect(pdf.numPages).toBe(10);
    const contents = await textOf(2);
    expect(contents).toContain('Mutató');
    expect(contents).toContain('Dalok előadók szerint');
    const index = await textOf(10);
    expect(index).toContain('Dalok előadók szerint');
    expect(index.indexOf('Árnyék')).toBeLessThan(index.indexOf('Ökörszem'));
    expect(index.indexOf('Ökörszem')).toBeLessThan(index.indexOf('Zenebona'));
    expect(index.indexOf('Zenebona')).toBeLessThan(index.indexOf('Előadó nélkül'));
  });

  it('is drawn again after a song changes', async () => {
    const owner = await createOwner();
    const { song } = (await add(owner, { title: 'Próbadal', chordpro: '[C]la' })).body.data;
    const before = await book(owner);
    // Asked again: the same book.
    expect((await book(owner)).body.equals(before.body)).toBe(true);
    await request(app)
      .patch(`/songs/${song._id}`)
      .set(asUser(owner))
      .send({ chordpro: '[C]la la la la la\n[G]la la la la la\n[am]la la la la' });
    expect((await book(owner)).body.equals(before.body)).toBe(false);
  });

  it('prints the lines after a {screen} mark with their words alone, until a {print}', async () => {
    // Made-up words. From the mark on the chords are for the screen only -
    // two verses here -, then {print} brings them back.
    const owner = await createOwner();
    await add(owner, {
      title: 'Próbadal',
      chordpro: [
        '[C]Kint a [G]réten',
        '',
        '{screen}',
        '[F#m]Bent a [Eb]házban',
        '[F#m] [Eb]',
        '',
        '[Eb]Fent a hegyen',
        '',
        '{print}',
        '[Dsus4]Lent a völgyben',
      ].join('\n'),
    });
    const res = await request(app)
      .get('/songs/probadal/pdf')
      .set(asUser(owner))
      .buffer()
      .parse((r, done) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await getDocument({ data: new Uint8Array(res.body), verbosity: 0 }).promise;
    const text = (await (await doc.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
    // Both verses' words, the first one's chords - not the marked one's,
    // nor the mark.
    expect(text).toContain('Kint a');
    expect(text).toContain('Bent a házban');
    expect(text).toContain('Fent a hegyen');
    expect(text).toContain('G');
    // After {print}: with its chord again.
    expect(text).toContain('Dsus');
    expect(text).not.toContain('F#m');
    expect(text).not.toContain('Eb');
    expect(text).not.toContain('screen');
  });

  it('gives one song alone as a PDF - moved to another key if asked', async () => {
    const owner = await createOwner();
    await add(owner, {
      title: 'Tavaszi szél',
      artist: 'Népdal',
      chordpro: '[am]Tavaszi szél [dm]vizet áraszt, [E7]virágom, vi[am]rágom',
    });
    const guest = await createGuest();
    const pdf = (query = '') =>
      request(app)
        .get(`/songs/tavaszi-szel/pdf${query}`)
        .set(asUser(guest))
        .buffer()
        .parse((res, done) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
    // What the PDF says, as text.
    const textOf = async (body) => {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const doc = await getDocument({ data: new Uint8Array(body), verbosity: 0 }).promise;
      const page = await (await doc.getPage(1)).getTextContent();
      return { pages: doc.numPages, text: page.items.map((i) => i.str).join(' ') };
    };

    expect((await request(app).get('/songs/tavaszi-szel/pdf')).status).toBe(401);
    expect((await request(app).get('/songs/nincs-ilyen/pdf').set(asUser(guest))).status).toBe(404);

    const plain = await pdf();
    expect(plain.status).toBe(200);
    expect(plain.headers['content-type']).toBe('application/pdf');
    expect(plain.headers['content-disposition']).toBe('inline; filename="tavaszi-szel.pdf"');
    const said = await textOf(plain.body);
    // The song alone: one page, its title, artist, key, chords and words.
    expect(said.pages).toBe(1);
    for (const part of ['Tavaszi szél', 'Népdal', 'a-moll', 'am', 'dm', 'vizet áraszt']) {
      expect(said.text, part).toContain(part);
    }

    // Two semitones up: h-moll, its chords moved - and as a download.
    const moved = await pdf('?transpose=2&diagrams=guitar&download=1');
    expect(moved.headers['content-disposition']).toContain('attachment');
    const movedText = (await textOf(moved.body)).text;
    for (const part of ['h-moll', 'hm', 'em', 'F#']) expect(movedText, part).toContain(part);
    expect(movedText).not.toContain('a-moll');
    // Not a number of semitones: the song as it is saved.
    expect((await textOf((await pdf('?transpose=sok')).body)).text).toContain('a-moll');
  });

  it('gives its cover as a small picture, and says when the songs last changed', async () => {
    const owner = await createOwner();
    const guest = await createGuest();
    expect((await request(app).get('/songs/book.webp')).status).toBe(401);
    expect((await request(app).get('/songs/book.webp').set(asUser(guest))).status).toBe(404);
    expect((await request(app).get('/songs').set(asUser(guest))).body.data.lastChanged).toBeNull();

    const { song } = (await add(owner, { title: 'Próbadal', chordpro: '[C]la' })).body.data;
    const res = await request(app)
      .get('/songs/book.webp?diagrams=guitar')
      .set(asUser(guest))
      .buffer()
      .parse((r, done) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    // A WebP file: "RIFF", its size, "WEBP".
    expect(res.body.subarray(0, 4).toString()).toBe('RIFF');
    expect(res.body.subarray(8, 12).toString()).toBe('WEBP');

    const list = await request(app).get('/songs').set(asUser(guest));
    expect(list.body.data.lastChanged).toBe(song.updatedAt);
  });
});
