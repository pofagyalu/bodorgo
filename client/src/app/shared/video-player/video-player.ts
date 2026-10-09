import {
  Component,
  ElementRef,
  HostListener,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RecreateOn } from '../recreate-on';

export type VideoQuality = 'small' | 'original';

// What the viewer picked last, for the next video too - on this device.
const QUALITY_KEY = 'video-quality';

function storedQuality(): VideoQuality {
  try {
    return localStorage.getItem(QUALITY_KEY) === 'original' ? 'original' : 'small';
  } catch {
    return 'small';
  }
}

// A video playing in a dialog over the page - the title (and a smaller
// line under it) on top, closed with ✕, Esc or a click beside it. Opened
// from an app-video-card; used on Média → Videók and the tour page.
//
// A video with a small copy (`smallSrc` - see services/video-copies.ts)
// plays that one, and has a Tömörített / Eredeti switch on top: the
// original is several times heavier, the compressed one plays on a weak
// connection too (an old 576p video's copy is 576p as well - only
// lighter). Next to the switch, the resolution of the one playing
// ("720p", "1080p"). Switching goes on from where the video was; the
// subtitles go with either.
@Component({
  selector: 'app-video-player',
  imports: [MatIconModule, RecreateOn],
  templateUrl: './video-player.html',
  styleUrl: './video-player.scss',
})
export class VideoPlayer {
  title = input.required<string>();
  subtitle = input<string | null>(null);
  // The original.
  src = input.required<string>();
  // Its small copy, if it has one.
  smallSrc = input<string | null>(null);
  subtitlesSrc = input<string | null>(null);
  // The lines of the two pictures, when known.
  height = input<number | null | undefined>(null);
  smallHeight = input<number | null | undefined>(null);

  closed = output<void>();

  quality = signal<VideoQuality>(storedQuality());
  private playingSmall = computed(() => this.quality() === 'small' && !!this.smallSrc());
  playingSrc = computed(() => (this.playingSmall() ? this.smallSrc()! : this.src()));
  // The resolution of the one playing, the usual way: "720p", "1080p".
  resolution = computed(() => {
    const lines = this.playingSmall() ? this.smallHeight() : this.height();
    return lines ? `${lines}p` : null;
  });

  private video = viewChild<ElementRef<HTMLVideoElement>>('video');
  // Where the other quality goes on from, once it has loaded.
  private resumeAt = 0;

  setQuality(quality: VideoQuality) {
    if (quality === this.quality()) return;
    this.resumeAt = this.video()?.nativeElement.currentTime ?? 0;
    this.quality.set(quality);
    try {
      localStorage.setItem(QUALITY_KEY, quality);
    } catch {
      // No storage here - the choice lasts for this video only.
    }
  }

  onLoaded(video: HTMLVideoElement) {
    if (!this.resumeAt) return;
    video.currentTime = this.resumeAt;
    this.resumeAt = 0;
  }

  @HostListener('document:keydown.escape')
  close() {
    this.closed.emit();
  }
}
