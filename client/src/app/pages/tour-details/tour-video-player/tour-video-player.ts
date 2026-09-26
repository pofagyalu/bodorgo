import { Component, OnDestroy, computed, inject, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TourService, TourVideo } from '../../../services/tour';

// How long the picture takes to fade out before the other version loads
// (matches the opacity transition in the stylesheet).
const FADE_MS = 220;

// The tour page's recap video - one player, plus a small card per version
// above it when the tour has more than one cut (e.g. the director's cut
// and another one). The videos are found on the NAS by the tour number
// (see server/src/utils/tourVideos.js).
//
// Switching versions keeps the same <video> element and its fixed-size
// frame: the picture fades out, the other file loads into it, and it
// fades back in on its first frame - so nothing on the page jumps.
@Component({
  selector: 'app-tour-video-player',
  imports: [MatIconModule],
  templateUrl: './tour-video-player.html',
  styleUrl: './tour-video-player.scss',
})
export class TourVideoPlayer implements OnDestroy {
  private tourService = inject(TourService);

  tourId = input.required<string>();
  videos = input.required<TourVideo[]>();

  private selectedId = signal<string | null>(null);
  video = computed(() => this.videos().find((v) => v.id === this.selectedId()) ?? this.videos()[0] ?? null);

  // Drives the custom click-to-play overlay - false until the <video>'s
  // own 'play' event fires, and again for each newly picked version.
  started = signal(false);
  // True from a click on another version until its first frame is ready.
  switching = signal(false);
  private fadeTimer?: ReturnType<typeof setTimeout>;

  videoUrl(v: TourVideo): string {
    return this.tourService.videoUrl(this.tourId(), v.id);
  }

  coverUrl(v: TourVideo): string {
    return this.tourService.videoCoverUrl(this.tourId(), v.id);
  }

  subtitlesUrl(v: TourVideo): string {
    return this.tourService.subtitlesUrl(this.tourId(), v.id);
  }

  select(v: TourVideo) {
    if (v.id === this.video()?.id) return;
    clearTimeout(this.fadeTimer);
    this.switching.set(true);
    // Fade out first, then swap the source - the new file starts loading
    // into the same player (see loaded() for the fade back in).
    this.fadeTimer = setTimeout(() => {
      this.selectedId.set(v.id);
      this.started.set(false);
    }, FADE_MS);
  }

  loaded() {
    this.switching.set(false);
  }

  ngOnDestroy() {
    clearTimeout(this.fadeTimer);
  }
}
