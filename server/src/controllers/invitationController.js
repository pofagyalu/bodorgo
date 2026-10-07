import mongoose from 'mongoose';
import User from '../models/userModel.js';
import AppError from '../utils/appError.js';
import logger from '../logger.js';
import sendResendEmail from '../utils/resendEmail.js';
import { getClubSettings } from '../utils/clubSettings.js';
import {
  INVITATION_DAYS,
  createInvitation,
  deleteInvitation,
  invitationLink,
  invitationsEnabled,
} from '../utils/authentikInvitations.js';
import { getOidcSettings } from '../utils/oidcSettings.js';
import { huDate } from '../utils/huDate.js';
import { installGuideAttachment } from '../utils/installGuide.js';

// Felhasználók → Meghívók (admins): everyone an admin added who has an
// e-mail but has never logged in gets their own Authentik invitation link
// by e-mail - one by one (a test, a straggler) or in the two batches
// (club members, then everyone else). Their first login then links the
// Authentik account to their record here (authOidcController.js).

const dateHu = (d) => huDate(d);

// The intro above the steps - editable on the Meghívók tab (club
// settings' invitationIntro): the launch announcement for the big day,
// something general later. Paragraphs are separated by an empty line.
export const DEFAULT_INVITATION_INTRO = [
  'Örömmel értesítünk, hogy ma elindult a Bódorgó klub új alkalmazása!',
  'A bodorgo.hu oldalon ezentúl egy helyen találod a táborokat, a jelentkezést és a befizetéseket, a Kotyogót, a Voksot, a fotókat és a klub dokumentumait.',
  'A belépéshez először regisztrálnod kell - ez csak pár perc. Kövesd az alábbi lépéseket:',
].join('\n\n');

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const paragraphs = (text) =>
  String(text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

// What the e-mail says about the attached guide (utils/installGuide.js).
const GUIDE_NOTE =
  'Tipp: a Bódorgót a telefonod kezdőképernyőjére is kiteheted, és onnantól úgy működik, mint egy alkalmazás. A csatolt egyoldalas útmutató megmutatja, hogyan - Androidon és iPhone-on.';

// The e-mail with the person's own link, under the club's intro text.
// `guide`: the install guide is attached, so the e-mail mentions it.
export function invitationEmail(
  user,
  link,
  expiresAt,
  intro = DEFAULT_INVITATION_INTRO,
  { guide = false } = {},
) {
  const first = String(user.name ?? '')
    .trim()
    .split(/\s+/)
    .at(-1);
  const introParagraphs = paragraphs(intro);
  const subject = 'Meghívó a Bódorgó klub alkalmazásába';
  const text = [
    `Kedves ${first}!`,
    '',
    ...introParagraphs.flatMap((p) => [p, '']),
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
    ...(guide ? [GUIDE_NOTE, ''] : []),
    'Üdvözlettel:',
    'a Bódorgó klub',
  ].join('\n');
  // The same look as the e-mail that follows it - Authentik's "confirm your
  // address" (authentik/bodorgo-email-megerosites.html): a white card on
  // grey with the logo on top, the green button, the club's name under it.
  // Tables and inline styles only: that is what mail programs keep.
  const P = 'margin:0 0 14px;font-size:15px;line-height:1.6;';
  const SMALL = 'font-size:13px;line-height:1.5;color:#56666e;';
  const html = `<!doctype html>
<html lang="hu">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f0f2f5;font-family:Arial,Helvetica,sans-serif;color:#203747;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;">
            <tr>
              <td style="padding:32px 32px 8px;">
                <img src="https://bodorgo.hu/assets/images/oridzsinator-logo.png" width="180" height="31" alt="ORIDZS vagy-e?" style="display:block;border:0;margin:0 0 20px;color:#c8102e;font-family:Arial,Helvetica,sans-serif;font-weight:bold;" />
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#193346;">Meghívó a Bódorgó klubba</h1>
                <p style="${P}">Kedves ${escapeHtml(first)}!</p>
                ${introParagraphs.map((p) => `<p style="${P}">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n                ')}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 32px 20px;">
                <a href="${link}" style="display:inline-block;background:#1a796c;color:#ffffff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;">Regisztrálok</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;">
                <p style="margin:0 0 14px;${SMALL}">A gomb a saját meghívó linked - csak neked szól, egyszer használható.</p>
                <ol style="margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.6;">
                  <li>Nyisd meg - a neved és az e-mail címed (<strong>${escapeHtml(user.email)}</strong>) már ki van töltve.</li>
                  <li>Adj meg egy <strong>legalább 15 karakteres</strong> jelszót (bármilyen karakterekből), és küldd el.</li>
                  <li>Kapsz egy megerősítő e-mailt - kattints a benne lévő linkre.</li>
                  <li>Ezután lépj be a <a href="https://bodorgo.hu" style="color:#1a796c;">bodorgo.hu</a> oldalon.</li>
                </ol>
                <p style="${P}">A link <strong>${dateHu(expiresAt)}</strong>-ig érvényes. Ha lejárt vagy elakadtál, szólj egy adminnak, és küld újat.</p>
                <p style="margin:0 0 8px;${SMALL}">Ha a gomb nem működik, másold be ezt a linket a böngésződbe:</p>
                <p style="margin:0 0 18px;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${link}" style="color:#1a796c;">${escapeHtml(link)}</a></p>${
                  guide
                    ? `
                <p style="margin:0 0 18px;padding:12px 14px;border-radius:10px;background:#edf4f1;font-size:14px;line-height:1.55;">${escapeHtml(GUIDE_NOTE)}</p>`
                    : ''
                }
                <p style="margin:0;font-size:15px;line-height:1.6;">Üdvözlettel:<br>a Bódorgó klub</p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:12px;color:#7a858b;">Bódorgó Szabadidős, Kulturális és Fogyasztóvédelmi Klub</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { subject, text, html };
}

const currentIntro = async () =>
  (await getClubSettings()).invitationIntro ?? DEFAULT_INVITATION_INTRO;

// The invitation as sendResendEmail takes it - with the install guide
// attached (and mentioned) when the server has it.
function invitationMessage(user, link, expiresAt, intro) {
  const guide = installGuideAttachment();
  return {
    ...invitationEmail(user, link, expiresAt, intro, { guide: Boolean(guide) }),
    ...(guide ? { attachments: [guide] } : {}),
  };
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
    data: {
      enabled: await invitationsEnabled(),
      days: INVITATION_DAYS,
      intro: await currentIntro(),
      people: users.map(view),
    },
  });
};

// Sends one person their invitation - a new link each time (the previous
// one, if any, is deleted in Authentik, so only the newest works).
async function invite(user, byName, intro) {
  if (user.invitation?.id) {
    await deleteInvitation(user.invitation.id).catch((err) =>
      logger.warn(`invitations: old invitation of ${user.email} not deleted: ${err.message}`),
    );
  }
  const { id, link, expiresAt } = await createInvitation({ email: user.email, name: user.name });
  await sendResendEmail({ to: user.email, ...invitationMessage(user, link, expiresAt, intro) });
  user.invitation = { id, sentAt: new Date(), expiresAt, sentByName: byName };
  await user.save({ validateModifiedOnly: true });
}

// POST /users/invitations (admin) - { userIds } or { group: 'members' |
// 'others' } (the two batches: club members, then everyone else; each
// only those not invited yet - resending is by userIds). One at a time;
// a failure doesn't stop the others and is reported by name.
export const sendInvitations = async (req, res) => {
  if (!(await invitationsEnabled())) {
    throw new AppError(
      'A meghívók nincsenek beállítva (Beállítások → OIDC szolgáltató: API token).',
      400,
    );
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
  const intro = await currentIntro();
  const sent = [];
  const failed = [];
  for (const user of users) {
    try {
      await invite(user, req.user.name, intro);
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

// PUT /users/invitations/intro (admin) - { intro }: the invitation
// e-mail's intro text, for every invitation sent from now on.
export const updateInvitationIntro = async (req, res) => {
  const intro = String(req.body?.intro ?? '').trim();
  if (!intro || intro.length > 2000) {
    throw new AppError('A bevezető szöveg 1-2000 karakter lehet.', 400);
  }
  const settings = await getClubSettings();
  if ((settings.invitationIntro ?? DEFAULT_INVITATION_INTRO) !== intro) {
    settings.invitationIntro = intro;
    settings.history.push({
      at: new Date(),
      byName: req.user.name,
      change: 'Meghívó e-mail: új bevezető szöveg',
    });
    await settings.save();
  }
  res.status(200).json({ status: 'success', data: { intro } });
};

// POST /users/invitations/test (admin) - { intro? }: the invitation e-mail
// as it will look, to the admin themselves - with the text being edited
// (or the saved one) and a sample link that doesn't work.
export const sendTestInvitation = async (req, res) => {
  if (!req.user.email) throw new AppError('Nincs e-mail címed a fiókodban.', 400);
  const draft = String(req.body?.intro ?? '').trim();
  const intro = draft || (await currentIntro());
  const link = invitationLink(await getOidcSettings(), 'PROBA');
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);
  const email = invitationMessage(req.user, link, expiresAt, intro);
  await sendResendEmail({ to: req.user.email, ...email, subject: `[Próba] ${email.subject}` });
  res.status(200).json({ status: 'success', data: { sentTo: req.user.email } });
};
