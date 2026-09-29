import { Component, OnDestroy, OnInit, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { map } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import type PhotoSwipeLightbox from 'photoswipe/lightbox';
import { photoSlide } from '../../../shared/photo-sizes';
import { checkerTransparentPngs } from '../../../shared/pswp-checker';
import { MediaPhotoCategory, MediaService } from '../../../services/media';

// Média → Fotók: every category (/media/fotok), or just one
// (/media/fotok/<folder>) as picked in the Média sidebar. A category is a
// subfolder of the NAS's bódorgó_egyéb (found by the sidebar's "Új média
// felfedezése"); its photos open in the same lightbox as the tour albums.
@Component({
  selector: 'app-media-photos',
  imports: [MatIconModule, RouterLink, RouterLinkActive],
  templateUrl: './photos.html',
  styleUrl: './photos.scss',
})
export class Photos implements OnInit, OnDestroy {
  media = inject(MediaService);
  private route = inject(ActivatedRoute);

  private categoryKey = toSignal(this.route.paramMap.pipe(map((p) => p.get('category'))), {
    initialValue: null,
  });
  shownCategories = computed(() => {
    const key = this.categoryKey();
    const all = this.media.photoCategories();
    return key ? all.filter((c) => c.key === key) : all;
  });
  unknownCategory = computed(
    () =>
      !!this.categoryKey() &&
      this.media.photoCategories().length > 0 &&
      !this.shownCategories().length,
  );
  totalCount = computed(() =>
    this.media.photoCategories().reduce((sum, c) => sum + c.photos.length, 0),
  );

  thumbUrl(c: MediaPhotoCategory, filename: string): string {
    return this.media.photoThumbUrl(c.key, filename);
  }

  // The lightbox (PhotoSwipe) - loaded only when a photo is opened.
  private lightbox: PhotoSwipeLightbox | null = null;
  private openCategory: MediaPhotoCategory | null = null;

  async open(c: MediaPhotoCategory, index: number) {
    this.openCategory = c;
    if (!this.lightbox) {
      const { default: PhotoSwipeLightbox } = await import('photoswipe/lightbox');
      this.lightbox = new PhotoSwipeLightbox({ pswpModule: () => import('photoswipe') });
      checkerTransparentPngs(this.lightbox);
      this.addDownloadButton(this.lightbox);
      this.lightbox.init();
    }
    this.lightbox.loadAndOpen(
      index,
      c.photos.map((p) =>
        photoSlide(
          this.media.photoUrl(c.key, p.filename),
          this.media.photoThumbUrl(c.key, p.filename),
          p,
          p.filename,
        ),
      ),
    );
  }

  // Download button next to zoom/close, like the tour albums' (see
  // tour-details.ts): the /download route, which makes it a download
  // rather than opening it in a new tab.
  private addDownloadButton(lightbox: PhotoSwipeLightbox) {
    lightbox.on('uiRegister', () => {
      lightbox.pswp!.ui!.registerElement({
        name: 'download-button',
        order: 8,
        isButton: true,
        tagName: 'a',
        title: 'Fénykép letöltése',
        html: {
          isCustomSVG: true,
          size: 24,
          inner: '<path d="M12 16l-6-6h4V4h4v6h4l-6 6zM5 18h14v2H5z" id="pswp__icn-download"/>',
          outlineID: 'pswp__icn-download',
        },
        onInit: (el, pswp) => {
          const link = el as HTMLAnchorElement;
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener');
          const refresh = () => {
            const photo = this.openCategory?.photos[pswp.currIndex];
            link.href =
              photo && this.openCategory
                ? this.media.photoDownloadUrl(this.openCategory.key, photo.filename)
                : '';
          };
          refresh();
          pswp.on('change', refresh);
        },
      });
    });
  }

  ngOnInit() {
    this.media.loadPhotos();
  }

  ngOnDestroy() {
    this.lightbox?.destroy();
  }
}
