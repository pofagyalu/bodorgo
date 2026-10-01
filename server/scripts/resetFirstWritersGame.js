// Forgets the launch game ("the first three to write in Bódorgók" - see
// src/chat/firstWritersGame.js), so it can be tried again: the organizer's
// next message in Bódorgók starts it afresh.
//
//   node scripts/resetFirstWritersGame.js
//
// For rehearsing locally only: it refuses to touch anything but the
// development database (the game is played once on the live site).
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ quiet: true });
const uri = process.env.DB_URI;
if (!uri) throw new Error('DB_URI missing from server/.env');
const dbName = new URL(uri).pathname.slice(1);
if (dbName !== 'bodorgo-dev') {
  throw new Error(`Only for the development database - this is "${dbName}".`);
}

await mongoose.connect(uri);
try {
  const { deletedCount } = await mongoose.connection.db
    .collection('chatgames')
    .deleteMany({ key: 'first-writers' });
  console.log(
    deletedCount
      ? 'The game is forgotten - your next message in Bódorgók starts it again.'
      : 'There was no game to forget.',
  );
} finally {
  await mongoose.disconnect();
}
