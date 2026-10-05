import User from '../models/userModel.js';
import logger from '../logger.js';
import { getAuthentikClient } from './oidcSettings.js';

// A user's ids at the identity providers (userModel.js's identities).

// Notes on the user (not saved here) that at this provider they are this
// id - one id per provider, the newest - and takes the id off any other
// account that carries it: it is one account's alone.
export async function linkIdentity(user, issuer, subject) {
  await User.updateMany(
    { _id: { $ne: user._id }, identities: { $elemMatch: { issuer, subject } } },
    { $pull: { identities: { issuer, subject } } },
  );
  const known = user.identities.find((i) => i.issuer === issuer && i.subject === subject);
  if (known && user.identities.filter((i) => i.issuer === issuer).length === 1) return;
  user.identities = [
    ...user.identities.filter((i) => i.issuer !== issuer),
    { issuer, subject, linkedAt: known?.linkedAt ?? new Date() },
  ];
}

// At server start: everyone who logged in before identities existed has
// only `sub` - their id at Authentik. It becomes their first
// identity, under Authentik's issuer address (asked from Authentik
// itself; if it can't be reached now, the next start - or their next login
// - does it).
export async function migrateUserIdentities() {
  const filter = { sub: { $type: 'string', $ne: '' }, 'identities.0': { $exists: false } };
  if (!(await User.exists(filter))) return;
  // Those ids are Authentik's: nobody logged in through anything else
  // before identities existed.
  const { issuer } = (await getAuthentikClient()).serverMetadata();
  // The driver's own call: the new value is built from the document's sub.
  const result = await User.collection.updateMany(filter, [
    { $set: { identities: [{ issuer, subject: '$sub', linkedAt: '$$NOW' }] } },
  ]);
  logger.info(`User identities: ${result.modifiedCount} user(s) linked to ${issuer}`);
}
