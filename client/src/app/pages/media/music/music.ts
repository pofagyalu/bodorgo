import { Component, computed, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PlaylistPage } from './playlist-page';

// The FM band: the whole playlist, from its first second (88.0 MHz) to its
// last (108.0 MHz).
const FM_LOW = 88;
const FM_HIGH = 108;
// The tuning knob clicks from song to song: one notch per song, this many
// degrees apart (12 songs a full turn).
const DETENT = 30;
// A song without a known length counts as this long on the band.
const FALLBACK_SECONDS = 180;

// Média → Zene → Bódorgó FM: the club radio's full player, in a retro
// cream-and-brass look - the radio photo (alive while playing), an FM band
// whose frequency moves through the whole list as it plays (the big knob
// tunes it: turn it, let go, and it plays from there), every control, and
// the whole playlist to pick from. The rest of the logic: PlaylistPage.
@Component({
  selector: 'app-music',
  imports: [MatIconModule],
  templateUrl: './music.html',
  styleUrl: './music.scss',
})
export class Music extends PlaylistPage {
  readonly key = 'bodorgo-fm' as const;

  readonly bandLabels = [88, 92, 96, 100, 104, 108];

  // Each song's start on the band, in seconds from the list's start, and the
  // list's whole length - in the list's own order (shuffle or not).
  private offsets = computed(() => {
    let at = 0;
    return this.tracks().map((t) => {
      const start = at;
      at += t.durationMs ? t.durationMs / 1000 : FALLBACK_SECONDS;
      return start;
    });
  });
  private totalSeconds = computed(() => {
    const tracks = this.tracks();
    const offsets = this.offsets();
    if (!tracks.length) return 0;
    const last = tracks.at(-1)!;
    return offsets.at(-1)! + (last.durationMs ? last.durationMs / 1000 : FALLBACK_SECONDS);
  });

  // Where the music is on the band now (seconds into the whole list).
  private playingSeconds = computed(() => {
    const i = this.currentIndex();
    return i < 0 ? 0 : (this.offsets()[i] ?? 0) + this.position();
  });

  // While the knob is being turned: the song it clicked to (not yet
  // playing).
  private tuning = signal<number | null>(null);
  private tunedSeconds = computed(() => {
    const i = this.tuning();
    return i === null ? null : (this.offsets()[i] ?? 0);
  });
  shownSeconds = computed(() => this.tunedSeconds() ?? this.playingSeconds());
  bandShare = computed(() =>
    this.totalSeconds() ? Math.min(1, this.shownSeconds() / this.totalSeconds()) : 0,
  );
  frequency = computed(() => (FM_LOW + (FM_HIGH - FM_LOW) * this.bandShare()).toFixed(1));
  // The knob rests in the notch of the song on (or being tuned to).
  knobAngle = computed(() => DETENT * (this.tuning() ?? Math.max(0, this.currentIndex())));
  isTuning = computed(() => this.tuning() !== null);

  // --- Turning the knob: drag (mouse/finger), wheel, arrow keys ---

  private dragAngle: number | null = null;
  private dragRest = 0; // the turn since the last notch
  private commitTimer: ReturnType<typeof setTimeout> | undefined;

  private angleAt(event: PointerEvent, knob: HTMLElement): number {
    const box = knob.getBoundingClientRect();
    const x = event.clientX - (box.left + box.width / 2);
    const y = event.clientY - (box.top + box.height / 2);
    return (Math.atan2(y, x) * 180) / Math.PI;
  }

  knobDown(event: PointerEvent) {
    if (!this.tracks().length) return;
    const knob = event.currentTarget as HTMLElement;
    knob.setPointerCapture(event.pointerId);
    this.dragAngle = this.angleAt(event, knob);
    this.dragRest = 0;
    clearTimeout(this.commitTimer);
    if (this.tuning() === null) this.tuning.set(Math.max(0, this.currentIndex()));
    event.preventDefault();
  }

  knobMove(event: PointerEvent) {
    if (this.dragAngle === null) return;
    const angle = this.angleAt(event, event.currentTarget as HTMLElement);
    // The turn since the last move, the short way round (-180..180).
    let delta = angle - this.dragAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    this.dragAngle = angle;
    this.dragRest += delta;
    // A notch passed: one song on (or back).
    while (this.dragRest >= DETENT) {
      this.dragRest -= DETENT;
      this.stepSong(1);
    }
    while (this.dragRest <= -DETENT) {
      this.dragRest += DETENT;
      this.stepSong(-1);
    }
  }

  knobUp() {
    if (this.dragAngle === null) return;
    this.dragAngle = null;
    this.tuneIn();
  }

  // The wheel and the arrow keys: a song a step, tuned in a moment after
  // the last one.
  knobWheel(event: WheelEvent) {
    event.preventDefault();
    this.step(event.deltaY < 0 ? 1 : -1);
  }

  knobKey(event: KeyboardEvent) {
    const dir =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : 0;
    if (!dir) return;
    event.preventDefault();
    this.step(dir);
  }

  private step(dir: number) {
    if (!this.tracks().length) return;
    if (this.tuning() === null) this.tuning.set(Math.max(0, this.currentIndex()));
    this.stepSong(dir);
    clearTimeout(this.commitTimer);
    this.commitTimer = setTimeout(() => this.tuneIn(), 600);
  }

  // One notch: the next (or previous) song, within the list; a tiny buzz
  // on phones that can.
  private stepSong(dir: number) {
    const last = this.tracks().length - 1;
    const from = this.tuning() ?? 0;
    const to = Math.max(0, Math.min(last, from + dir));
    if (to === from) return;
    this.tuning.set(to);
    navigator.vibrate?.(8);
  }

  // Plays the song the knob clicked to, from its start (nothing changes if
  // it's the one already on).
  private tuneIn() {
    const i = this.tuning();
    if (i === null) return;
    if (i === this.currentIndex() && this.playing()) {
      this.tuning.set(null);
      return;
    }
    void this.music.playAt(i, this.key).then(() => this.tuning.set(null));
  }
}
