import type PhotoSwipeLightbox from 'photoswipe/lightbox';

// A PNG may be transparent (a logo...) - opened big, its see-through parts
// get a checkerboard behind them (like an image editor's), instead of the
// viewer's near-black, where a dark logo would vanish. Only behind PNGs
// (by the file name in `alt`); the opaque parts cover it anyway. The
// pattern itself: .pswp-checker in styles.scss.
export function checkerTransparentPngs(lightbox: PhotoSwipeLightbox) {
  lightbox.on('contentAppend', ({ content }) => {
    if (content.type === 'image' && /\.png$/i.test(String(content.data.alt ?? ''))) {
      content.element?.classList.add('pswp-checker');
    }
  });
}
