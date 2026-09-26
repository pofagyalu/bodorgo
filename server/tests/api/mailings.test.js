import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createReservation, createTour } from '../helpers/factories.js';
import sendResendEmail from '../../src/utils/resendEmail.js';
import TourMailing from '../../src/models/tourMailingModel.js';
import { cleanMailHtml, isBlankMailHtml, mailHtmlToText } from '../../src/utils/mailHtml.js';

async function tourWithAttendees() {
  const admin = await createAdmin({ lastLoginAt: new Date() });
  const tour = await createTour({ title: 'Sarud', order: 25 });
  const anna = await createMember({ name: 'Anna', lastLoginAt: new Date() });
  const bela = await createMember({ name: 'Béla', lastLoginAt: new Date() });
  const neverLoggedIn = await createMember({ name: 'Cili' });
  await createReservation(tour, [anna, bela]);
  await createReservation(tour, [neverLoggedIn]);
  return { admin, tour, anna, bela };
}

const draftUrl = (tour) => `/tours/${tour._id}/mailings/draft`;

describe('letters to the attendees (admin)', () => {
  it('saves the draft as typed, cleaned, and gives it back with the defaults', async () => {
    const { admin, tour } = await tourWithAttendees();
    const empty = await request(app).get(`/tours/${tour._id}/mailings`).set(asUser(admin));
    expect(empty.body.data).toMatchObject({
      draft: null,
      sent: [],
      recipients: { eligible: ['Anna', 'Béla'], skipped: [{ name: 'Cili' }] },
      defaults: { subject: '25. Bódorgó – Sarud', withPdf: true },
    });

    const html = '<p>Hideg lesz, <strong>hozz</strong> meleg ruhát!<script>alert(1)</script></p>';
    const saved = await request(app)
      .put(draftUrl(tour))
      .set(asUser(admin))
      .send({ subject: 'Tudnivalók', html, delta: { ops: [{ insert: 'x' }] } });
    expect(saved.status).toBe(200);

    const back = await request(app).get(`/tours/${tour._id}/mailings`).set(asUser(admin));
    expect(back.body.data.draft).toMatchObject({
      subject: 'Tudnivalók',
      html: '<p>Hideg lesz, <strong>hozz</strong> meleg ruhát!</p>',
      delta: { ops: [{ insert: 'x' }] },
    });
    // One draft per tour - saving again updates it.
    await request(app)
      .put(draftUrl(tour))
      .set(asUser(admin))
      .send({ subject: 'Új', html: '<p>2</p>' });
    expect(await TourMailing.countDocuments({ tour: tour._id })).toBe(1);
  });

  it('a test goes to the admin only; the real send reaches every attendee and is kept', async () => {
    const { admin, tour, anna, bela } = await tourWithAttendees();
    await request(app).put(draftUrl(tour)).set(asUser(admin)).send({
      subject: 'Tudnivalók',
      html: '<p>Csak <span style="color: rgb(230, 0, 0);">készpénz</span>!</p>',
    });

    const test = await request(app)
      .post(`/tours/${tour._id}/mailings/test`)
      .set(asUser(admin))
      .send({ withPdf: false });
    expect(test.status).toBe(200);
    expect(vi.mocked(sendResendEmail).mock.calls.map(([e]) => e.to)).toEqual([admin.email]);
    expect(vi.mocked(sendResendEmail).mock.calls[0][0].subject).toBe('[Próba] Tudnivalók');
    vi.mocked(sendResendEmail).mockClear();

    const sent = await request(app)
      .post(`/tours/${tour._id}/mailings/send`)
      .set(asUser(admin))
      .send({ withPdf: true });
    expect(sent.status).toBe(200);
    const emails = vi.mocked(sendResendEmail).mock.calls.map(([e]) => e);
    expect(emails.map((e) => e.to).sort()).toEqual([anna.email, bela.email].sort());
    expect(emails[0].html).toContain('készpénz');
    expect(emails[0].html).toMatch(/Szia (Anna|Béla)!/);
    expect(emails[0].attachments[0].content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(emails[0].text).toContain('Csak készpénz!');
    expect(sent.body.data.mailing).toMatchObject({
      subject: 'Tudnivalók',
      withPdf: true,
      recipientCount: 2,
    });

    // Sent, kept - the draft is gone, the next letter starts empty, and
    // the Programfüzet is no longer ticked by default.
    const after = await request(app).get(`/tours/${tour._id}/mailings`).set(asUser(admin));
    expect(after.body.data.draft).toBeNull();
    expect(after.body.data.sent).toHaveLength(1);
    expect(after.body.data.sent[0].skipped).toEqual([
      { name: 'Cili', reason: 'még sosem jelentkezett be' },
    ]);
    expect(after.body.data.defaults.withPdf).toBe(false);

    // Nothing left to send.
    expect(
      (await request(app).post(`/tours/${tour._id}/mailings/send`).set(asUser(admin)).send({}))
        .status,
    ).toBe(400);
  });

  it('refuses an empty letter, and anyone but an admin', async () => {
    const { admin, tour, anna } = await tourWithAttendees();
    await request(app)
      .put(draftUrl(tour))
      .set(asUser(admin))
      .send({ subject: 'x', html: '<p><br></p>' });
    expect(
      (await request(app).post(`/tours/${tour._id}/mailings/send`).set(asUser(admin)).send({}))
        .status,
    ).toBe(400);
    expect(sendResendEmail).not.toHaveBeenCalled();
    expect((await request(app).get(`/tours/${tour._id}/mailings`).set(asUser(anna))).status).toBe(
      403,
    );
    expect((await request(app).put(draftUrl(tour)).set(asUser(anna)).send({})).status).toBe(403);
  });
});

describe('mail HTML helpers', () => {
  it('keeps only the editor formatting', () => {
    const dirty =
      '<p style="text-align: center; position: fixed">A&nbsp;<em>b</em> <img src=x onerror=1>' +
      '<a href="javascript:alert(1)">x</a> <a href="https://bodorgo.hu">ok</a></p>' +
      '<ul><li><span style="background-color: #ffff00; font-size: 40px">kiemelt</span></li></ul>';
    expect(cleanMailHtml(dirty)).toBe(
      '<p style="text-align:center">A <em>b</em> <a target="_blank" rel="noopener noreferrer">x</a> ' +
        '<a href="https://bodorgo.hu" target="_blank" rel="noopener noreferrer">ok</a></p>' +
        '<ul><li><span style="background-color:#ffff00">kiemelt</span></li></ul>',
    );
    expect(isBlankMailHtml('<p><br></p><p> </p>')).toBe(true);
    expect(mailHtmlToText('<p>Egy</p><ul><li>két</li><li>három</li></ul>')).toBe(
      'Egy\n\n• két\n• három',
    );
  });
});
