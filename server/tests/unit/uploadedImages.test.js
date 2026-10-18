import { describe, expect, it } from 'vitest';
import { uploadedImageKind, withUploadSlot } from '../../src/utils/uploadedImages.js';

// An uploaded photo, before sharp opens it (utils/uploadedImages.js).

const bytes = (...parts) =>
  Buffer.concat(
    parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))),
  );
const pad = (buf) => Buffer.concat([buf, Buffer.alloc(16)]);

describe('what an uploaded file is', () => {
  it('knows the pictures a phone sends, by their first bytes', () => {
    expect(uploadedImageKind(pad(bytes([0xff, 0xd8, 0xff, 0xe0])))).toBe('jpeg');
    expect(uploadedImageKind(pad(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))).toBe(
      'png',
    );
    expect(uploadedImageKind(pad(bytes('GIF89a')))).toBe('gif');
    expect(uploadedImageKind(pad(bytes('RIFF', [0, 0, 0, 0], 'WEBP')))).toBe('webp');
    expect(uploadedImageKind(pad(bytes([0, 0, 0, 24], 'ftypheic')))).toBe('heif');
    expect(uploadedImageKind(pad(bytes([0, 0, 0, 24], 'ftypavif')))).toBe('heif');
  });

  it('nothing else: an SVG, a video, text, a tiny scrap', () => {
    expect(uploadedImageKind(pad(bytes('<svg xmlns="http://www.w3.org/2000/svg">')))).toBeNull();
    expect(uploadedImageKind(pad(bytes('<?xml version="1.0"?><svg>')))).toBeNull();
    expect(uploadedImageKind(pad(bytes([0, 0, 0, 24], 'ftypisom')))).toBeNull(); // an MP4
    expect(uploadedImageKind(pad(bytes('not an image')))).toBeNull();
    expect(uploadedImageKind(bytes([0xff, 0xd8]))).toBeNull();
    expect(uploadedImageKind('a string')).toBeNull();
  });
});

describe('uploaded photos in their turn', () => {
  it('two at a time - the rest wait', async () => {
    let now = 0;
    let most = 0;
    const job = () =>
      withUploadSlot(async () => {
        now++;
        most = Math.max(most, now);
        await new Promise((r) => setTimeout(r, 20));
        now--;
      });
    await Promise.all(Array.from({ length: 6 }, job));
    expect(most).toBe(2);
  });

  it('a failed one frees its turn', async () => {
    await expect(
      withUploadSlot(async () => {
        throw new Error('broken');
      }),
    ).rejects.toThrow('broken');
    await expect(withUploadSlot(async () => 'next')).resolves.toBe('next');
  });
});
