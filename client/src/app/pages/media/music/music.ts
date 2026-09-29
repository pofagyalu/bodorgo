import { Component, ElementRef, OnInit, effect, inject, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MusicPlayerService } from '../../../services/music-player';

// Média → Zene → Bódorgó FM: the full music player - a big radio (it comes
// alive while playing), every control, and the whole playlist to pick
// from. The playing itself is MusicPlayerService, the same as the header's
// small player - so leaving this page, the music plays on.
@Component({
  selector: 'app-music',
  imports: [MatIconModule],
  templateUrl: './music.html',
  styleUrl: './music.scss',
})
export class Music implements OnInit {
  music = inject(MusicPlayerService);
  private list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    // The playing song kept in view in the list.
    effect(() => {
      const i = this.music.index();
      this.music.tracks();
      queueMicrotask(() =>
        this.list()
          ?.nativeElement.querySelector(`[data-index="${i}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      );
    });
  }

  ngOnInit() {
    void this.music.loadPlaylist();
  }

  // "2:36" (or "1:02:05").
  time(seconds: number | null | undefined): string {
    if (!seconds || !Number.isFinite(seconds)) return '0:00';
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }

  onSeek(event: Event) {
    this.music.seek(Number((event.target as HTMLInputElement).value));
  }

  onVolume(event: Event) {
    this.music.setVolume(Number((event.target as HTMLInputElement).value));
  }
}
