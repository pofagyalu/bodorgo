import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createReservation, createTour } from '../helpers/factories.js';
import TourReport from '../../src/models/tourReportModel.js';
import { huDateRange } from '../../src/utils/huDate.js';
import { fetchHistorical } from '../../src/utils/weather.js';

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

  it('links a word to one of the tour attendees, and only to them', async () => {
    const { admin, tour, anna, outsider } = await setup();
    const got = await request(app).get(url(tour)).set(asUser(admin));
    expect(got.body.data.report.attendees).toEqual([{ id: String(anna._id), name: 'Anna' }]);

    await request(app)
      .put(url(tour))
      .set(asUser(admin))
      .send({
        days: [
          day(
            { insert: 'Anci', attributes: { person: String(anna._id) } },
            { insert: ' elesett, ' },
            { insert: 'Pista', attributes: { person: String(outsider._id), italic: true } },
            { insert: ' nevetett', attributes: { person: { $ne: null } } },
            { insert: '\n' },
          ),
        ],
      });
    const report = await TourReport.findOne({ tour: tour._id }).lean();
    expect(report.days[0].ops).toEqual([
      { insert: 'Anci', attributes: { person: String(anna._id) } },
      { insert: ' elesett, ' },
      { insert: 'Pista', attributes: { italic: true } },
      { insert: ' nevetett' },
      { insert: '\n' },
    ]);

    // Nothing of it in the PDF's way: it still draws.
    const pdf = await binary(request(app).get(url(tour, '/pdf?draft=1')).set(asUser(admin)));
    expect(pdf.status).toBe(200);
  });

  it('draws the emojis of a day in the PDF - black and white, with the emoji font', async () => {
    const { admin, tour } = await setup();
    await request(app)
      .put(url(tour))
      .set(asUser(admin))
      .send({
        days: [
          day(
            { insert: 'Megérkeztünk 🏕️ és ' },
            { insert: 'esett az eső 🌧️', attributes: { bold: true } },
            { insert: ', de este 🍺🎸 és ❤️' },
            { insert: '\n' },
          ),
        ],
      });
    const pdf = await binary(request(app).get(url(tour, '/pdf?draft=1')).set(asUser(admin)));
    expect(pdf.status).toBe(200);
    // The emoji font is in it (pdfkit names an embedded font after it).
    expect(pdf.body.toString('latin1')).toContain('NotoEmoji');
  });

  it('gives the finished beszámoló as data, its people as aliases', async () => {
    const { admin, tour, anna, outsider } = await setup();
    await tour.constructor.updateOne(
      { _id: tour._id },
      {
        // The tour had an Életviteli tanácsok - so its days get the index.
        weatherOutlook: { score: 60 },
        dailyWeather: [
          {
            day: 1,
            condition: 'rain',
            tempDayC: 12,
            tempNightC: 9,
            windSpeedKmh: 22,
            isFinal: true,
          },
          { day: 2, condition: 'clear', tempDayC: 20, isFinal: false },
        ],
      },
    );
    const text = [
      day(
        { insert: 'Anci', attributes: { person: String(anna._id) } },
        { insert: ' leesett a bicikliről' },
        { insert: '\n', attributes: { list: 'bullet' } },
        { insert: 'komoly baj nem lett' },
        { insert: '\n', attributes: { list: 'bullet', indent: 1 } },
        { insert: 'Este gitározás' },
        { insert: '\n', attributes: { list: 'bullet' } },
      ),
      day({ insert: 'Pihenés\n' }),
    ];
    await request(app).put(url(tour)).set(asUser(admin)).send({ days: text });

    // Admins only, and only once it's finished (or as the draft).
    expect((await request(app).get(url(tour, '/json')).set(asUser(anna))).status).toBe(403);
    expect((await request(app).get(url(tour, '/json')).set(asUser(admin))).status).toBe(404);
    // The rain of a day frozen before it was kept: asked for once.
    vi.mocked(fetchHistorical).mockResolvedValueOnce({
      precipitationMm: 2.6,
      precipitationHours: 8,
    });
    await request(app).post(url(tour, '/finish')).set(asUser(admin));

    const res = await request(app).get(url(tour, '/json')).set(asUser(admin));
    expect(res.status).toBe(200);
    const data = res.body.data;
    const alias = data.attendees[0];
    expect(alias).toMatch(/^P\d+$/);
    expect(data).toMatchObject({
      schema: 'bodorgo.tour-report/1',
      status: 'final',
      tour: { id: String(tour._id), order: 23, title: 'Csöde' },
      when: { startDate: '2023-10-20', endDate: '2023-10-23', days: 4 },
      where: {
        text: 'Sárkány panzió, Csöde',
        country: 'Magyarország',
        lat: 46.817223,
        lng: 16.53181,
      },
      headcount: 1,
      hikes: [],
    });
    expect(data.days).toHaveLength(4);
    expect(data.days[0]).toEqual({
      day: 1,
      date: '2023-10-20',
      weekday: 'péntek',
      weather: {
        condition: 'rain',
        tempDayC: 12,
        tempNightC: 9,
        windSpeedKmh: 22,
        precipitationMm: 2.6,
        precipitationHours: 8,
      },
      wellbeing: { index: 53, word: 'Elmegy' },
    });
    expect(data.promptNotes.join(' ')).toContain('0–29 Pálinkás, 30–49 Boros');
    // A forecast is not what happened.
    expect(data.days[1].weather).toBeNull();
    expect(data.chunks).toEqual([
      {
        id: `${tour._id}:1:1`,
        header:
          'Csöde (23. túra, Magyarország), 1. nap, 2023-10-20 péntek, eső, 12°C, 2,6 mm eső (8 órán át), Jóléti-index 53 (Elmegy):',
        body: `${alias} leesett a bicikliről – komoly baj nem lett`,
        metadata: {
          kind: 'event',
          tourId: String(tour._id),
          day: 1,
          date: '2023-10-20',
          people: [alias],
          hikeRef: null,
        },
      },
      {
        id: `${tour._id}:1:2`,
        header:
          'Csöde (23. túra, Magyarország), 1. nap, 2023-10-20 péntek, eső, 12°C, 2,6 mm eső (8 órán át), Jóléti-index 53 (Elmegy):',
        body: 'Este gitározás',
        metadata: {
          kind: 'event',
          tourId: String(tour._id),
          day: 1,
          date: '2023-10-20',
          people: [],
          hikeRef: null,
        },
      },
      {
        id: `${tour._id}:2:1`,
        header: 'Csöde (23. túra, Magyarország), 2. nap, 2023-10-21 szombat:',
        body: 'Pihenés',
        metadata: {
          kind: 'event',
          tourId: String(tour._id),
          day: 2,
          date: '2023-10-21',
          people: [],
          hikeRef: null,
        },
      },
    ]);
    // No name, no user id anywhere in it.
    expect(JSON.stringify(data)).not.toContain('Anci');
    expect(JSON.stringify(data)).not.toContain(String(anna._id));

    // The same person keeps the alias; names and aliases swap both ways.
    const again = await request(app).get(url(tour, '/json')).set(asUser(admin));
    expect(again.body.data.attendees).toEqual([alias]);
    const hidden = await request(app)
      .post('/tours/report-names/hide')
      .set(asUser(admin))
      .send({ text: 'Mikor esett le anna a bicikliről? És Annának fájt? Kívülálló ott volt?' });
    const other = hidden.body.data.people.find((p) => p !== alias);
    expect(hidden.body.data).toMatchObject({
      text: `Mikor esett le ${alias} a bicikliről? És ${alias}nak fájt? ${other} ott volt?`,
      ambiguous: [],
    });
    const shown = await request(app)
      .post('/tours/report-names/show')
      .set(asUser(admin))
      .send({ text: `${alias}, 2023-10-20, Csöde. ${other} nem. P99999?` });
    expect(shown.body.data).toEqual({
      text: `Anna, 2023-10-20, Csöde. ${outsider.name} nem. P99999?`,
      unknown: ['P99999'],
    });
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

  it('can only be finished once the tour is over', async () => {
    const admin = await createAdmin();
    const day = 24 * 3600 * 1000;
    // Its third, last day is today.
    const running = await createTour({ duration: 3, startDate: new Date(Date.now() - 2 * day) });
    const text = { days: [{ ops: [{ insert: 'Megérkeztünk.\n' }] }] };
    await request(app).put(url(running)).set(asUser(admin)).send(text);
    const got = await request(app).get(url(running)).set(asUser(admin));
    expect(got.body.data.report.canFinish).toBe(false);
    expect(got.body.data.report.finishFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const early = await request(app).post(url(running, '/finish')).set(asUser(admin));
    expect(early.status).toBe(409);
    expect(early.body.message).toBe('A beszámolót csak a tábor vége után lehet késznek jelölni.');
    expect((await TourReport.findOne({ tour: running._id })).status).toBe('draft');

    // Its last day was the day before yesterday.
    const over = await createTour({ duration: 3, startDate: new Date(Date.now() - 4 * day) });
    await request(app).put(url(over)).set(asUser(admin)).send(text);
    expect((await request(app).get(url(over)).set(asUser(admin))).body.data.report.canFinish).toBe(
      true,
    );
    expect((await request(app).post(url(over, '/finish')).set(asUser(admin))).status).toBe(200);
  });

  it('keeps the tour as it was at Kész - later changes to the tour leave it alone', async () => {
    const { admin, tour, anna, outsider } = await setup();
    await tour.constructor.updateOne(
      { _id: tour._id },
      {
        dailyWeather: [{ day: 1, condition: 'clear', tempDayC: 15, tempNightC: 6, isFinal: true }],
      },
    );
    await request(app)
      .put(url(tour))
      .set(asUser(admin))
      .send({ days: [day({ insert: 'Megérkeztünk.\n' })] });
    await request(app).post(url(tour, '/finish')).set(asUser(admin));
    const before = (await request(app).get(url(tour, '/json')).set(asUser(admin))).body.data;

    // The tour moves, is renamed, gets someone new and other weather.
    const changed = await tour.constructor.findById(tour._id);
    changed.title = 'Átnevezve';
    changed.startDate = new Date('2024-05-09T22:00:00Z');
    changed.location.address = 'Kokava, Szlovákia';
    await changed.save();
    await tour.constructor.updateOne(
      { _id: tour._id },
      { dailyWeather: [{ day: 1, condition: 'rain', tempDayC: 5, tempNightC: 1, isFinal: true }] },
    );
    await createReservation(tour, [outsider]);

    const after = (await request(app).get(url(tour, '/json')).set(asUser(admin))).body.data;
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      tour: { title: 'Csöde' },
      when: { startDate: '2023-10-20' },
      where: { country: 'Magyarország' },
      headcount: 1,
    });
    expect(after.days[0].weather.condition).toBe('clear');
    // The working copy is of the tour as it is now.
    const draft = (await request(app).get(url(tour, '/json?draft=1')).set(asUser(admin))).body.data;
    expect(draft).toMatchObject({
      tour: { title: 'Átnevezve' },
      when: { startDate: '2024-05-10' },
      where: { country: 'Szlovákia' },
      headcount: 2,
    });
    // The PDF of the finished one still draws - for who was there.
    const pdf = await binary(request(app).get(url(tour, '/pdf')).set(asUser(anna)));
    expect(pdf.status).toBe(200);

    // Finished again: the tour as it is by then.
    await request(app).post(url(tour, '/reopen')).set(asUser(admin));
    await request(app).post(url(tour, '/finish')).set(asUser(admin));
    const again = (await request(app).get(url(tour, '/json')).set(asUser(admin))).body.data;
    expect(again).toMatchObject({ tour: { title: 'Átnevezve' }, headcount: 2 });
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
