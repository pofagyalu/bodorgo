import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MusicPlayerService } from '../../../services/music-player';

// The speeds offered for practising - all of them shown at once (one tap).
export const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1];

// The shortest part that can be looped, in seconds.
const MIN_PART = 0.5;

/** Seconds as m:ss. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// The Könyvtár's play-along player: one track at a time, under the book's
// page. For practising: slower without the pitch dropping (the browser's
// own playbackRate), the whole track over and over, or just a part of it -
// A marks where the part starts, B where it ends, and from then on it
// jumps back to A at B. A dot at each end of the part can be dragged (a
// mouse or a finger) to move it. The track keeps playing while the pages
// turn.
@Component({
  selector: 'app-library-player',
  imports: [MatIconModule],
  templateUrl: './library-player.html',
  styleUrl: './library-player.scss',
})
export class LibraryPlayer implements OnDestroy {
  private music = inject(MusicPlayerService);

  src = input.required<string>();
  title = input.required<string>();
  closed = output<void>();

  private audioRef = viewChild.required<ElementRef<HTMLAudioElement>>('audio');
  private barRef = viewChild.required<ElementRef<HTMLElement>>('bar');
  private get audio() {
    return this.audioRef().nativeElement;
  }

  playing = signal(false);
  time = signal(0);
  duration = signal(0);
  speed = signal(1);
  speedsOpen = signal(false);
  // The whole track again and again.
  repeat = signal(false);
  // The part looped: A set, then B; both null - none.
  loopStart = signal<number | null>(null);
  loopEnd = signal<number | null>(null);
  // The end's dot being dragged.
  dragging = signal<'a' | 'b' | null>(null);

  readonly speeds = SPEEDS;
  clock = clock;

  // Where A and B are along the bar, in percent.
  marks = computed(() => {
    const d = this.duration();
    const at = (t: number | null) => (t === null || !d ? null : (100 * t) / d);
    return { a: at(this.loopStart()), b: at(this.loopEnd()) };
  });

  constructor() {
    // A new track: from its start, at once, with no part marked - the speed
    // stays (still practising slowly).
    effect(() => {
      const src = this.src();
      const audio = this.audio;
      audio.src = src;
      this.loopStart.set(null);
      this.loopEnd.set(null);
      this.time.set(0);
      this.duration.set(0);
      this.play();
    });
  }

  ngOnDestroy() {
    this.audio.pause();
    this.audio.removeAttribute('src');
  }

  play() {
    // The club radio stops for the book's track.
    if (this.music.isPlaying()) void this.music.toggle();
    this.audio.playbackRate = this.speed();
    this.audio.play().catch(() => this.playing.set(false));
  }

  toggle() {
    if (this.audio.paused) this.play();
    else this.audio.pause();
  }

  seek(value: string) {
    this.audio.currentTime = Number(value);
    this.time.set(this.audio.currentTime);
  }

  // A few seconds back - to hear a bar again.
  back(seconds = 5) {
    this.seek(String(Math.max(this.loopStart() ?? 0, this.audio.currentTime - seconds)));
  }

  setSpeed(speed: number) {
    this.speed.set(speed);
    this.audio.playbackRate = speed;
    this.speedsOpen.set(false);
  }

  toggleRepeat() {
    this.repeat.update((r) => !r);
  }

  // A, then B, then off again.
  markLoop() {
    const now = this.audio.currentTime;
    if (this.loopStart() === null) {
      this.loopStart.set(now);
    } else if (this.loopEnd() === null) {
      const start = this.loopStart()!;
      // B before A: the two swap.
      if (now < start) {
        this.loopStart.set(now);
        this.loopEnd.set(start);
      } else if (now - start >= MIN_PART) {
        this.loopEnd.set(now);
      }
    } else {
      this.loopStart.set(null);
      this.loopEnd.set(null);
    }
  }

  // --- dragging A or B along the bar ---

  startDrag(which: 'a' | 'b', event: PointerEvent) {
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.dragging.set(which);
  }

  // Each stays on its own side of the other, at least MIN_PART apart.
  onDrag(event: PointerEvent) {
    const which = this.dragging();
    const d = this.duration();
    const rect = this.barRef().nativeElement.getBoundingClientRect();
    if (!which || !d || !rect.width) return;
    const t = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1) * d;
    const start = this.loopStart();
    const end = this.loopEnd();
    if (which === 'a') {
      this.loopStart.set(Math.max(0, end === null ? t : Math.min(t, end - MIN_PART)));
    } else if (start !== null) {
      this.loopEnd.set(Math.min(d, Math.max(t, start + MIN_PART)));
    }
  }

  // Let go: if the track is now outside the part, it goes on from A.
  endDrag() {
    if (!this.dragging()) return;
    this.dragging.set(null);
    const start = this.loopStart();
    const end = this.loopEnd();
    const now = this.audio.currentTime;
    if (start !== null && (now < start || (end !== null && now > end))) this.seek(String(start));
  }

  // --- what the <audio> says ---

  onTime() {
    const now = this.audio.currentTime;
    const start = this.loopStart();
    const end = this.loopEnd();
    if (start !== null && end !== null && now >= end) {
      this.audio.currentTime = start;
      this.time.set(start);
      return;
    }
    this.time.set(now);
  }

  onEnded() {
    const start = this.loopStart();
    if (start !== null && this.loopEnd() === null) {
      // A set but no B: the part runs to the end, then again from A.
      this.audio.currentTime = start;
      this.play();
    } else if (this.repeat()) {
      this.audio.currentTime = 0;
      this.play();
    } else {
      this.playing.set(false);
    }
  }

  close() {
    this.audio.pause();
    this.closed.emit();
  }
}
