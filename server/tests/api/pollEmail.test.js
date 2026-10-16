import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createGuest, createMember, createTour } from '../helpers/factories.js';
import sendResendEmail from '../../src/utils/resendEmail.js';
import Poll from '../../src/models/pollModel.js';

// "Új szavazás" e-mail from the Voks form (utils/pollEmail.js).
const tomorrow = () => new Date(Date.now() + 86400000).toISOString();

describe('poll e-mail recipients', () => {
  it('lists the club members by name, with who can get the e-mail and why not', async () => {
    const admin = await createAdmin({ name: 'Anna' });
    await createMember({ name: 'Béla' });
    await createMember({ name: 'Csaba', wantsEmailNotifications: false });
    await createMember({ name: 'Dóra', email: '' });
    await createMember({ name: 'Ernő', retired: true });
    await createGuest({ name: 'Vendég' });
    const res = await request(app).get('/polls/email-recipients').set(asUser(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.members.map((m) => [m.name, m.canEmail, m.reason])).toEqual([
      ['Anna', true, null],
      ['Béla', true, null],
      ['Csaba', false, 'kikapcsolta az e-mail értesítéseket'],
      ['Dóra', false, 'nincs e-mail cím'],
    ]);
  });

  it('is for admins only', async () => {
    const res = await request(app)
      .get('/polls/email-recipients')
      .set(asUser(await createMember()));
    expect(res.status).toBe(403);
  });
});

describe('creating a poll with an e-mail', () => {
  it('e-mails the chosen club members who can get it, and only them', async () => {
    const admin = await createAdmin({ name: 'Anna' });
    const bela = await createMember({ name: 'Béla', email: 'bela@test.local' });
    const csaba = await createMember({ name: 'Csaba', wantsEmailNotifications: false });
    const guest = await createGuest();
    await createMember({ name: 'Nem választott' });
    const tour = await createTour({ title: 'Mátra' });
    const res = await request(app)
      .post('/polls')
      .set(asUser(admin))
      .send({
        tour: tour._id,
        question: 'Hová menjünk?',
        details: '<p>Döntsünk <strong>gyorsan</strong>.</p>',
        options: ['Mátra', 'Bükk'],
        closesAt: tomorrow(),
        emailTo: [bela._id, csaba._id, guest._id, 'nincs-ilyen'],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.emailCount).toBe(1);
    await vi.waitFor(() => expect(sendResendEmail).toHaveBeenCalledTimes(1));
    const mail = vi.mocked(sendResendEmail).mock.calls[0][0];
    expect(mail.to).toBe('bela@test.local');
    expect(mail.subject).toBe('Új szavazás: Hová menjünk?');
    expect(mail.html).toContain('Szia Béla!');
    expect(mail.html).toContain('<strong>gyorsan</strong>');
    expect(mail.html).toContain('<li>Bükk</li>');
    expect(mail.html).toContain('/szavazasok');
    expect(mail.text).toContain('(Mátra)');
    const saved = await Poll.findById(res.body.data.poll._id);
    expect(saved.emailRecipientCount).toBe(1);
    expect(saved.emailSentAt).toBeInstanceOf(Date);
  });

  it('sends nothing without emailTo', async () => {
    const res = await request(app)
      .post('/polls')
      .set(asUser(await createAdmin()))
      .send({ question: 'Pizza?', options: ['Igen', 'Nem'], closesAt: tomorrow() });
    expect(res.status).toBe(201);
    expect(res.body.data.emailCount).toBe(0);
    expect(sendResendEmail).not.toHaveBeenCalled();
    expect((await Poll.findById(res.body.data.poll._id)).emailSentAt).toBeNull();
  });
});
