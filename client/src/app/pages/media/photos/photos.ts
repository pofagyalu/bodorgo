import { Component, OnInit, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { map } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { PhotoGalleryService } from '../../../shared/photo-gallery';
import { MediaPhotoCategory, MediaService } from '../../../services/media';

// Média → Fotók: every category (/media/fotok), or just one
// (/media/fotok/<folder>) as picked in the Média sidebar. A category is a
// subfolder of the NAS's bódorgó_egyéb (found by the sidebar's "Új média
// felfedezése"); its photos open in the app's shared photo viewer, like
// the tour albums'.
@Component({
  selector: 'app-media-photos',
  imports: [MatIconModule, RouterLink, RouterLinkActive],
  templateUrl: './photos.html',
  styleUrl: './photos.scss',
})
export class Photos implements OnInit {
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

  // The app's shared photo viewer (shared/photo-gallery) - the same as the
  // tour albums': full screen, download, and the thumbnail strip.
  private gallery = inject(PhotoGalleryService);

  open(c: MediaPhotoCategory, index: number) {
    void this.gallery.open(
      c.photos.map((p) => ({
        name: p.filename,
        width: p.width,
        height: p.height,
        thumbUrl: this.media.photoThumbUrl(c.key, p.filename),
        fullUrl: this.media.photoUrl(c.key, p.filename),
        downloadUrl: this.media.photoDownloadUrl(c.key, p.filename),
      })),
      index,
    );
  }

  ngOnInit() {
    this.media.loadPhotos();
  }
}
