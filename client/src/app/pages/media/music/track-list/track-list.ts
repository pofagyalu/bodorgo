import { Component, ElementRef, effect, inject, input, output, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MusicPlayerService, MusicTrack } from '../../../../services/music-player';
import { HoverPreview } from '../../../../shared/hover-preview';
import { playTime } from '../playlist-page';

// Which page's look the list wears: Bódorgó FM's paper and brass, Buli's
// dark track table (with a head row), Duruzsoló's evening (a candle flame
// marks the song that's on, not the bouncing bars).
export type TrackListLook = 'radio' | 'party' | 'lounge';

// A playlist's songs (Bódorgó FM, Buli, Duruzsoló) - tap one to play it
// (picked). The one that's on is marked, and kept in view. The list scrolls
// in itself; the page around it sets its room.
@Component({
  selector: 'app-track-list',
  imports: [MatIconModule, HoverPreview],
  templateUrl: './track-list.html',
  styleUrl: './track-list.scss',
  host: { '[class]': 'look()' },
})
export class TrackList {
  music = inject(MusicPlayerService);

  look = input.required<TrackListLook>();
  tracks = input.required<MusicTrack[]>();
  // The song that's on (-1: none of this list), and whether it's playing.
  currentIndex = input(-1);
  playing = input(false);
  picked = output<number>();

  private list = viewChild<ElementRef<HTMLElement>>('list');
  readonly time = playTime;

  constructor() {
    // The playing song kept in view in the list - by scrolling the list
    // itself only, never the page (scrollIntoView moved the page too).
    effect(() => {
      const i = this.currentIndex();
      this.tracks();
      if (i < 0) return;
      queueMicrotask(() => {
        const list = this.list()?.nativeElement;
        const row = list?.querySelector<HTMLElement>(`[data-index="${i}"]`);
        if (!list || !row) return;
        const listBox = list.getBoundingClientRect();
        const rowBox = row.getBoundingClientRect();
        if (rowBox.top >= listBox.top && rowBox.bottom <= listBox.bottom) return;
        // Out of sight: to the middle of the list's window.
        const top =
          list.scrollTop + (rowBox.top - listBox.top) - (list.clientHeight - row.clientHeight) / 2;
        list.scrollTo({ top, behavior: 'smooth' });
      });
    });
  }
}
