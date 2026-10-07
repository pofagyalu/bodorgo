// One-off: the weather outlook's round mood badges (client/src/assets/
// images/weather-outlook/badges/*.svg) as PNGs for the Programfüzet, since
// pdfkit can't embed SVG - into server/assets/img/weather-outlook, like
// the day icons in server/assets/img/weather. Run again if a badge changes:
//   node scripts/convertOutlookBadges.mjs
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const from = path.resolve('../client/src/assets/images/weather-outlook/badges');
const to = path.resolve('assets/img/weather-outlook');
fs.mkdirSync(to, { recursive: true });

for (const file of fs.readdirSync(from).filter((f) => f.endsWith('.svg'))) {
  const tier = file.replace(/^badge-|\.svg$/g, '');
  await sharp(path.join(from, file), { density: 600 })
    .resize(128, 128)
    .png()
    .toFile(path.join(to, `${tier}.png`));
  console.log(`${file} -> ${tier}.png`);
}
