import config from '../config.js';
import User from '../models/userModel.js';
import logger from '../logger.js';

// Roles (admin / member / guest) are managed in the app itself - Authentik
// is only the identity provider (who someone is), it says nothing about
// their role. Only ONE person may change roles: the "szerepkör-kezelő"
// admin, whose e-mail is INITIAL_ADMIN_USER in the server's .env. Handing
// the app over = changing that line and restarting the server. (See the
// README's handover section.)

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A case-insensitive exact match on an e-mail address.
export const emailMatch = (email) => ({
  email: { $regex: `^${escapeRegex(String(email).trim())}$`, $options: 'i' },
});

export const isInitialAdmin = (email) =>
  !!config.initialAdminUser &&
  String(email ?? '')
    .trim()
    .toLowerCase() === config.initialAdminUser;

// At every server start: the INITIAL_ADMIN_USER gets the role-manager flag
// and is made an admin (so the owner can never lock themselves out), and
// nobody else keeps the flag - a new e-mail there passes it on. If that
// person has no account yet, their first login creates it (see
// authOidcController.js's callback).
export async function syncRoleManager() {
  const email = config.initialAdminUser;
  if (!email) {
    logger.warn('INITIAL_ADMIN_USER is not set - nobody can change roles.');
    return;
  }
  const others = await User.updateMany(
    { canManageRoles: true, $nor: [emailMatch(email)] },
    { canManageRoles: false },
  );
  const owner = await User.findOneAndUpdate(
    emailMatch(email),
    { canManageRoles: true, role: 'admin' },
    { returnDocument: 'after' },
  );
  if (owner) {
    logger.info(`Role manager: ${owner.name} (${email})`);
  } else {
    logger.warn(`Role manager ${email} has no account yet - it is created at their first login.`);
  }
  if (others.modifiedCount) {
    logger.info(`Role manager flag removed from ${others.modifiedCount} other user(s).`);
  }
}
