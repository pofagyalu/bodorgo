import type { SlideData } from 'photoswipe';

// The smaller versions the server makes of a photo (?w=, see server
// photos/imageSizes.js). PhotoSwipe picks one from the srcset by how wide
// the photo shows on the screen times its pixel density - a phone in
// portrait gets the 800 or the 1200, a big screen the 1920. The original
// stays for the download button only.
export const PHOTO_WIDTHS = [800, 1200, 1920];

// One viewer slide: the versions up to the photo's own width (never
// enlarged - a 1000 px photo's "1200" is 1000 px wide), and the grid
// thumbnail as the placeholder, shown at once while the sharp one loads
// instead of a black screen.
export function photoSlide(
  url: string,
  thumbUrl: string,
  photo: { width: number; height: number },
  alt: string,
): SlideData {
  const versions: { url: string; width: number }[] = [];
  for (const w of PHOTO_WIDTHS) {
    versions.push({ url: `${url}?w=${w}`, width: Math.min(w, photo.width) });
    if (w >= photo.width) break;
  }
  return {
    src: versions.at(-1)!.url,
    srcset: versions.map((v) => `${v.url} ${v.width}w`).join(', '),
    msrc: thumbUrl,
    width: photo.width,
    height: photo.height,
    alt,
  };
}
