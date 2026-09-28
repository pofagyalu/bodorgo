import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createUser } from '../helpers/factories.js';
import User from '../../src/models/userModel.js';
import sendResendEmail from '../../src/utils/resendEmail.js';
import {
  createInvitation,
  deleteInvitation,
  invitationsEnabled,
} from '../../src/utils/authentikInvitations.js';

// Authentik's API replaced: each invitation gets a made-up id and link.
vi.mock('../../src/utils/authentikInvitations.js', () => ({
  INVITATION_DAYS: 30,
  invitationsEnabled: vi.fn(() => true),
  createInvitation: vi.fn(async ({ email }) => ({
    id: `inv-${email}`,
    link: `https://auth.test/if/flow/enrollment-invitation/?itoken=inv-${email}`,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  })),
  deleteInvitation: vi.fn(async () => {}),
}));

beforeEach(() => {
  vi.mocked(createInvitation).mockClear();
  vi.mocked(deleteInvitation).mockClear();
  vi.mocked(sendResendEmail).mockClear();
});

// Never logged in (no sub), with an e-mail: can be invited.
const newcomer = (overrides) => createUser({ sub: undefined, ...overrides });

describe('Felhasználók → Meghívók', () => {
  it('lists who can be invited: an e-mail, never logged in, not suspended - admins only', async () => {
    const admin = await createAdmin({ sub: 'sub-admin' });
    const a = await newcomer({ name: 'Anna Tag', role: 'member' });
    await createUser({ sub: 'sub-x', name: 'Már Belépett' });
    await newcomer({ email: undefined, name: 'Kis Gyerek', role: 'guest' });
    await newcomer({ retired: true, name: 'Felfüggesztett' });

    const res = await request(app).get('/users/invitations').set(asUser(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.people).toEqual([
      expect.objectContaining({ _id: String(a._id), name: 'Anna Tag', status: 'none' }),
    ]);
    expect(
      (
        await request(app)
          .get('/users/invitations')
          .set(asUser(await createMember()))
      ).status,
    ).toBe(403);
  });

  it('one person: their own link by e-mail; a resend replaces the old link', async () => {
    const admin = await createAdmin({ name: 'Admin Anna', sub: 'sub-admin' });
    const wife = await newcomer({ name: 'Nagy Éva', email: 'eva@test.local', role: 'admin' });

    const res = await request(app)
      .post('/users/invitations')
      .set(asUser(admin))
      .send({ userIds: [String(wife._id)] });
    expect(res.body.data).toEqual({ sent: ['Nagy Éva'], failed: [] });
    expect(createInvitation).toHaveBeenCalledWith({ email: 'eva@test.local', name: 'Nagy Éva' });
    const mail = vi.mocked(sendResendEmail).mock.calls[0][0];
    expect(mail.to).toBe('eva@test.local');
    expect(mail.subject).toBe('Meghívó a Bódorgó klub alkalmazásába');
    expect(mail.text).toContain('Kedves Éva!');
    expect(mail.text).toContain('itoken=inv-eva@test.local');
    expect(mail.html).toContain('itoken=inv-eva@test.local');
    const stored = (await User.findById(wife._id)).invitation;
    expect(stored).toMatchObject({ id: 'inv-eva@test.local', sentByName: 'Admin Anna' });

    await request(app)
      .post('/users/invitations')
      .set(asUser(admin))
      .send({ userIds: [String(wife._id)] });
    expect(deleteInvitation).toHaveBeenCalledWith('inv-eva@test.local');
    expect(createInvitation).toHaveBeenCalledTimes(2);

    const list = (await request(app).get('/users/invitations').set(asUser(admin))).body.data;
    expect(list.people[0]).toMatchObject({ status: 'sent', sentByName: 'Admin Anna' });
  });

  it('the two batches: club members first, then everyone else - each only those not invited yet', async () => {
    const admin = await createAdmin({ sub: 'sub-admin' });
    await newcomer({ name: 'A Tag', role: 'member' });
    await newcomer({ name: 'B Admin', role: 'admin' });
    await newcomer({ name: 'C Vendég', role: 'guest' });
    const invite = (body) => request(app).post('/users/invitations').set(asUser(admin)).send(body);

    expect((await invite({ group: 'members' })).body.data.sent).toEqual(['A Tag', 'B Admin']);
    expect((await invite({ group: 'members' })).body.data.sent).toEqual([]);
    expect((await invite({ group: 'others' })).body.data.sent).toEqual(['C Vendég']);
    expect((await invite({ group: 'others' })).body.data.sent).toEqual([]);
    expect((await invite({})).status).toBe(400);
  });

  it('a failure is reported by name and does not stop the others', async () => {
    const admin = await createAdmin({ sub: 'sub-admin' });
    await newcomer({ name: 'A Tag', role: 'member', email: 'a@test.local' });
    await newcomer({ name: 'B Tag', role: 'member', email: 'b@test.local' });
    vi.mocked(createInvitation).mockRejectedValueOnce(new Error('Authentik 500'));
    const res = await request(app)
      .post('/users/invitations')
      .set(asUser(admin))
      .send({ group: 'members' });
    expect(res.body.data).toEqual({
      sent: ['B Tag'],
      failed: [{ name: 'A Tag', message: 'Nem sikerült elküldeni.' }],
    });
  });

  it('someone who logged in is never invited again, and shows as joined', async () => {
    const admin = await createAdmin();
    const joined = await createUser({
      sub: 'sub-j',
      name: 'Már Itt',
      invitation: { id: 'inv-old', sentAt: new Date(), expiresAt: new Date() },
    });
    const res = await request(app)
      .post('/users/invitations')
      .set(asUser(admin))
      .send({ userIds: [String(joined._id)] });
    expect(res.body.data.sent).toEqual([]);
    const list = (await request(app).get('/users/invitations').set(asUser(admin))).body.data;
    expect(list.people.find((p) => p.name === 'Már Itt').status).toBe('joined');
  });

  it('an invitation can be taken back', async () => {
    const admin = await createAdmin();
    const p = await newcomer({ email: 'p@test.local' });
    await request(app)
      .post('/users/invitations')
      .set(asUser(admin))
      .send({ userIds: [String(p._id)] });
    const res = await request(app).delete(`/users/${p._id}/invitation`).set(asUser(admin));
    expect(res.status).toBe(200);
    expect(deleteInvitation).toHaveBeenCalledWith('inv-p@test.local');
    expect((await User.findById(p._id)).invitation).toBeUndefined();
    expect(
      (await request(app).delete(`/users/${p._id}/invitation`).set(asUser(admin))).status,
    ).toBe(400);
  });

  it('refuses to send when the server has no Authentik token', async () => {
    vi.mocked(invitationsEnabled).mockReturnValueOnce(false);
    const res = await request(app)
      .post('/users/invitations')
      .set(asUser(await createAdmin()))
      .send({ group: 'members' });
    expect(res.status).toBe(400);
  });
});
