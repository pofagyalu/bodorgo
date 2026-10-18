import { loadSharp } from '../photos/imageFiles.js';

// A photo someone uploads (a chat photo, an Ócskapiac item's, a quiz
// picture), before sharp makes our own WebP of it:
// - Its first bytes say what it is, not the name or type the browser gave
//   it: only JPEG, PNG, GIF, WebP and HEIC/AVIF are opened at all - an SVG
//   (drawn by librsvg, which has had holes of its own) or anything else is
//   refused unread.
// - At most MAX_INPUT_PIXELS: a small file can unpack into a huge picture
//   and fill the memory.
// - At most MAX_PARALLEL at once: the rest wait their turn (a phone
//   sending twenty at a time can't take the NAS's memory all at once).

export const MAX_INPUT_PIXELS = 50_000_000; // 8000 x 6250 - a phone's is 12-50 MP
const MAX_PARALLEL = 2;

const startsWith = (buf, bytes, at = 0) => bytes.every((b, i) => buf[at + i] === b);
const ascii = (buf, from, to) => buf.subarray(from, to).toString('latin1');
// HEIC/HEIF and AVIF: an ISO file whose ftyp box names one of these.
const HEIF_BRANDS = [
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
  'avif',
  'avis',
];

// What the bytes are: 'jpeg', 'png', 'gif', 'webp', 'heif' - or null.
export function uploadedImageKind(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (['GIF87a', 'GIF89a'].includes(ascii(buf, 0, 6))) return 'gif';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'webp';
  if (ascii(buf, 4, 8) === 'ftyp' && HEIF_BRANDS.includes(ascii(buf, 8, 12))) return 'heif';
  return null;
}

let running = 0;
const waiting = [];

// The work on one uploaded photo, in its turn.
export async function withUploadSlot(job) {
  if (running >= MAX_PARALLEL) await new Promise((resolve) => waiting.push(resolve));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// sharp on the uploaded bytes - throws, unread, if they aren't one of the
// pictures above. The caller then says "not a picture".
export async function openUploadedImage(buffer) {
  if (!uploadedImageKind(buffer)) throw new Error('not a JPEG, PNG, GIF, WebP or HEIC picture');
  const sharp = await loadSharp();
  return sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS });
}
