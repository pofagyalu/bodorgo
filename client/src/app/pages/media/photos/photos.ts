import { Component, OnDestroy, OnInit, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { map } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import type PhotoSwipeLightbox from 'photoswipe/lightbox';
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

  async open(c: MediaPhotoCategory, index: number) {
    if (!this.lightbox) {
      const { default: PhotoSwipeLightbox } = await import('photoswipe/lightbox');
      this.lightbox = new PhotoSwipeLightbox({ pswpModule: () => import('photoswipe') });
      this.lightbox.init();
    }
    this.lightbox.loadAndOpen(
      index,
      c.photos.map((p) => ({
        src: this.media.photoUrl(c.key, p.filename),
        width: p.width,
        height: p.height,
        alt: p.filename,
      })),
    );
  }

  ngOnInit() {
    this.media.loadPhotos();
  }

  ngOnDestroy() {
    this.lightbox?.destroy();
  }
}
