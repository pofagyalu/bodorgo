// Takes the two sample songs of scripts/seedSongs.mjs out of the Daloskönyv
// of the database DB_URI points at - before the real songs go in.
//   node scripts/removeSeedSongs.mjs
import 'dotenv/config';
import mongoose from 'mongoose';
import Song from '../src/models/songModel.js';

await mongoose.connect(process.env.DB_URI);
console.log(`Database: ${mongoose.connection.name}`);
const { deletedCount } = await Song.deleteMany({ title: { $in: ['Próbadal', 'Akkordteszt'] } });
console.log(`removed ${deletedCount} sample song(s); ${await Song.countDocuments()} left`);
await mongoose.disconnect();
