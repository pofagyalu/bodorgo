const looksHeic = (file: File) => /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);

// The browser reads JPEG/PNG/WebP itself (and Safari HEIC too). A HEIC
// photo it can't read - Android's "high efficiency" setting, a file copied
// from an iPhone to Windows - goes through heic-to, a decoder loaded only
// then (a few MB, once), never for anyone else.
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    if (!looksHeic(file)) throw err;
    const { heicTo } = await import('heic-to');
    return heicTo({ blob: file, type: 'bitmap' });
  }
}

// Shrinks a photo in the browser before it's uploaded - a 5 MB phone photo
// becomes a ~300 KB JPEG of at most `maxSide` px, so sending it is quick
// even on a weak signal. Upright by its EXIF orientation. (The server
// shrinks it again and drops the EXIF - this is just for the upload.)
export async function shrinkImage(file: File, maxSide = 1600, quality = 0.85): Promise<Blob> {
  const bitmap = await decode(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('A kép nem dolgozható fel ebben a böngészőben.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('A kép nem dolgozható fel.'))),
      'image/jpeg',
      quality,
    ),
  );
}
