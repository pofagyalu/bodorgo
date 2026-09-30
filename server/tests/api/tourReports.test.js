import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createReservation, createTour } from '../helpers/factories.js';
import TourReport from '../../src/models/tourReportModel.js';
import { huDateRange } from '../../src/utils/huDate.js';

// Binary responses (the PDF, the seal) as a Buffer.
const binary = (req) =>
  req.buffer(true).parse((res, done) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  });

const day = (...ops) => ({ ops });

async function setup() {
  const admin = await createAdmin();
  const tour = await createTour({
    title: 'Csöde',
    order: 23,
    duration: 4,
    startDate: new Date('2023-10-19T22:00:00Z'),
    location: {
      description: 'Sárkány panzió',
      address: 'Csöde',
      coordinates: [16.53181, 46.817223],
    },
  });
  const anna = await createMember({ name: 'Anna' });
  const outsider = await createMember({ name: 'Kívülálló' });
  await createReservation(tour, [anna]);
  return { admin, tour, anna, outsider };
}

const url = (tour, rest = '') => `/tours/${tour._id}/report${rest}`;

describe('beszámoló (tour report)', () => {
  it('gives the admin an empty working copy with the header filled in from the tour', async () => {
    const { admin, tour } = await setup();
    const res = await request(app).get(url(tour)).set(asUser(admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ canDownload: false, publishedAt: null });
    expect(res.body.data.report).toMatchObject({
      status: 'draft',
      days: [null, null, null, null],
      dayLabels: [
        'október 20., péntek',
        'október 21., szombat',
        'október 22., vasárnap',
        'október 23., hétfő',
      ],
      facts: { place: '', dates: '', headcount: '' },
      auto: {
        place: 'Sárkány panzió, Csöde',
        dates: '2023. október 20–23.',
        headcount: '1 fő',
      },
      published: null,
    });
  });

  it('saves the days cleaned, finishes, locks, reopens', async () => {
    const { admin, tour } = await setup();
    const saved = await request(app)
      .put(url(tour))
      .set(asUser(admin))
      .send({
        days: [
          day(
            { insert: 'Megérkezés, ' },
            { insert: 'gitározás', attributes: { bold: true, color: '#f00', link: 'x' } },
            { insert: '\n', attributes: { list: 'bullet', indent: 1 } },
            { insert: { image: 'data:x' } },
          ),
          null,
        ],
        facts: { headcount: '49 fő' },
      });
    expect(saved.status).toBe(200);
    const report = await TourReport.findOne({ tour: tour._id }).lean();
    expect(report.days[0]).toEqual({
      ops: [
        { insert: 'Megérkezés, ' },
        { insert: 'gitározás', attributes: { bold: true } },
        { insert: '\n', attributes: { list: 'bullet', indent: 1 } },
      ],
    });
    expect(report.facts.headcount).toBe('49 fő');

    const finished = await request(app).post(url(tour, '/finish')).set(asUser(admin));
    expect(finished.status).toBe(200);
    expect(finished.body.data.report.status).toBe('final');
    expect(finished.body.data.report.published.at).toBeTruthy();

    // Kész: no more saving until it's reopened.
    const locked = await request(app).put(url(tour)).set(asUser(admin)).send({ days: [] });
    expect(locked.status).toBe(409);

    const reopened = await request(app).post(url(tour, '/reopen')).set(asUser(admin));
    expect(reopened.body.data.report.status).toBe('draft');
    // The attendees keep the finished one meanwhile.
    expect(reopened.body.data.report.published).not.toBeNull();
    await request(app)
      .put(url(tour))
      .set(asUser(admin))
      .send({ days: [day({ insert: 'Új\n' })] });
    const after = await TourReport.findOne({ tour: tour._id }).lean();
    expect(after.published.days[0].ops[1].insert).toBe('gitározás');
  });

  it('takes one of the tour album photos, and only those', async () => {
    const { admin, tour } = await setup();
    await tour.constructor.updateOne({ _id: tour._id }, { images: [{ filename: 'IMG_1.jpg' }] });
    const wrong = await request(app)
      .put(url(tour))
      .set(asUser(admin))
      .send({ days: [], photo: '../../secret.jpg' });
    expect(wrong.status).toBe(400);
    await request(app).put(url(tour)).set(asUser(admin)).send({ days: [], photo: 'IMG_1.jpg' });
    const back = await request(app).get(url(tour)).set(asUser(admin));
    expect(back.body.data.report.photo).toBe('IMG_1.jpg');
  });

  it('cannot be finished empty', async () => {
    const { admin, tour } = await setup();
    await request(app)
      .put(url(tour))
      .set(asUser(admin))
      .send({ days: [day({ insert: '  \n' })] });
    const res = await request(app).post(url(tour, '/finish')).set(asUser(admin));
    expect(res.status).toBe(400);
  });

  it('only the attendees (and admins) download it, only once it is finished', async () => {
    const { admin, tour, anna, outsider } = await setup();
    await request(app)
      .put(url(tour))
      .set(asUser(admin))
      .send({ days: [day({ insert: 'Kerékpártúra\n' })] });

    // Not finished yet: nothing to download - but the admin's preview works.
    expect((await request(app).get(url(tour)).set(asUser(anna))).body.data.canDownload).toBe(false);
    expect((await request(app).get(url(tour, '/pdf')).set(asUser(anna))).status).toBe(404);
    const preview = await binary(request(app).get(url(tour, '/pdf?draft=1')).set(asUser(admin)));
    expect(preview.status).toBe(200);
    expect(preview.body.subarray(0, 5).toString()).toBe('%PDF-');

    await request(app).post(url(tour, '/finish')).set(asUser(admin));

    const annaView = await request(app).get(url(tour)).set(asUser(anna));
    expect(annaView.body.data.canDownload).toBe(true);
    expect(annaView.body.data.report).toBeUndefined();
    const pdf = await binary(request(app).get(url(tour, '/pdf')).set(asUser(anna)));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-disposition']).toContain('23-beszamolo-');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');

    expect((await request(app).get(url(tour)).set(asUser(outsider))).body.data.canDownload).toBe(
      false,
    );
    expect((await request(app).get(url(tour, '/pdf')).set(asUser(outsider))).status).toBe(403);
    // A member can't write it, or preview the draft.
    expect((await request(app).put(url(tour)).set(asUser(anna)).send({ days: [] })).status).toBe(
      403,
    );
    expect((await request(app).get(url(tour, '/pdf?draft=1')).set(asUser(outsider))).status).toBe(
      403,
    );
  });
});

describe('Elnök setting', () => {
  it('admins set the name; the seal comes as a PNG', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    expect((await request(app).get('/settings/president').set(asUser(member))).status).toBe(403);
    const got = await request(app).get('/settings/president').set(asUser(admin));
    expect(got.body.data.presidentName).toBe('Biró Melinda');

    expect(
      (
        await request(app)
          .put('/settings/president')
          .set(asUser(admin))
          .send({ presidentName: ' ' })
      ).status,
    ).toBe(400);
    const put = await request(app)
      .put('/settings/president')
      .set(asUser(admin))
      .send({ presidentName: 'Kiss Anna' });
    expect(put.body.data.presidentName).toBe('Kiss Anna');

    const seal = await binary(request(app).get('/settings/president/seal.png').set(asUser(admin)));
    expect(seal.status).toBe(200);
    expect(seal.headers['content-type']).toBe('image/png');
    expect(seal.body.subarray(1, 4).toString()).toBe('PNG');
  });
});

describe('huDateRange', () => {
  it('writes a tour’s dates the Hungarian way', () => {
    expect(huDateRange(new Date('2023-10-19T22:00:00Z'), 4)).toBe('2023. október 20–23.');
    expect(huDateRange(new Date('2023-10-29T23:00:00Z'), 4)).toBe(
      '2023. október 30. – november 2.',
    );
    expect(huDateRange(new Date('2023-12-29T23:00:00Z'), 4)).toBe(
      '2023. december 30. – 2024. január 2.',
    );
    expect(huDateRange(new Date('2023-10-19T22:00:00Z'), 1)).toBe('2023. október 20.');
  });
});
