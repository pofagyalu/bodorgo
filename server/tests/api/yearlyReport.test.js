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
import Tour from '../../src/models/tourModel.js';
import Transaction from '../../src/models/transactionModel.js';
import sendResendEmail from '../../src/utils/resendEmail.js';
import { getClubSettings } from '../../src/utils/clubSettings.js';
import { yearOnto, yearlyReportPdf, yearlyReportStats } from '../../src/utils/yearlyReport.js';
import { checkYearlyReport, yearlyReportRecipients } from '../../src/utils/yearlyReportMail.js';

// "Éves jelentés": the club's year on one PDF page, e-mailed to the club
// members on 1 January.
const mails = () => vi.mocked(sendResendEmail).mock.calls.map((c) => c[0]);

const entry = (admin, fields) =>
  Transaction.create({ name: 'Tétel', currency: 'HUF', createdBy: admin._id, ...fields });

describe('the figures', () => {
  it('counts members, dues, the money and the tours of the year', async () => {
    const admin = await createAdmin({ memberSince: 2019 });
    const anna = await createMember({ memberSince: 2026 });
    const late = await createMember({ memberSince: 2027 });
    await createMember({ retired: true });
    const guest = await createGuest();

    await entry(admin, { date: '2025-06-01', type: 'income', category: 'Tagdíj', amount: 5000 });
    await entry(admin, {
      date: '2026-02-01',
      type: 'income',
      category: 'Tagdíj',
      amount: 1000,
      user: anna._id,
      membershipYear: 2026,
    });
    await entry(admin, {
      date: '2026-03-01',
      type: 'income',
      category: 'Tagdíj',
      amount: 1000,
      user: admin._id,
      membershipYear: 2025,
    });
    await entry(admin, {
      date: '2026-09-23',
      type: 'expense',
      category: 'Banki költségek',
      amount: 300,
    });
    await entry(admin, { date: '2027-01-02', type: 'income', category: 'Tagdíj', amount: 9000 });

    const spring = await createTour({
      startDate: new Date('2026-05-01T10:00:00+02:00'),
      duration: 3,
    });
    const autumn = await createTour({
      startDate: new Date('2026-10-01T10:00:00+02:00'),
      duration: 4,
    });
    // (Saving a tour works the distance out by itself - set after.)
    await Tour.updateOne({ _id: spring._id }, { distanceFromBudapestKm: 100.4 });
    await Tour.updateOne({ _id: autumn._id }, { distanceFromBudapestKm: 50 });
    await createTour({ startDate: new Date('2025-10-01T10:00:00+02:00') });
    await createReservation(spring, [admin, anna, guest]);
    await createReservation(autumn, [admin, late]);

    const stats = await yearlyReportStats(2026, new Date('2027-01-01T09:00:00+01:00'));
    expect(stats.members).toMatchObject({ total: 2, joined: 1, paid: 1, fee: 1000 });
    expect(stats.finance).toMatchObject({
      opening: 5000,
      income: [{ category: 'Tagdíj', amount: 2000 }],
      expense: [{ category: 'Banki költségek', amount: 300 }],
      closing: 6700,
      dues: 2000,
      lateDues: 1000,
    });
    expect(stats.tours.list.map((t) => [t.days, t.people, t.nights, t.km])).toEqual([
      [3, 3, 6, 201],
      [4, 2, 6, 100],
    ]);
    expect(stats.tours).toMatchObject({ days: 7, km: 301, nights: 12, people: 4, onAll: 1 });
  });

  it('a tour that has not started yet is not in it', async () => {
    await createTour({ startDate: new Date('2026-10-22T10:00:00+02:00') });
    const stats = await yearlyReportStats(2026, new Date('2026-10-09T12:00:00+02:00'));
    expect(stats.tours.list).toEqual([]);
  });

  it('is one PDF, even of an empty year', async () => {
    const { pdf } = await yearlyReportPdf(2026, new Date('2027-01-01T09:00:00+01:00'));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
  });

  it('"2027-re", "2028-ra": the ending follows the year', () => {
    expect([2027, 2028, 2029, 2030, 2031, 2033, 2036, 2040].map(yearOnto)).toEqual([
      '2027-re',
      '2028-ra',
      '2029-re',
      '2030-ra',
      '2031-re',
      '2033-ra',
      '2036-ra',
      '2040-re',
    ]);
  });
});

describe('the e-mail on 1 January', () => {
  it('goes to every club member who has not switched e-mails off - once', async () => {
    await createAdmin({ name: 'Admin Anna', email: 'anna@test.local' });
    await createMember({ name: 'Tag Tamás', email: 'tamas@test.local' });
    await createMember({ email: 'off@test.local', wantsEmailNotifications: false });
    await createMember({ email: 'gone@test.local', retired: true });
    await createGuest({ email: 'guest@test.local' });
    expect((await yearlyReportRecipients()).map((m) => m.name)).toEqual([
      'Admin Anna',
      'Tag Tamás',
    ]);

    // Not before 9, and not on any other day of the year.
    expect(await checkYearlyReport(new Date('2027-01-01T08:30:00+01:00'))).toBeNull();
    expect(await checkYearlyReport(new Date('2026-12-31T12:00:00+01:00'))).toBeNull();
    expect(await checkYearlyReport(new Date('2027-01-08T12:00:00+01:00'))).toBeNull();
    expect(mails()).toEqual([]);

    const result = await checkYearlyReport(new Date('2027-01-01T09:05:00+01:00'));
    expect(result).toEqual({ year: 2026, sent: ['Admin Anna', 'Tag Tamás'] });
    expect(mails().map((m) => m.to)).toEqual(['anna@test.local', 'tamas@test.local']);
    expect(mails()[0].subject).toBe('Bódorgó éves jelentés – 2026');
    expect(mails()[0].text).toContain('Jó bódorgást 2027-re is!');
    expect(mails()[0].attachments[0].filename).toBe('bodorgo-eves-jelentes-2026.pdf');
    expect(mails()[0].attachments[0].content.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await getClubSettings()).yearlyReportSentYear).toBe(2026);

    // The next hourly check, and the next day's: nothing more.
    expect(await checkYearlyReport(new Date('2027-01-01T10:05:00+01:00'))).toBeNull();
    expect(await checkYearlyReport(new Date('2027-01-02T10:05:00+01:00'))).toBeNull();
    expect(mails()).toHaveLength(2);
  });

  it('a server that was down on the 1st sends it when it is back', async () => {
    await createMember({ email: 'tag@test.local' });
    const result = await checkYearlyReport(new Date('2027-01-03T14:00:00+01:00'));
    expect(result.year).toBe(2026);
    expect(mails()).toHaveLength(1);
  });
});

describe('Klub → Beállítások: Éves jelentés', () => {
  const thisYear = new Date().getFullYear();

  it('an admin sees when it goes and to whom, and the PDF as it stands', async () => {
    const admin = await createAdmin({ name: 'Admin Anna' });
    await createMember({ name: 'Tag Tamás' });
    const res = await request(app).get('/settings/yearly-report').set(asUser(admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      year: thisYear,
      sendsOn: `${thisYear + 1}-01-01`,
      recipients: ['Admin Anna', 'Tag Tamás'],
      lastSentYear: null,
    });

    const pdf = await request(app).get('/settings/yearly-report/preview.pdf').set(asUser(admin));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('the test e-mail goes to the admin alone', async () => {
    const admin = await createAdmin({ email: 'anna@test.local' });
    await createMember({ email: 'tamas@test.local' });
    const res = await request(app).post('/settings/yearly-report/test').set(asUser(admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sentTo: 'anna@test.local', year: thisYear });
    expect(mails().map((m) => m.to)).toEqual(['anna@test.local']);
    expect(mails()[0].attachments[0].filename).toBe(`bodorgo-eves-jelentes-${thisYear}.pdf`);
    // Nothing is marked as sent by a test.
    expect((await getClubSettings()).yearlyReportSentYear).toBeUndefined();
  });

  it('is for admins only', async () => {
    const member = asUser(await createMember());
    expect((await request(app).get('/settings/yearly-report').set(member)).status).toBe(403);
    expect((await request(app).get('/settings/yearly-report/preview.pdf').set(member)).status).toBe(
      403,
    );
    expect((await request(app).post('/settings/yearly-report/test').set(member)).status).toBe(403);
  });
});
