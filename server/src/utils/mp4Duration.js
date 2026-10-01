import fs from 'fs';

// How long an MP4 (or MOV) video is, in seconds - read straight from the
// file's own header (the "mvhd" box inside "moov"), without ffmpeg: only a
// few small reads, wherever in the file the header is. null for anything
// that isn't such a file, or can't be read.
//
// Remembered per file (by its size and last change), so a list of videos
// doesn't open every file again on every request.

const cache = new Map(); // path -> { size, mtimeMs, seconds }

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

function readDuration(fd, fileSize) {
  for (const box of boxes(fd, 0, fileSize)) {
    if (box.type !== 'moov') continue;
    for (const inner of boxes(fd, box.bodyStart, box.end)) {
      if (inner.type !== 'mvhd') continue;
      const mvhd = Buffer.alloc(32);
      if (fs.readSync(fd, mvhd, 0, 32, inner.bodyStart) < 20) return null;
      // Version 1 has 64-bit times; version 0 the usual 32-bit ones.
      const [timescale, duration] =
        mvhd.readUInt8(0) === 1
          ? [mvhd.readUInt32BE(20), Number(mvhd.readBigUInt64BE(24))]
          : [mvhd.readUInt32BE(12), mvhd.readUInt32BE(16)];
      return timescale ? Math.round(duration / timescale) : null;
    }
    return null;
  }
  return null;
}

export function mp4DurationSeconds(filePath) {
  let fd;
  try {
    const { size, mtimeMs } = fs.statSync(filePath);
    const known = cache.get(filePath);
    if (known && known.size === size && known.mtimeMs === mtimeMs) return known.seconds;
    fd = fs.openSync(filePath, 'r');
    const seconds = readDuration(fd, size);
    cache.set(filePath, { size, mtimeMs, seconds });
    return seconds;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
