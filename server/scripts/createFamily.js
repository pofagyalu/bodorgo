// Temporary CLI utility for grouping existing real accounts (e.g. two
// parents who both already log in) into a family, so tour signups and
// attendance statistics can be scoped to "everyone in this family" - see
// userModel.js's familyId field for why this exists.
//
// This is step 1 of the family workflow: every family starts from at least
// one existing real account. To add children (who have no account/email of
// their own) to the family afterwards, use addFamilyMember.js with the
// familyId this script prints, or any family member's email.
//
// Usage:
//   node scripts/createFamily.js <email> [<email2> ...]

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import User from '../src/models/userModel.js';

const [, , ...emails] = process.argv;

if (emails.length === 0) {
  console.error('Usage: node scripts/createFamily.js <email> [<email2> ...]');
  process.exit(1);
}

await mongoose.connect(config.db.uri);

const users = [];
for (const email of emails) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    console.error(`No user found with email ${email}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  if (user.familyId) {
    console.error(
      `${user.name} (${email}) already belongs to a family (${user.familyId}) - use addFamilyMember.js instead.`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }
  users.push(user);
}

const familyId = new mongoose.Types.ObjectId();
for (const user of users) {
  user.familyId = familyId;
  await user.save();
}

console.log(`Created family ${familyId} with:`);
for (const user of users) {
  console.log(`  - ${user.name} (${user.email})`);
}
console.log(
  `\nAdd children with: node scripts/addFamilyMember.js ${emails[0]} "<Child Name>" [futureEmail]`,
);

await mongoose.disconnect();
