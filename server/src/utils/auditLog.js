import AuditLog from '../models/auditLogModel.js';
import User from '../models/userModel.js';
import sendResendEmail from './resendEmail.js';
import { escapeHtml } from './mailHtml.js';
import logger from '../logger.js';

// Napló (models/auditLogModel.js): one entry for each operation that moves
// money or rights, written by the controller once the operation is done.
// The operation has already happened by then, so a failed write is logged
// and never fails the request.
//
// mail: true also tells every admin by e-mail - for what is rare and
// matters at once (a role, a payout); cash payments are only in the Napló.
export async function recordAudit(req, { action, target, summary, details, mail = false }) {
  try {
    await AuditLog.create({
      action,
      actor: req.user._id,
      actorName: req.user.name,
      target: target?._id,
      targetName: target?.name,
      summary,
      details,
    });
  } catch (err) {
    logger.error(`Audit log write failed (${action}: ${summary}): ${err.message}`);
  }
  logger.info(`Napló: ${req.user.name} (${req.user._id}) - ${summary}`);

  if (!mail) return;
  try {
    const admins = await User.find({ role: 'admin', email: { $nin: [null, ''] } }).select('email');
    if (!admins.length) return;
    await sendResendEmail({
      to: admins.map((a) => a.email),
      subject: `Bódorgó napló: ${summary}`,
      html: `<p><strong>${escapeHtml(req.user.name)}</strong>: ${escapeHtml(summary)}</p><p>Ha nem tudsz róla, azonnal nézd meg a Klub → Napló oldalon!</p>`,
      text: [
        `${req.user.name}: ${summary}`,
        '',
        'Ha nem tudsz róla, azonnal nézd meg a Klub → Napló oldalon!',
      ].join('\n'),
    });
  } catch (err) {
    logger.error(`Audit log e-mail failed (${action}): ${err.message}`);
  }
}

// As the app's own lists call them (Klub → Felhasználók).
export const ROLE_NAMES = { admin: 'Admin', member: 'Klubtag', guest: 'Vendég' };
export const roleName = (role) => ROLE_NAMES[role] ?? role ?? '(nincs)';
