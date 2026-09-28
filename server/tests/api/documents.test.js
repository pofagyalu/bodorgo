import fs from 'fs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createTour } from '../helpers/factories.js';
import Document, { documentFilePath } from '../../src/models/documentModel.js';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { previewPath } from '../../src/utils/documentPreviews.js';

const PDF = Buffer.from('%PDF-1.4 test');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

// One upload route for both kinds: the fields, then the file.
const upload = (user, fields, file = PDF, type = 'application/pdf', filename = 'x.pdf') => {
  let r = request(app).post('/documents').set(asUser(user));
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('file', file, { filename, contentType: type });
};

describe('club documents', () => {
  it('admin uploads; any logged-in user lists and opens; admin deletes', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const up = await upload(admin, {
      name: 'Alapító okirat',
      category: 'Alapdokumentumok',
      year: '2019',
    });
    expect(up.status).toBe(201);
    const doc = up.body.data.document;
    expect(doc).toMatchObject({
      name: 'Alapító okirat',
      year: 2019,
      tour: null,
      mimeType: 'application/pdf',
    });
    expect(fs.existsSync(documentFilePath(await Document.findById(doc._id)))).toBe(true);

    const list = (await request(app).get('/documents').set(asUser(member))).body.data.documents;
    expect(list.map((d) => d._id)).toEqual([doc._id]);
    const file = await request(app).get(`/documents/${doc._id}/file`).set(asUser(member));
    expect(file.status).toBe(200);
    const download = await request(app)
      .get(`/documents/${doc._id}/file?download=1`)
      .set(asUser(member));
    expect(download.headers['content-disposition']).toContain('attachment');
    // Named after the document, not the file on disk.
    expect(download.headers['content-disposition']).toContain('.pdf');
    expect(download.headers['content-disposition']).not.toContain('klub-dok');
    expect((await request(app).get(`/documents/${doc._id}/file`)).status).toBe(401);

    expect((await request(app).delete(`/documents/${doc._id}`).set(asUser(admin))).status).toBe(
      204,
    );
    expect((await request(app).delete(`/documents/${doc._id}`).set(asUser(admin))).status).toBe(
      404,
    );
  });

  it('an unknown category falls back to "Egyéb"; a name is required; PDF/JPG/PNG only; admins only', async () => {
    const admin = await createAdmin();
    const up = (fields, file, type) =>
      upload(admin, { category: 'Nincs ilyen', ...fields }, file, type);
    expect((await up({ name: 'Valami' })).body.data.document.category).toBe('Egyéb');
    expect((await up({ name: '  ' })).status).toBe(400);
    expect((await up({ name: 'Zip' }, Buffer.from('zip'), 'application/zip')).status).toBe(400);
    expect((await up({ name: 'Fotó' }, JPEG, 'image/jpeg')).status).toBe(201);
    expect(
      (await request(app).post('/documents').set(asUser(admin)).field('name', 'x')).status,
    ).toBe(400);
    expect((await upload(await createMember(), { name: 'x' })).status).toBe(403);
  });

  it("each card gets a small picture - a PDF's first page, a photo itself - members only", async () => {
    const admin = await createAdmin();
    const member = await createMember();
    // A real one-page A4 PDF...
    const pdf = await new Promise((resolve) => {
      const d = new PDFDocument({ size: 'A4' });
      const chunks = [];
      d.on('data', (c) => chunks.push(c));
      d.on('end', () => resolve(Buffer.concat(chunks)));
      d.fontSize(30).text('Végzés');
      d.end();
    });
    // ...and a real PNG scan.
    const png = await sharp({
      create: { width: 600, height: 900, channels: 3, background: '#eee' },
    })
      .png()
      .toBuffer();

    for (const [file, type, filename] of [
      [pdf, 'application/pdf', 'okirat.pdf'],
      [png, 'image/png', 'scan.png'],
    ]) {
      const doc = (await upload(admin, { name: filename }, file, type, filename)).body.data
        .document;
      expect(doc.preview).toBe(true);
      const preview = await request(app).get(`/documents/${doc._id}/preview`).set(asUser(member));
      expect(preview.status).toBe(200);
      expect(preview.headers['content-type']).toContain('image/webp');
      const meta = await sharp(preview.body).metadata();
      expect(meta.width).toBe(360);
      // Upright like the page: an A4 is ~1.41 times as tall as wide.
      expect(meta.height / meta.width).toBeCloseTo(filename === 'scan.png' ? 1.5 : 1.414, 1);
      expect((await request(app).get(`/documents/${doc._id}/preview`)).status).toBe(401);

      await request(app).delete(`/documents/${doc._id}`).set(asUser(admin));
      await new Promise((r) => setTimeout(r, 50));
      expect(fs.existsSync(previewPath(doc.filename))).toBe(false);
    }

    // A file that can't be drawn still uploads - its card shows the icon.
    const broken = (await upload(admin, { name: 'rossz.pdf' })).body.data.document;
    expect(broken.preview).toBe(false);
    expect(
      (await request(app).get(`/documents/${broken._id}/preview`).set(asUser(member))).status,
    ).toBe(404);
  });

  it('unknown or malformed ids are simply not found', async () => {
    const member = await createMember();
    for (const id of ['nincs-ilyen.pdf', '..%2Fsecret.pdf', '000000000000000000000000']) {
      expect((await request(app).get(`/documents/${id}/file`).set(asUser(member))).status).toBe(
        404,
      );
    }
  });
});

describe("a tour's Extrák documents", () => {
  it('admin uploads (at most 5, PDF/JPG/PNG); the tour page lists them; logged-in users open them; admin deletes', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const tour = await createTour();
    const up = (name = 'Térkép', file, type) =>
      upload(admin, { name, tour: String(tour._id) }, file, type);

    const first = await up();
    expect(first.status).toBe(201);
    const doc = first.body.data.document;
    expect(doc).toMatchObject({ name: 'Térkép', tour: String(tour._id), category: null });
    expect(doc.filename).toMatch(new RegExp(`^tour-${tour.order}-`));
    // In the tour's own folder; no preview for tour documents.
    expect(documentFilePath(await Document.findById(doc._id))).toContain(String(tour._id));
    expect(doc.preview).toBe(false);

    // The tour page gets them as its extraDocuments...
    const page = (await request(app).get(`/tours/${tour._id}`).set(asUser(member))).body.data.tour;
    expect(page.extraDocuments).toEqual([
      { _id: doc._id, title: 'Térkép', filename: doc.filename, mimeType: 'application/pdf' },
    ]);
    // ...and they're not in the club's list.
    expect((await request(app).get('/documents').set(asUser(member))).body.data.documents).toEqual(
      [],
    );
    expect(
      (await request(app).get(`/documents?tour=${tour._id}`).set(asUser(member))).body.data
        .documents,
    ).toHaveLength(1);

    const file = await request(app).get(`/documents/${doc._id}/file`).set(asUser(member));
    expect(file.status).toBe(200);
    // The old address still works for links already sent out.
    const legacy = await request(app)
      .get(`/documents/tours/${tour._id}/${doc.filename}`)
      .set(asUser(member));
    expect(legacy.status).toBe(200);
    expect((await request(app).get(`/documents/tours/${tour._id}/${doc.filename}`)).status).toBe(
      401,
    );

    expect((await up('Kép', JPEG, 'image/jpeg')).status).toBe(201);
    expect((await up('PNG', Buffer.from('png'), 'image/png')).status).toBe(201);
    for (let i = 0; i < 2; i++) await up(`Dok ${i}`);
    const sixth = await up('Hatodik');
    expect(sixth.status).toBe(400);
    expect(sixth.body.message).toContain('Legfeljebb 5');

    const stored = await Document.findById(doc._id);
    expect((await request(app).delete(`/documents/${doc._id}`).set(asUser(admin))).status).toBe(
      204,
    );
    expect(await Document.countDocuments({ tour: tour._id })).toBe(4);
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(documentFilePath(stored))).toBe(false);
  });

  it('needs a real tour', async () => {
    const admin = await createAdmin();
    expect((await upload(admin, { name: 'x', tour: '000000000000000000000000' })).status).toBe(404);
    expect((await upload(admin, { name: 'x', tour: 'nem-id' })).status).toBe(404);
  });
});

describe('tour covers', () => {
  it('admin uploads a JPEG cover; logged-in users get it with a long cache', async () => {
    const admin = await createAdmin();
    const tour = await createTour();
    const up = await request(app)
      .post(`/tours/${tour._id}/cover`)
      .set(asUser(admin))
      .attach('file', JPEG, { filename: 'cover.jpg', contentType: 'image/jpeg' });
    expect(up.status).toBe(200);
    expect(up.body.data.tour.coverUpdatedAt).toBeTruthy();
    const cover = await request(app)
      .get(`/tours/${tour._id}/cover`)
      .set(asUser(await createMember()));
    expect(cover.status).toBe(200);
    expect(cover.headers['cache-control']).toContain('immutable');
    expect((await request(app).get(`/tours/${tour._id}/cover`)).status).toBe(401);
  });

  it('rejects non-JPEGs, missing files, unknown tours and non-admins; 404 without a cover', async () => {
    const admin = await createAdmin();
    const tour = await createTour();
    const post = (buf, type, user = admin, id = tour._id) =>
      request(app)
        .post(`/tours/${id}/cover`)
        .set(asUser(user))
        .attach('file', buf, { filename: 'c', contentType: type });
    expect((await post(Buffer.from('png'), 'image/png')).status).toBe(400);
    expect((await post(Buffer.from('not a jpeg'), 'image/jpeg')).status).toBe(400);
    expect((await request(app).post(`/tours/${tour._id}/cover`).set(asUser(admin))).status).toBe(
      400,
    );
    expect((await post(JPEG, 'image/jpeg', admin, '000000000000000000000000')).status).toBe(404);
    expect((await post(JPEG, 'image/jpeg', await createMember())).status).toBe(403);
    expect((await request(app).get(`/tours/${tour._id}/cover`).set(asUser(admin))).status).toBe(
      404,
    );
  });
});
