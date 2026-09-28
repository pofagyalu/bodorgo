import mongoose from 'mongoose';
import User from '../models/userModel.js';
import AppError from '../utils/appError.js';
import logger from '../logger.js';
import sendResendEmail from '../utils/resendEmail.js';
import {
  INVITATION_DAYS,
  createInvitation,
  deleteInvitation,
  invitationsEnabled,
} from '../utils/authentikInvitations.js';

// Felhasználók → Meghívók (admins): everyone an admin added who has an
// e-mail but has never logged in gets their own Authentik invitation link
// by e-mail - one by one (a test, a straggler) or in the two batches
// (club members, then everyone else). Their first login then links the
// Authentik account to their record here (authOidcController.js).

const dateHu = (d) =>
  new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' }).format(d);

// The e-mail with the person's own link.
export function invitationEmail(user, link, expiresAt) {
  const first = String(user.name ?? '')
    .trim()
    .split(/\s+/)
    .at(-1);
  const subject = 'Meghívó a Bódorgó klub alkalmazásába';
  const text = [
    `Kedves ${first}!`,
    '',
    'Meghívunk a Bódorgó klub alkalmazásába (bodorgo.hu) - itt találod a táborokat, a jelentkezést és a befizetéseket, a Kotyogót, a Voksot, a fotókat és a klub dokumentumait.',
    '',
    'A saját meghívó linked (csak neked szól, egyszer használható):',
    link,
    '',
    `1. Nyisd meg a linket - a neved és az e-mail címed (${user.email}) már ki van töltve.`,
    '2. Adj meg egy legalább 15 karakteres jelszót (bármilyen karakterekből), és küldd el.',
    '3. Kapsz egy megerősítő e-mailt - kattints a benne lévő linkre.',
    '4. Ezután lépj be a bodorgo.hu oldalon.',
    '',
    `A link ${dateHu(expiresAt)}-ig érvényes. Ha lejárt vagy elakadtál, szólj egy adminnak, és küld újat.`,
    '',
    'Üdvözlettel:',
    'a Bódorgó klub',
  ].join('\n');
  const html = `<p>Kedves ${first}!</p>
<p>Meghívunk a Bódorgó klub alkalmazásába (<a href="https://bodorgo.hu">bodorgo.hu</a>) - itt találod a táborokat, a jelentkezést és a befizetéseket, a Kotyogót, a Voksot, a fotókat és a klub dokumentumait.</p>
<p style="margin:24px 0"><a href="${link}" style="background:#1a796c;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Regisztrálok</a></p>
<p>A gomb a saját meghívó linked - csak neked szól, egyszer használható.</p>
<ol>
<li>Nyisd meg - a neved és az e-mail címed (<strong>${user.email}</strong>) már ki van töltve.</li>
<li>Adj meg egy <strong>legalább 15 karakteres</strong> jelszót (bármilyen karakterekből), és küldd el.</li>
<li>Kapsz egy megerősítő e-mailt - kattints a benne lévő linkre.</li>
<li>Ezután lépj be a <a href="https://bodorgo.hu">bodorgo.hu</a> oldalon.</li>
</ol>
<p>A link <strong>${dateHu(expiresAt)}</strong>-ig érvényes. Ha lejárt vagy elakadtál, szólj egy adminnak, és küld újat.</p>
<p>Üdvözlettel:<br>a Bódorgó klub</p>`;
  return { subject, text, html };
}

// Who can be invited: has an e-mail, never logged in, not suspended.
const CANDIDATES = {
  sub: null, // missing or null
  email: { $nin: [null, ''] },
  retired: { $ne: true },
};

function status(u, now = new Date()) {
  if (u.sub) return 'joined';
  if (!u.invitation?.sentAt) return 'none';
  return u.invitation.expiresAt && u.invitation.expiresAt < now ? 'expired' : 'sent';
}

const view = (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  role: u.role,
  status: status(u),
  sentAt: u.invitation?.sentAt ?? null,
  expiresAt: u.invitation?.expiresAt ?? null,
  sentByName: u.invitation?.sentByName ?? null,
});

// GET /users/invitations (admin) - who can be invited and how it stands,
// plus those who were invited and have joined since.
export const getInvitations = async (req, res) => {
  const users = await User.find({
    $or: [
      CANDIDATES,
      { 'invitation.sentAt': { $exists: true }, sub: { $exists: true, $ne: null } },
    ],
  })
    .select('name email role sub invitation')
    .sort({ name: 1 });
  res.status(200).json({
    status: 'success',
    data: { enabled: invitationsEnabled(), days: INVITATION_DAYS, people: users.map(view) },
  });
};

// Sends one person their invitation - a new link each time (the previous
// one, if any, is deleted in Authentik, so only the newest works).
async function invite(user, byName) {
  if (user.invitation?.id) {
    await deleteInvitation(user.invitation.id).catch((err) =>
      logger.warn(`invitations: old invitation of ${user.email} not deleted: ${err.message}`),
    );
  }
  const { id, link, expiresAt } = await createInvitation({ email: user.email, name: user.name });
  await sendResendEmail({ to: user.email, ...invitationEmail(user, link, expiresAt) });
  user.invitation = { id, sentAt: new Date(), expiresAt, sentByName: byName };
  await user.save({ validateModifiedOnly: true });
}

// POST /users/invitations (admin) - { userIds } or { group: 'members' |
// 'others' } (the two batches: club members, then everyone else; each
// only those not invited yet - resending is by userIds). One at a time;
// a failure doesn't stop the others and is reported by name.
export const sendInvitations = async (req, res) => {
  if (!invitationsEnabled()) {
    throw new AppError('A meghívók nincsenek beállítva a szerveren (AUTHENTIK_API_TOKEN).', 400);
  }
  const { userIds, group } = req.body ?? {};
  let filter;
  if (Array.isArray(userIds) && userIds.length) {
    filter = { ...CANDIDATES, _id: { $in: userIds.filter((i) => mongoose.isValidObjectId(i)) } };
  } else if (group === 'members' || group === 'others') {
    filter = {
      ...CANDIDATES,
      role: group === 'members' ? { $in: ['member', 'admin'] } : 'guest',
      'invitation.sentAt': { $exists: false },
    };
  } else {
    throw new AppError('Kiket hívjunk meg? (userIds vagy group)', 400);
  }

  const users = await User.find(filter).sort({ name: 1 });
  const sent = [];
  const failed = [];
  for (const user of users) {
    try {
      await invite(user, req.user.name);
      sent.push(user.name);
    } catch (err) {
      logger.error(`invitations: ${user.email}: ${err.message}`);
      failed.push({ name: user.name, message: 'Nem sikerült elküldeni.' });
    }
  }
  logger.info(`invitations: ${req.user.name} sent ${sent.length}, failed ${failed.length}`);
  res.status(200).json({ status: 'success', data: { sent, failed } });
};

// DELETE /users/:id/invitation (admin) - takes the link back: it stops
// working in Authentik.
export const revokeInvitation = async (req, res) => {
  const user = mongoose.isValidObjectId(req.params.id) && (await User.findById(req.params.id));
  if (!user) throw new AppError('No user found with that ID!', 404);
  if (!user.invitation?.id) throw new AppError('Ennek a személynek nincs élő meghívója.', 400);
  await deleteInvitation(user.invitation.id);
  user.invitation = undefined;
  await user.save({ validateModifiedOnly: true });
  res.status(200).json({ status: 'success', data: view(user) });
};
