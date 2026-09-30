import { Component, ElementRef, computed, effect, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MusicPlayerService, PLAYLIST_NAMES } from '../../services/music-player';

// The background music's controls, in the header (see MusicPlayerService,
// which does the playing - this is only the buttons):
// - 'pill' (PC): ▶/⏸, the title – artist (a long one slides; out for a
//   few seconds when a song starts, or on hover), ⏭, 🔊;
// - 'button' (phone): a round ♫ that pulses while playing; tapping it opens
//   a small panel under the header with ▶/⏸, title, artist and ⏭.
@Component({
  selector: 'app-music-player',
  imports: [MatIconModule, NgTemplateOutlet],
  templateUrl: './music-player.html',
  styleUrl: './music-player.scss',
  host: {
    '(document:click)': 'closeOutside($event)',
    '(document:keydown.escape)': 'panelOpen.set(false); volumeOpen.set(false)',
  },
})
export class MusicPlayer {
  music = inject(MusicPlayerService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  mode = input<'pill' | 'button'>('pill');
  panelOpen = signal(false);
  volumeOpen = signal(false);
  // The list that's on (or starts with ▶): "Bódorgó FM" / "Buli rádió".
  listName = computed(() => PLAYLIST_NAMES[this.music.activeKey()]);

  volumeIcon = computed(() => {
    const v = this.music.volume();
    if (this.music.muted() || v === 0) return 'volume_off';
    return v < 0.5 ? 'volume_down' : 'volume_up';
  });

  // The pill's title: shown when a song starts playing, then folded away.
  titleShown = signal(false);
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private static readonly SHOW_MS = 5000;

  constructor() {
    effect(() => {
      const track = this.music.currentTrack();
      if (track && this.music.isPlaying()) this.showTitleFor(MusicPlayer.SHOW_MS);
    });
  }

  private showTitleFor(ms: number) {
    this.titleShown.set(true);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.titleShown.set(false), ms);
  }

  // Hovering the pill shows the title; leaving it folds it soon after.
  peekTitle(over: boolean) {
    if (!this.music.currentTrack()) return;
    if (over) {
      clearTimeout(this.hideTimer);
      this.titleShown.set(true);
    } else {
      this.showTitleFor(1500);
    }
  }

  onVolume(event: Event) {
    this.music.setVolume(Number((event.target as HTMLInputElement).value));
  }

  togglePanel() {
    this.panelOpen.update((open) => !open);
  }

  closeOutside(event: Event) {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.panelOpen.set(false);
      this.volumeOpen.set(false);
    }
  }
}
