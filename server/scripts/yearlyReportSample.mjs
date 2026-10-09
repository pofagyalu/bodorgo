// The yearly club report ("Éves jelentés") of a year, from the database
// in .env (read-only) - to look at it before it is ever sent.
// Run from server/: node scripts/yearlyReportSample.mjs [year] [out.pdf]
import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import config from '../src/config.js';
import { yearlyReportPdf } from '../src/utils/yearlyReport.js';

const year = Number(process.argv[2] ?? new Date().getFullYear());
const out = process.argv[3] ?? `eves-jelentes-${year}-minta.pdf`;

await mongoose.connect(config.db.uri);
const { stats, pdf } = await yearlyReportPdf(year);
fs.writeFileSync(out, pdf);
console.log(JSON.stringify(stats, null, 2));
console.log('written', out, `(${mongoose.connection.name})`);
await mongoose.disconnect();
process.exit(0);
