import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember } from '../helpers/factories.js';
import { scanFinished } from '../../src/utils/libraryIndex.js';

// A small library in the test's temporary folder (see setup.js's
// LIBRARY_DIR): two shelves, a book with text and bookmarks, and one
// without any text (as a scan before OCR).
const root = process.env.LIBRARY_DIR;

function makePdf(rel, pages, { bookmarks = false } = {}) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return new Promise((resolve) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const out = fs.createWriteStream(file);
    out.on('finish', resolve);
    doc.pipe(out);
    pages.forEach((text, i) => {
      doc.addPage();
      if (bookmarks) doc.outline.addItem(`Fejezet ${i + 1}`);
      if (text) doc.fontSize(14).text(text);
    });
    doc.end();
  });
}

beforeAll(async () => {
  await makePdf(
    'gitar/dalos_konyv.pdf',
    [
      'Darabokra törted a szívem - Demjén Ferenc',
      'Mindenki másképp csinálja - Presser',
      // (pdfkit's built-in font has no ő or ű.)
      'A felkelo nap háza',
    ],
    { bookmarks: true },
  );
  await makePdf('harmonika/scan.pdf', ['', '']);
  fs.mkdirSync(path.join(root, 'ures'), { recursive: true });
  fs.mkdirSync(path.join(root, '_eredeti'), { recursive: true });
  fs.writeFileSync(path.join(root, 'gitar', 'notes.txt'), 'x'); // not a book
});

const createOwner = () => createAdmin({ canManageRoles: true });

async function scanned(owner) {
  const res = await request(app).post('/library/scan').set(asUser(owner));
  expect(res.status).toBe(202);
  await scanFinished();
  const list = await request(app).get('/library').set(asUser(owner));
  return list.body.data;
}

const bookOn = (data, shelf) => data.shelves.find((s) => s.key === shelf).books[0];

describe('Könyvtár', () => {
  it("is the role manager's alone - 404 for every other admin and member", async () => {
    for (const user of [await createAdmin(), await createMember()]) {
      for (const [method, url] of [
        ['get', '/library'],
        ['post', '/library/scan'],
        ['get', '/library/search?q=nap'],
      ]) {
        const res = await request(app)[method](url).set(asUser(user));
        expect(res.status).toBe(404);
      }
    }
    expect((await request(app).get('/library')).status).toBe(401);
  });

  it('reads the folders: shelves by name, books with their text and bookmarks', async () => {
    const owner = await createOwner();
    const data = await scanned(owner);
    // "_eredeti" is not a shelf; an empty folder is.
    expect(data.shelves.map((s) => [s.key, s.title, s.books.length])).toEqual([
      ['gitar', 'Gitár', 1],
      ['harmonika', 'Harmonika', 1],
      ['ures', 'Ures', 0],
    ]);
    expect(data.scan).toMatchObject({ running: false, done: 2, total: 2, errors: [] });
    expect(bookOn(data, 'gitar')).toMatchObject({
      title: 'dalos konyv',
      pages: 3,
      hasText: true,
      pageOffset: 0,
    });
    expect(bookOn(data, 'harmonika')).toMatchObject({ pages: 2, hasText: false });

    const res = await request(app)
      .get(`/library/books/${bookOn(data, 'gitar')._id}`)
      .set(asUser(owner));
    expect(res.body.data.book.toc).toEqual([
      { title: 'Fejezet 1', page: 1, level: 0 },
      { title: 'Fejezet 2', page: 2, level: 0 },
      { title: 'Fejezet 3', page: 3, level: 0 },
    ]);
  });

  it('searches without accents: titles, contents and page text', async () => {
    const owner = await createOwner();
    const data = await scanned(owner);
    const gitar = bookOn(data, 'gitar');
    const search = (q, shelf = '') =>
      request(app).get('/library/search').query({ q, shelf }).set(asUser(owner));

    // Every word must be on the page, in any order.
    let res = await search('SZIVEM darabokra');
    expect(res.body.data.pages).toEqual([
      {
        book: String(gitar._id),
        page: 1,
        snippet: { before: 'Darabokra törted a ', match: 'szívem', after: ' - Demjén Ferenc' },
      },
    ]);
    expect(res.body.data.books[String(gitar._id)].title).toBe('dalos konyv');

    res = await search('HAZA nap');
    expect(res.body.data.pages.map((p) => p.page)).toEqual([3]);

    res = await search('fejezet 2');
    expect(res.body.data.contents).toEqual([
      { book: String(gitar._id), page: 2, title: 'Fejezet 2' },
    ]);

    res = await search('KONYV');
    expect(res.body.data.titles.map((b) => b.title)).toEqual(['dalos konyv']);

    // Another shelf has none of it.
    res = await search('haza', 'harmonika');
    expect(res.body.data.pages).toEqual([]);

    expect((await search('a')).status).toBe(400);
  });

  it('gives a page as a picture, and 404 past the last one', async () => {
    const owner = await createOwner();
    const gitar = bookOn(await scanned(owner), 'gitar');
    const res = await request(app).get(`/library/books/${gitar._id}/pages/2`).set(asUser(owner));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.body.subarray(0, 4).toString()).toBe('RIFF');
    expect(
      (await request(app).get(`/library/books/${gitar._id}/pages/4`).set(asUser(owner))).status,
    ).toBe(404);
  });

  it('keeps the title, page shift and written contents over a new scan', async () => {
    const owner = await createOwner();
    const gitar = bookOn(await scanned(owner), 'gitar');
    const patch = (body) =>
      request(app).patch(`/library/books/${gitar._id}`).set(asUser(owner)).send(body);

    const res = await patch({
      title: 'Csalamádé 1.',
      subtitle: ' Tábortuz mellé ',
      author: 'Dobay',
      pageOffset: 2,
      toc: [{ title: 'Mindenki másképp csinálja', page: 2 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.book).toMatchObject({
      title: 'Csalamádé 1.',
      subtitle: 'Tábortuz mellé',
      author: 'Dobay',
      pageOffset: 2,
      toc: [{ title: 'Mindenki másképp csinálja', page: 2, level: 0 }],
    });
    expect((await patch({ toc: [{ title: 'Nincs', page: 9 }] })).status).toBe(400);
    expect((await patch({ title: ' ' })).status).toBe(400);
    expect((await patch({ author: 'x'.repeat(201) })).status).toBe(400);
    // A book is found by its author too.
    const found = await request(app)
      .get('/library/search')
      .query({ q: 'DOBAY' })
      .set(asUser(owner));
    expect(found.body.data.titles.map((b) => b.title)).toEqual(['Csalamádé 1.']);
    expect((await patch({ pageOffset: 1.5 })).status).toBe(400);

    // The file replaced: read again, what was written by hand stays.
    const file = path.join(root, 'gitar', 'dalos_konyv.pdf');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    const again = bookOn(await scanned(owner), 'gitar');
    expect(again).toMatchObject({ _id: gitar._id, title: 'Csalamádé 1.', pageOffset: 2 });
    const book = await request(app).get(`/library/books/${gitar._id}`).set(asUser(owner));
    expect(book.body.data.book.toc).toHaveLength(1);
  });

  it('drops a book whose file is gone', async () => {
    const owner = await createOwner();
    await makePdf('ures/kicsi.pdf', ['Egy oldal szöveggel, hogy legyen mit olvasni.']);
    expect(bookOn(await scanned(owner), 'ures').title).toBe('kicsi');
    fs.rmSync(path.join(root, 'ures', 'kicsi.pdf'));
    const data = await scanned(owner);
    expect(data.shelves.find((s) => s.key === 'ures').books).toEqual([]);
  });

  it('proposes a table of contents from the largest text, and a line from a page', async () => {
    const owner = await createOwner();
    // Each page: a title written large, then ordinary text.
    const file = path.join(root, 'ures', 'fejezetek.pdf');
    await new Promise((resolve) => {
      const doc = new PDFDocument({ autoFirstPage: false });
      const out = fs.createWriteStream(file);
      out.on('finish', resolve);
      doc.pipe(out);
      for (const title of ['Bevezetés', 'Skálák', 'Skálák']) {
        doc.addPage();
        doc.fontSize(24).text(title);
        doc.fontSize(11).text('Itt sok apró betus szöveg áll a cím alatt, több sorban is.');
        doc.text('Még egy sor, hogy a kis betu legyen a jellemzo ezen az oldalon.');
      }
      doc.addPage();
      doc.fontSize(11).text('Ezen az oldalon nincs cím, csak szöveg.');
      doc.end();
    });
    const book = bookOn(await scanned(owner), 'ures');

    const res = await request(app)
      .get(`/library/books/${book._id}/toc-proposal`)
      .set(asUser(owner));
    // The same title again (a running head) and a page without one are left out.
    expect(res.body.data.toc).toEqual([
      { title: 'Bevezetés', page: 1, level: 0 },
      { title: 'Skálák', page: 2, level: 0 },
    ]);
    // Nothing was saved.
    const saved = await request(app).get(`/library/books/${book._id}`).set(asUser(owner));
    expect(saved.body.data.book.toc).toEqual([]);

    const opening = await request(app)
      .get(`/library/books/${book._id}/pages/4/opening`)
      .set(asUser(owner));
    expect(opening.body.data.opening).toBe('Ezen az oldalon nincs cím, csak');
    fs.rmSync(file);
  });

  it('takes a long table of contents - more than the 10 kB other requests may send', async () => {
    const owner = await createOwner();
    const gitar = bookOn(await scanned(owner), 'gitar');
    const toc = Array.from({ length: 400 }, (_, i) => ({
      title: `Egy elég hosszú dalcím a könyvbol, a ${i + 1}. a sorban`,
      page: (i % 3) + 1,
    }));
    const res = await request(app)
      .patch(`/library/books/${gitar._id}`)
      .set(asUser(owner))
      .send({ toc });
    expect(res.status).toBe(200);
    expect(res.body.data.book.toc).toHaveLength(400);
  });

  it('puts an uploaded PDF on its shelf and reads it', async () => {
    const owner = await createOwner();
    await makePdf('_eredeti/feltoltendo.pdf', ['Feltöltött könyv egyetlen oldala, szöveggel.']);
    const pdf = fs.readFileSync(path.join(root, '_eredeti', 'feltoltendo.pdf'));
    const upload = (shelf, name, content = pdf) =>
      request(app)
        .post(`/library/shelves/${shelf}/books`)
        .set(asUser(owner))
        .attach('file', content, name);

    const res = await upload('ures', 'Új: könyv?.pdf');
    expect(res.status).toBe(202);
    await scanFinished();
    // The name made safe for a file, the title from it.
    expect(fs.existsSync(path.join(root, 'ures', 'Új könyv.pdf'))).toBe(true);
    const list = await request(app).get('/library').set(asUser(owner));
    expect(bookOn(list.body.data, 'ures')).toMatchObject({ title: 'Új könyv', hasText: true });

    expect((await upload('ures', 'Új könyv.pdf')).status).toBe(409);
    expect((await upload('ures', 'kep.jpg')).status).toBe(400);
    expect((await upload('ures', 'hamis.pdf', Buffer.from('nem pdf'))).status).toBe(400);
    expect((await upload('nincs-ilyen', 'a.pdf')).status).toBe(404);
    expect((await upload('_eredeti', 'a.pdf')).status).toBe(404);
    // Nothing half-uploaded is left behind.
    expect(fs.readdirSync(path.join(root, 'ures'))).toEqual(['Új könyv.pdf']);
    fs.rmSync(path.join(root, 'ures', 'Új könyv.pdf'));
  });
});
