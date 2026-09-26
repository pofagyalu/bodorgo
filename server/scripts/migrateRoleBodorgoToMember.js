// One-time data migration: userModel.js's role enum used to be
// ['bodorgo', 'admin', 'guest'], renamed to ['admin', 'member', 'guest'] to
// match the value Authentik's new `bodorgo_role` claim sends directly (see
// authOidcController.js's roleFromClaim() and
// authentik-integration-instructions.md). Existing documents still hold the
// old string value in the DB until touched, so anything filtering by
// role: 'member' (getClubMembers, profile.html's Klubtagok section) would
// silently miss them without this. Safe to re-run - a second run just
// updates zero documents.
//
// Usage:
//   node scripts/migrateRoleBodorgoToMember.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import User from '../src/models/userModel.js';

await mongoose.connect(config.db.testUri);

const result = await User.updateMany({ role: 'bodorgo' }, { $set: { role: 'member' } });

console.log(`Updated ${result.modifiedCount} user(s) from role "bodorgo" to "member".`);

await mongoose.disconnect();
