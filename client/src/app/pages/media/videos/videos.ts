import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { map } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MediaService, MediaVideo, MediaVideoCategory } from '../../../services/media';

interface Playing {
  category: MediaVideoCategory;
  video: MediaVideo;
}

// Média → Videók: every category (/media/videok), or just one
// (/media/videok/<key>) as picked in the Média sidebar. The data itself is
// loaded once by the Média shell (see MediaService).
@Component({
  selector: 'app-media-videos',
  imports: [MatIconModule, RouterLink, RouterLinkActive],
  templateUrl: './videos.html',
  styleUrl: './videos.scss',
})
export class Videos {
  media = inject(MediaService);
  private route = inject(ActivatedRoute);

  private categoryKey = toSignal(this.route.paramMap.pipe(map((p) => p.get('category'))), { initialValue: null });

  shownCategories = computed(() => {
    const key = this.categoryKey();
    const all = this.media.categories();
    return key ? all.filter((c) => c.key === key) : all;
  });
  // A category address that doesn't exist (any more).
  unknownCategory = computed(() => !!this.categoryKey() && this.media.categories().length > 0 && !this.shownCategories().length);
  totalCount = computed(() => this.media.categories().reduce((sum, c) => sum + c.videos.length, 0));

  playing = signal<Playing | null>(null);

  coverUrl(category: MediaVideoCategory, video: MediaVideo): string {
    return this.media.coverUrl(category.key, video.id);
  }

  categoryCoverUrl(category: MediaVideoCategory): string {
    return this.media.categoryCoverUrl(category.key);
  }

  videoUrl(p: Playing): string {
    return this.media.videoUrl(p.category.key, p.video.id);
  }

  subtitlesUrl(p: Playing): string {
    return this.media.subtitlesUrl(p.category.key, p.video.id);
  }

  play(category: MediaVideoCategory, video: MediaVideo) {
    this.playing.set({ category, video });
  }

  @HostListener('document:keydown.escape')
  close() {
    this.playing.set(null);
  }
}
