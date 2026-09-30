import { Injectable } from '@angular/core';
import type PhotoSwipeLightbox from 'photoswipe/lightbox';
import type PhotoSwipe from 'photoswipe';
import { photoSlide } from './photo-sizes';
import { checkerTransparentPngs } from './pswp-checker';

// One photo in the viewer. The addresses are the page's (tour album or Média
// photo routes); the smaller sizes come from ?w= (see shared/photo-sizes).
export interface GalleryPhoto {
  name: string; // the file name - the alt text, and PNGs get a checkerboard
  width: number;
  height: number;
  thumbUrl: string;
  fullUrl: string;
  downloadUrl: string;
  mobile?: boolean; // taken with a phone - a small phone icon
  restricted?: boolean; // only the tour's attendees see it (admin toggle)
}

export interface GalleryOptions {
  // "Download all" as a zip (tour albums) - with its size in the tooltip.
  zipUrl?: string;
  zipBytes?: number;
  // Admins: the lock that restricts a photo to the tour's attendees. Asked
  // to save the change; true = saved (the icon then follows).
  onRestrict?: (photo: GalleryPhoto, restricted: boolean) => Promise<boolean>;
}

const ICON_DOWNLOAD =
  '<path d="M12 16l-6-6h4V4h4v6h4l-6 6zM5 18h14v2H5z" id="pswp__icn-download"/>';
const ICON_ZIP =
  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16h-2v2h-2v-2h-2v-2h2v-2h2v2h2v2z" id="pswp__icn-download-all"/>';
const ICON_LOCK =
  '<path d="M12 17a2 2 0 0 0 2-2 2 2 0 0 0-2-2 2 2 0 0 0-2 2 2 2 0 0 0 2 2m6-9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h1V6a5 5 0 0 1 10 0v2h-2V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v2z" id="pswp__icn-restrict"/>';
const ICON_FULLSCREEN =
  '<path d="M5 5h5v2H7v3H5V5zm9 0h5v5h-2V7h-3V5zM5 14h2v3h3v2H5v-5zm12 3v-3h2v5h-5v-2h3z" id="pswp__icn-fullscreen"/>';
const ICON_FULLSCREEN_EXIT =
  '<path d="M8 5h2v5H5V8h3V5zm6 0h2v3h3v2h-5V5zM5 14h5v5H8v-3H5v-2zm9 0h5v2h-3v3h-2v-5z" id="pswp__icn-fullscreen-exit"/>';
const PHONE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 1H8a3 3 0 0 0-3 3v16a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V4a3 3 0 0 0-3-3zm-4 21a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5-5H7V4h10z"/></svg>';

// The app's photo viewer (PhotoSwipe, loaded only when a photo is opened) -
// the tour albums' and Média → Fotók's alike: the photo in the size the
// screen needs (its thumbnail as the placeholder), and in the top bar, next
// to the zoom: full screen, download - and per page: download all (zip),
// the admin's restrict lock, a phone icon on phone photos. A strip of
// thumbnails along the bottom jumps to any photo. The viewer lives on
// <body>, outside Angular - its buttons and strip are plain DOM, styled in
// styles.scss.
@Injectable({ providedIn: 'root' })
export class PhotoGalleryService {
  private lightbox: PhotoSwipeLightbox | null = null;

  async open(photos: GalleryPhoto[], index = 0, options: GalleryOptions = {}) {
    if (!photos.length) return;
    this.lightbox?.destroy();
    const { default: PhotoSwipeLightbox } = await import('photoswipe/lightbox');
    const lightbox = new PhotoSwipeLightbox({ pswpModule: () => import('photoswipe') });
    this.lightbox = lightbox;
    checkerTransparentPngs(lightbox);
    lightbox.on('uiRegister', () => this.addUi(lightbox.pswp!, photos, options));
    // Leaving full screen together with the viewer; the next open builds a
    // fresh one (its buttons and strip belong to this set of photos).
    lightbox.on('close', () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    });
    lightbox.on('destroy', () => {
      if (this.lightbox === lightbox) this.lightbox = null;
    });
    lightbox.init();
    lightbox.loadAndOpen(
      index,
      photos.map((p) => photoSlide(p.fullUrl, p.thumbUrl, p, p.name)),
    );
  }

  private addUi(pswp: PhotoSwipe, photos: GalleryPhoto[], options: GalleryOptions) {
    const ui = pswp.ui!;
    const current = () => photos[pswp.currIndex];

    // A phone photo: a small phone in the top bar while it's the one open.
    if (photos.some((p) => p.mobile)) {
      ui.registerElement({
        name: 'mobile-indicator',
        order: 6,
        isButton: false,
        html: PHONE_SVG.replace('<svg', '<svg width="22" height="22"'),
        onInit: (el) => {
          el.classList.add('pswp__mobile-indicator');
          el.title = 'Mobillal készült';
          const refresh = () => (el.hidden = !current()?.mobile);
          pswp.on('change', refresh);
          refresh();
        },
      });
    }

    // Admins: restrict the photo to the tour's attendees (or lift it).
    const onRestrict = options.onRestrict;
    if (onRestrict) {
      ui.registerElement({
        name: 'restrict-button',
        order: 7,
        isButton: true,
        html: { isCustomSVG: true, size: 24, inner: ICON_LOCK, outlineID: 'pswp__icn-restrict' },
        onInit: (el) => {
          const refresh = () => {
            const photo = current();
            el.title = photo?.restricted
              ? 'Csak a résztvevők látják - kattints a feloldáshoz'
              : 'Mindenki látja - kattints a résztvevőkre korlátozáshoz';
            el.classList.toggle('pswp__button--restrict-active', !!photo?.restricted);
          };
          pswp.on('change', refresh);
          refresh();
          el.addEventListener('click', async () => {
            const photo = current();
            if (!photo) return;
            if (await onRestrict(photo, !photo.restricted)) {
              photo.restricted = !photo.restricted;
              refresh();
            }
          });
        },
      });
    }

    // Download this photo - the /download route (a plain <a download>
    // doesn't work across the client's and the API's subdomains).
    ui.registerElement({
      name: 'download-button',
      order: 8,
      isButton: true,
      tagName: 'a',
      title: 'Fénykép letöltése',
      html: { isCustomSVG: true, size: 24, inner: ICON_DOWNLOAD, outlineID: 'pswp__icn-download' },
      onInit: (el) => {
        const link = el as HTMLAnchorElement;
        link.target = '_blank';
        link.rel = 'noopener';
        const refresh = () => (link.href = current()?.downloadUrl ?? '');
        pswp.on('change', refresh);
        refresh();
      },
    });

    // Download all, as a zip.
    if (options.zipUrl) {
      const size = options.zipBytes ? `\n(zip, kb. ${formatBytes(options.zipBytes)})` : '';
      ui.registerElement({
        name: 'download-all-button',
        order: 9,
        isButton: true,
        tagName: 'a',
        html: { isCustomSVG: true, size: 24, inner: ICON_ZIP, outlineID: 'pswp__icn-download-all' },
        onInit: (el) => {
          const link = el as HTMLAnchorElement;
          link.target = '_blank';
          link.rel = 'noopener';
          link.href = options.zipUrl!;
          link.title = `Összes kép letöltése${size}`;
        },
      });
    }

    // Full screen - right before the zoom (only where the browser can).
    if (document.fullscreenEnabled) {
      ui.registerElement({
        name: 'fullscreen-button',
        order: 9.5,
        isButton: true,
        html: {
          isCustomSVG: true,
          size: 24,
          inner: ICON_FULLSCREEN + ICON_FULLSCREEN_EXIT,
          outlineID: 'pswp__icn-fullscreen',
        },
        onInit: (el) => {
          const refresh = () => {
            const on = !!document.fullscreenElement;
            el.title = on ? 'Kilépés a teljes képernyőből' : 'Teljes képernyő';
            el.classList.toggle('pswp__button--fullscreen-on', on);
          };
          refresh();
          document.addEventListener('fullscreenchange', refresh);
          pswp.on('destroy', () => document.removeEventListener('fullscreenchange', refresh));
          el.addEventListener('click', () => {
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
            else void pswp.element?.requestFullscreen().catch(() => {});
          });
        },
      });
    }

    // The strip of thumbnails along the bottom: a click jumps there.
    if (photos.length > 1) {
      ui.registerElement({
        name: 'thumbnails-strip',
        appendTo: 'root',
        onInit: (el) => {
          el.className = 'pswp__thumbnails-strip';
          const thumbs = photos.map((photo, i) => {
            const thumb = document.createElement('img');
            thumb.src = photo.thumbUrl;
            thumb.loading = 'lazy';
            thumb.className = 'pswp__thumbnails-strip-item';
            thumb.addEventListener('click', () => pswp.goTo(i));
            // A phone photo's thumbnail gets a small phone badge - the <img>
            // can't hold one, hence the wrapper.
            if (photo.mobile) {
              const cell = document.createElement('span');
              cell.className = 'pswp__thumbnails-strip-cell';
              cell.title = 'Mobillal készült';
              cell.append(
                thumb,
                Object.assign(document.createElement('span'), {
                  className: 'pswp__thumbnails-strip-mobile',
                  innerHTML: PHONE_SVG,
                }),
              );
              el.appendChild(cell);
            } else {
              el.appendChild(thumb);
            }
            return thumb;
          });
          const setActive = () => {
            thumbs.forEach((t, i) =>
              t.classList.toggle('pswp__thumbnails-strip-item--active', i === pswp.currIndex),
            );
            thumbs[pswp.currIndex]?.scrollIntoView({ inline: 'center', block: 'nearest' });
          };
          pswp.on('change', setActive);
          pswp.on('afterInit', setActive);
        },
      });
    }
  }
}

// "12.4 MB"
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
