import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import {
  createAdmin,
  createGuest,
  createMember,
  createReservation,
  createTour,
} from '../helpers/factories.js';
import TourCover from '../../src/models/tourCoverModel.js';
import Tour from '../../src/models/tourModel.js';
import sendResendEmail from '../../src/utils/resendEmail.js';

// A tour with everything the Programfüzet and the Excel export can show:
// pricing, a program (with an optional paid event), weather, a cover,
// extra documents and attendees from two families.
async function richTour() {
  const tour = await createTour({
    duration: 3,
    startDate: new Date(Date.now() + 3 * 24 * 3600 * 1000),
    accommodationPricePerNight: 30000,
    advancePaymentPercentage: 30,
    summary: 'Egy remek hétvége',
    description: 'Hosszú leírás a táborról, több mondattal. '.repeat(10),
    coverUpdatedAt: new Date(),
    dailyWeather: [
      { day: 1, condition: 'clear', tempDayC: 24, tempNightC: 11 },
      { day: 2, condition: 'rain', tempDayC: 18, tempNightC: 9 },
    ],
  });
  // pdfkit needs a real image: a 1x1 white JPEG.
  await TourCover.create({
    tour: tour._id,
    contentType: 'image/jpeg',
    data: Buffer.from(
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
      'base64',
    ),
  });
  const admin = await createAdmin({ lastLoginAt: new Date() });
  const parent = await createMember({ lastLoginAt: new Date(), birthday: new Date('1980-05-05') });
  const kid = await createMember({ familyId: parent.familyId, birthday: new Date('2015-01-01') });
  const guest = await createGuest({ lastLoginAt: new Date() });
  await createReservation(tour, [parent, kid]);
  await createReservation(tour, [guest]);

  await Tour.updateOne(
    { _id: tour._id },
    {
      $push: {
        schedule: {
          $each: [
            { day: 1, time: '15:00', description: 'Érkezés' },
            {
              day: 2,
              time: '17:00',
              description: 'Borkóstoló',
              isOptional: true,
              extraCost: 4000,
              participants: [{ user: parent._id, name: parent.name }],
            },
          ],
        },
        extraDocuments: { title: 'Térkép', filename: 'terkep.pdf', mimeType: 'application/pdf' },
      },
    },
  );
  return { tour, admin, parent, kid, guest };
}

describe('Programfüzet (tour PDF)', () => {
  it('downloads a real PDF for any logged-in user', async () => {
    const { tour, guest } = await richTour();
    await Tour.updateOne(
      { _id: tour._id },
      { distanceFromBudapestKm: 120, drivingDurationFromBudapestMinutes: 95 },
    );
    const res = await request(app)
      .get(`/tours/${tour._id}/pdf`)
      .set(asUser(guest))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`${tour.order}-`);
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await request(app).get(`/tours/${tour._id}/pdf`)).status).toBe(401);
  });

  it('adds a Szobabeosztás page only once the room allocation is finalized', async () => {
    const { tour, guest } = await richTour();
    const pageCount = async () => {
      const res = await request(app)
        .get(`/tours/${tour._id}/pdf`)
        .set(asUser(guest))
        .buffer(true)
        .parse((r, cb) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      return (res.body.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    };
    const houses = [{ name: 'Ház', rooms: [{ name: 'Szoba', beds: 4 }] }];
    await Tour.updateOne({ _id: tour._id }, { accommodation: { houses, finalized: false } });
    const before = await pageCount();
    await Tour.updateOne({ _id: tour._id }, { 'accommodation.finalized': true });
    expect(await pageCount()).toBe(before + 1);
  });

  it('also works by slug, and 404s for an unknown tour', async () => {
    const { tour, guest } = await richTour();
    expect((await request(app).get(`/tours/${tour.slug}/pdf`).set(asUser(guest))).status).toBe(200);
    expect((await request(app).get('/tours/nincs-ilyen/pdf').set(asUser(guest))).status).toBe(404);
  });

  it('emails it to me - but not if I have no email address', async () => {
    const { tour, parent, kid } = await richTour();
    const res = await request(app).post(`/tours/${tour._id}/pdf/email`).set(asUser(parent));
    expect(res.status).toBe(200);
    expect(res.body.data.sentTo).toBe(parent.email);
    const [email] = vi.mocked(sendResendEmail).mock.calls[0];
    expect(email.attachments[0].content.subarray(0, 5).toString()).toBe('%PDF-');

    const { default: User } = await import('../../src/models/userModel.js');
    await User.updateOne({ _id: kid._id }, { $unset: { email: 1 } });
    expect((await request(app).post(`/tours/${tour._id}/pdf/email`).set(asUser(kid))).status).toBe(
      400,
    );
  });
});

describe('attendee Excel export (admin)', () => {
  it('downloads an .xlsx with the attendees', async () => {
    const { tour, admin } = await richTour();
    const res = await request(app)
      .get(`/tours/${tour._id}/attendees/export.xlsx`)
      .set(asUser(admin))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    // An .xlsx is a zip file.
    expect(res.body.subarray(0, 2).toString()).toBe('PK');

    const ExcelJS = (await import('exceljs')).default;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body);
    const text = JSON.stringify(book.worksheets.map((ws) => ws.getSheetValues()));
    expect(text).toContain('Borkóstoló');
  });

  it('is admin-only and 404s for an unknown tour', async () => {
    const { tour, parent, admin } = await richTour();
    expect(
      (await request(app).get(`/tours/${tour._id}/attendees/export.xlsx`).set(asUser(parent)))
        .status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/tours/000000000000000000000000/attendees/export.xlsx')
          .set(asUser(admin))
      ).status,
    ).toBe(404);
  });
});
