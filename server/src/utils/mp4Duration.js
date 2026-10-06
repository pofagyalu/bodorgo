import fs from 'fs';

// How long an MP4 (or MOV) video is, in seconds, and how many lines its
// picture has - read straight from the file's own header (the "mvhd" and
// the tracks' "tkhd" boxes inside "moov"), without ffmpeg: only a few small
// reads, wherever in the file the header is. null for anything that isn't
// such a file, or can't be read.
//
// Remembered per file (by its size and last change), so a list of videos
// doesn't open every file again on every request.

const cache = new Map(); // path -> { size, mtimeMs, seconds, height }

// The boxes directly inside [start, end): { type, bodyStart, end }.
function* boxes(fd, start, end) {
  const header = Buffer.alloc(16);
  let at = start;
  while (at + 8 <= end) {
    if (fs.readSync(fd, header, 0, 16, at) < 8) return;
    let size = header.readUInt32BE(0);
    const type = header.toString('latin1', 4, 8);
    let headerSize = 8;
    if (size === 1) {
      // A 64-bit size follows the type.
      size = Number(header.readBigUInt64BE(8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - at; // "to the end of the file"
    }
    if (size < headerSize) return; // not a box - give up
    yield { type, bodyStart: at + headerSize, end: Math.min(at + size, end) };
    at += size;
  }
}

function readSeconds(fd, mvhdBox) {
  const mvhd = Buffer.alloc(32);
  if (fs.readSync(fd, mvhd, 0, 32, mvhdBox.bodyStart) < 20) return null;
  // Version 1 has 64-bit times; version 0 the usual 32-bit ones.
  const [timescale, duration] =
    mvhd.readUInt8(0) === 1
      ? [mvhd.readUInt32BE(20), Number(mvhd.readBigUInt64BE(24))]
      : [mvhd.readUInt32BE(12), mvhd.readUInt32BE(16)];
  return timescale ? Math.round(duration / timescale) : null;
}

// A track's picture height: the last four bytes of its "tkhd", a 16.16
// fixed-point number - 0 for a sound track.
function readTrackHeight(fd, trakBox) {
  for (const inner of boxes(fd, trakBox.bodyStart, trakBox.end)) {
    if (inner.type !== 'tkhd') continue;
    const tail = Buffer.alloc(4);
    if (fs.readSync(fd, tail, 0, 4, inner.end - 4) < 4) return 0;
    return tail.readUInt32BE(0) >>> 16;
  }
  return 0;
}

function readInfo(fd, fileSize) {
  for (const box of boxes(fd, 0, fileSize)) {
    if (box.type !== 'moov') continue;
    let seconds = null;
    let height = 0;
    for (const inner of boxes(fd, box.bodyStart, box.end)) {
      if (inner.type === 'mvhd') seconds = readSeconds(fd, inner);
      else if (inner.type === 'trak') height = Math.max(height, readTrackHeight(fd, inner));
    }
    return { seconds, height: height || null };
  }
  return { seconds: null, height: null };
}

function mp4Info(filePath) {
  let fd;
  try {
    const { size, mtimeMs } = fs.statSync(filePath);
    const known = cache.get(filePath);
    if (known && known.size === size && known.mtimeMs === mtimeMs) return known;
    fd = fs.openSync(filePath, 'r');
    const info = { size, mtimeMs, ...readInfo(fd, size) };
    cache.set(filePath, info);
    return info;
  } catch {
    return { seconds: null, height: null };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export const mp4DurationSeconds = (filePath) => mp4Info(filePath).seconds;

// The picture's height in lines (1080, 720, 576...).
export const mp4VideoHeight = (filePath) => mp4Info(filePath).height;
