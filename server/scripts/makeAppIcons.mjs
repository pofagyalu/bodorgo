// Makes every app icon the site uses from one source picture
// (client/design/app_icon.png - square, transparent background):
//   assets/icons/app/android-chrome-192x192.png, -512x512.png  (transparent)
//   assets/icons/app/maskable-512x512.png   (white, artwork in Android's safe zone)
//   assets/icons/app/apple-touch-icon.png   (180, white - iOS has no transparency)
//   assets/icons/app/favicon-32x32.png, src/favicon.ico, assets/images/favicon.ico
// Run from server/ (sharp lives here): node scripts/makeAppIcons.mjs
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const client = path.resolve('..', 'client');
const SOURCE = path.join(client, 'design', 'app_icon.png');
const APP = path.join(client, 'src', 'assets', 'icons', 'app');
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

// The artwork alone (the source's empty margin cut off), fitted into a
// `size` square taking up `share` of it, on `background`.
async function icon(size, share, background) {
  const inner = Math.round(size * share);
  const art = await sharp(SOURCE)
    .trim()
    .resize(inner, inner, { fit: 'contain', background: CLEAR })
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: art, gravity: 'centre' }])
    .png()
    .toBuffer();
}

// An .ico holding PNG pictures (every current browser reads these).
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0);
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const write = (file, data) => {
  fs.writeFileSync(file, data);
  console.log(`${path.relative(client, file)}  ${data.length} bytes`);
};

// Home screens and tabs: the artwork with a small margin, transparent.
write(path.join(APP, 'android-chrome-192x192.png'), await icon(192, 0.9, CLEAR));
write(path.join(APP, 'android-chrome-512x512.png'), await icon(512, 0.9, CLEAR));
// Android's adaptive icon: it cuts a circle/squircle out of this, so the
// artwork stays inside the middle (the safe zone), on white.
write(path.join(APP, 'maskable-512x512.png'), await icon(512, 0.68, WHITE));
// iPhone: no transparency there (it would turn black) - on white.
write(path.join(APP, 'apple-touch-icon.png'), await icon(180, 0.82, WHITE));
// Browser tabs: as big as fits.
write(path.join(APP, 'favicon-32x32.png'), await icon(32, 1, CLEAR));
const favicon = ico(
  await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await icon(size, 1, CLEAR) }))),
);
write(path.join(client, 'src', 'favicon.ico'), favicon);
write(path.join(client, 'src', 'assets', 'images', 'favicon.ico'), favicon);
