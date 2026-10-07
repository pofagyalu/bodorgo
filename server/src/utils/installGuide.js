import fs from 'fs';
import path from 'path';

// "Bódorgó a telefonodon": the one-page guide to putting the app on a
// phone's home screen (Android and iPhone side by side) - a PDF in assets/
// (see sync.js), attached to every invitation e-mail.
export const INSTALL_GUIDE_FILE = path.join(
  path.resolve(),
  'assets',
  'guides',
  'bodorgo-telepites.pdf',
);
// What the attachment is called in the e-mail.
const ATTACHMENT_NAME = 'Bodorgo-a-telefonodon.pdf';

// The guide as an e-mail attachment - null while the file isn't there, and
// the e-mail then goes without it (and without the sentence about it).
export function installGuideAttachment(file = INSTALL_GUIDE_FILE) {
  try {
    return { filename: ATTACHMENT_NAME, content: fs.readFileSync(file) };
  } catch {
    return null;
  }
}
