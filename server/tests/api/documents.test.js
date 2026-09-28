import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createTour } from '../helpers/factories.js';
import Tour from '../../src/models/tourModel.js';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { previewPath } from '../../src/utils/documentPreviews.js';

const PDF = Buffer.from('%PDF-1.4 test');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe('Klub documents', () => {
  it('admin uploads; any logged-in user lists and opens; admin deletes', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const up = await request(app)
      .post('/documents')
      .set(asUser(admin))
      .field('name', 'Alapító okirat')
      .field('category', 'Alapdokumentumok')
      .field('year', '2019')
      .attach('file', PDF, { filename: 'okirat.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    const doc = up.body.data.document;
    expect(doc).toMatchObject({ name: 'Alapító okirat', year: 2019 });
    expect(fs.existsSync(path.join(process.env.CLUB_DOCUMENTS_DIR, doc.filename))).toBe(true);

    expect(
      (await request(app).get('/documents').set(asUser(member))).body.data.documents,
    ).toHaveLength(1);
    const file = await request(app).get(`/documents/${doc.filename}`).set(asUser(member));
    expect(file.status).toBe(200);
    const download = await request(app)
      .get(`/documents/${doc.filename}?download=1`)
      .set(asUser(member));
    expect(download.headers['content-disposition']).toContain('attachment');
    expect((await request(app).get(`/documents/${doc.filename}`)).status).toBe(401);

    expect((await request(app).delete(`/documents/${doc._id}`).set(asUser(admin))).status).toBe(
      204,
    );
    expect((await request(app).delete(`/documents/${doc._id}`).set(asUser(admin))).status).toBe(
      404,
    );
  });

  it('an unknown category falls back to "Egyéb"; a name is required; only PDF/JPG/PNG', async () => {
    const admin = await createAdmin();
    const up = (name, file = PDF, type = 'application/pdf') =>
      request(app)
        .post('/documents')
        .set(asUser(admin))
        .field('name', name)
        .field('category', 'Nincs ilyen')
        .attach('file', file, { filename: 'x', contentType: type });
    expect((await up('Valami')).body.data.document.category).toBe('Egyéb');
    expect((await up('  ')).status).toBe(400);
    expect((await up('Zip', Buffer.from('zip'), 'application/zip')).status).toBe(400);
    expect(
      (await request(app).post('/documents').set(asUser(admin)).field('name', 'x')).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/documents')
          .set(asUser(await createMember()))
          .field('name', 'x')
      ).status,
    ).toBe(403);
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
    const upload = (file, type, filename) =>
      request(app)
        .post('/documents')
        .set(asUser(admin))
        .field('name', filename)
        .attach('file', file, { filename, contentType: type });

    for (const [file, type, filename] of [
      [pdf, 'application/pdf', 'okirat.pdf'],
      [png, 'image/png', 'scan.png'],
    ]) {
      const doc = (await upload(file, type, filename)).body.data.document;
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
    const broken = (await upload(PDF, 'application/pdf', 'rossz.pdf')).body.data.document;
    expect(broken.preview).toBe(false);
    expect(
      (await request(app).get(`/documents/${broken._id}/preview`).set(asUser(member))).status,
    ).toBe(404);
  });

  it('refuses file names that try to escape the folder, and missing files', async () => {
    const member = await createMember();
    expect((await request(app).get('/documents/..%2Fsecret.pdf').set(asUser(member))).status).toBe(
      400,
    );
    expect((await request(app).get('/documents/notes.txt').set(asUser(member))).status).toBe(400);
    expect((await request(app).get('/documents/nincs-ilyen.pdf').set(asUser(member))).status).toBe(
      404,
    );
  });
});

describe('extra tour documents (Extra infók)', () => {
  it('admin uploads (at most 5); logged-in users open them; admin deletes', async () => {
    const admin = await createAdmin();
    const tour = await createTour();
    const upload = (title = 'Térkép') =>
      request(app)
        .post(`/tours/${tour._id}/documents`)
        .set(asUser(admin))
        .field('title', title)
        .attach('file', PDF, { filename: 'terkep.pdf', contentType: 'application/pdf' });

    const first = await upload();
    expect(first.status).toBe(201);
    const doc = first.body.data.tour.extraDocuments[0];
    expect(doc.title).toBe('Térkép');

    const file = await request(app)
      .get(`/documents/tours/${tour._id}/${doc.filename}`)
      .set(asUser(await createMember()));
    expect(file.status).toBe(200);
    expect((await request(app).get(`/documents/tours/${tour._id}/${doc.filename}`)).status).toBe(
      401,
    );

    expect((await upload('  ')).status).toBe(400);
    for (let i = 0; i < 4; i++) await upload(`Dok ${i}`);
    const sixth = await upload('Hatodik');
    expect(sixth.status).toBe(400);
    expect(sixth.body.message).toContain('Legfeljebb 5');

    const del = await request(app)
      .delete(`/tours/${tour._id}/documents/${doc._id}`)
      .set(asUser(admin));
    expect(del.status).toBe(204);
    expect((await Tour.findById(tour._id)).extraDocuments).toHaveLength(4);
    expect(
      (await request(app).delete(`/tours/${tour._id}/documents/${doc._id}`).set(asUser(admin)))
        .status,
    ).toBe(404);
  });

  it('only PDF/JPG, a real tour, and admin only', async () => {
    const admin = await createAdmin();
    const tour = await createTour();
    const bad = await request(app)
      .post(`/tours/${tour._id}/documents`)
      .set(asUser(admin))
      .field('title', 'x')
      .attach('file', Buffer.from('x'), { filename: 'x.png', contentType: 'image/png' });
    expect(bad.status).toBe(400);
    expect(
      (
        await request(app)
          .post(`/tours/${tour._id}/documents`)
          .set(asUser(admin))
          .field('title', 'x')
      ).status,
    ).toBe(400);
    expect(
      (await request(app).post('/tours/000000000000000000000000/documents').set(asUser(admin)))
        .status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .delete(`/tours/000000000000000000000000/documents/000000000000000000000000`)
          .set(asUser(admin))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/tours/${tour._id}/documents`)
          .set(asUser(await createMember()))
      ).status,
    ).toBe(403);
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
