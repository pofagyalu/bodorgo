import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RecreateOn } from '../recreate-on';
import { PlayedTime, ViewTrackerService, secondsToCount } from '../../services/view-tracker';

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

// How loud, and whether muted - kept the same way. A video starts at half
// volume until the viewer sets it.
const VOLUME_KEY = 'video-volume';
const MUTED_KEY = 'video-muted';
const DEFAULT_VOLUME = 0.5;

function storedVolume(): number {
  try {
    const stored = localStorage.getItem(VOLUME_KEY);
    const volume = stored === null ? NaN : Number(stored);
    return volume >= 0 && volume <= 1 ? volume : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

function storedMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
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
// ("720p", "1080p"). Switching goes on from where the video was, as loud
// as it was; the subtitles go with either.
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
  // Its key in the view counts (services/view-tracker) - it counts as seen
  // once 30 seconds of it (half of a shorter one) have really played,
  // across a quality switch too.
  viewKey = input<string | null>(null);

  closed = output<void>();

  private views = inject(ViewTrackerService);
  private played = new PlayedTime();
  private counted = false;

  onTimeUpdate(video: HTMLVideoElement) {
    this.played.update(video.currentTime);
    const key = this.viewKey();
    if (!key || this.counted || this.played.seconds < secondsToCount(video.duration)) return;
    this.counted = true;
    this.views.seen({ type: 'video', key });
  }

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

  // The sound as the viewer left it: each video (and each quality - a new
  // <video> every time) starts with it, instead of the browser's full volume.
  private volume = storedVolume();
  private muted = storedMuted();

  // While the kept sound is being put on a new <video> - its own
  // "volumechange" in between is not the viewer's doing.
  private applying = false;

  applyVolume(video: HTMLVideoElement) {
    this.applying = true;
    video.volume = this.volume;
    video.muted = this.muted;
    this.applying = false;
  }

  onVolumeChange(video: HTMLVideoElement) {
    if (this.applying) return;
    if (video.volume === this.volume && video.muted === this.muted) return;
    this.volume = video.volume;
    this.muted = video.muted;
    try {
      localStorage.setItem(VOLUME_KEY, String(this.volume));
      localStorage.setItem(MUTED_KEY, this.muted ? '1' : '0');
    } catch {
      // No storage here - the sound lasts while this player is open.
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
