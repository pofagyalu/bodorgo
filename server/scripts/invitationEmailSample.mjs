// Writes the invitation e-mail as it would be sent - to a made-up person,
// with the default intro - into an HTML file, to look at it in a browser:
//   node scripts/invitationEmailSample.mjs <out.html>
import fs from 'fs';
import { invitationEmail } from '../src/controllers/invitationController.js';

const [output = 'invitation-sample.html'] = process.argv.slice(2);
const { subject, html } = invitationEmail(
  { name: 'Teszt Elek', email: 'teszt.elek@example.com' },
  'https://oridzs.example/if/flow/enrollment-invitation/?itoken=00000000-0000-0000-0000-000000000000',
  new Date('2026-10-18T12:00:00Z'),
);
fs.writeFileSync(output, html);
console.log(`${subject} → ${output} (${html.length} characters)`);
process.exit(0);
