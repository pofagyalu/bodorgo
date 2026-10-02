import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { PeriodOption, PeriodPicker } from '../../../components/period-picker/period-picker';
import { MediaService, MediaVideo, MediaVideoCategory } from '../../../services/media';
import { VideoCard } from '../../../shared/video-card/video-card';
import { VideoPlayer } from '../../../shared/video-player/video-player';

interface Playing {
  category: MediaVideoCategory;
  video: MediaVideo;
}

// Média → Videók: every category (/media/videok), or just one
// (/media/videok/<key>) as picked in the Média sidebar. The data itself is
// loaded once by the Média shell (see MediaService).
// The hover preview's largest side (px), its gap from the small image, and
// the gap it keeps from the window's edge - keep PREVIEW_MAX and
// PREVIEW_GAP in step with videos.scss.
const PREVIEW_MAX = 320;
const PREVIEW_GAP = 10;
const EDGE_GAP = 8;

@Component({
  selector: 'app-media-videos',
  imports: [MatIconModule, PeriodPicker, VideoCard, VideoPlayer],
  templateUrl: './videos.html',
  styleUrl: './videos.scss',
})
export class Videos {
  media = inject(MediaService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  categoryKey = toSignal(this.route.paramMap.pipe(map((p) => p.get('category'))), {
    initialValue: null,
  });

  // A phone's category picker beside the title (a wide screen has the
  // Média sidebar): "Mind", then the categories, each with its count.
  categoryOptions = computed<PeriodOption[]>(() => [
    { value: 'all', label: 'Mind', count: this.totalCount() },
    ...this.media.categories().map((c) => ({
      value: c.key,
      label: c.title,
      count: c.videos.length,
    })),
  ]);

  chooseCategory(key: string) {
    void this.router.navigate(key === 'all' ? ['/media/videok'] : ['/media/videok', key]);
  }

  shownCategories = computed(() => {
    const key = this.categoryKey();
    const all = this.media.categories();
    return key ? all.filter((c) => c.key === key) : all;
  });
  // A category address that doesn't exist (any more).
  unknownCategory = computed(
    () =>
      !!this.categoryKey() && this.media.categories().length > 0 && !this.shownCategories().length,
  );
  totalCount = computed(() => this.media.categories().reduce((sum, c) => sum + c.videos.length, 0));

  playing = signal<Playing | null>(null);

  // A video's length for its card: "12:34", or "1:02:05" from an hour up -
  // nothing when it isn't known.
  length(seconds: number | null | undefined): string | null {
    if (!seconds) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  coverUrl(category: MediaVideoCategory, video: MediaVideo): string {
    return this.media.coverUrl(category.key, video.id);
  }

  categoryCoverUrl(category: MediaVideoCategory): string {
    return this.media.categoryCoverUrl(category.key);
  }

  // The hovered category image shows to the left of the small one (to its
  // right only if it wouldn't fit on the screen there), opening downward -
  // or upward, if it wouldn't fit below it (hovering near the bottom). Its
  // size comes from the image's own proportions, within the
  // .group-cover-preview limits (videos.scss).
  placeCoverPreview(event: MouseEvent) {
    const wrap = event.currentTarget as HTMLElement;
    const img = wrap.querySelector<HTMLImageElement>('.group-cover-preview');
    let width = PREVIEW_MAX;
    let height = PREVIEW_MAX;
    if (img?.naturalWidth) {
      const maxWidth = Math.min(PREVIEW_MAX, window.innerWidth * 0.8);
      const scale = Math.min(1, maxWidth / img.naturalWidth, PREVIEW_MAX / img.naturalHeight);
      width = img.naturalWidth * scale;
      height = img.naturalHeight * scale;
    }
    const rect = wrap.getBoundingClientRect();
    const roomBelow = window.innerHeight - rect.top;
    const up = height + EDGE_GAP > roomBelow && rect.bottom > roomBelow;
    const right = rect.left - PREVIEW_GAP - width < EDGE_GAP;
    wrap.classList.toggle('group-cover-wrap--up', up);
    wrap.classList.toggle('group-cover-wrap--right', right);
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

  close() {
    this.playing.set(null);
  }
}
