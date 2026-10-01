import { Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MusicPlayerService, PlaylistKey } from '../../../services/music-player';

interface PlaylistCard {
  key: PlaylistKey;
  route: string;
  name: string;
  tagline: string;
  cover: string;
  icon: string;
}

const CARDS: PlaylistCard[] = [
  {
    key: 'bodorgo-fm',
    route: 'bodorgo-fm',
    name: 'Bódorgó FM',
    tagline: 'Világjárók világzenei rádiója',
    cover: 'assets/images/bodorgo_FM.jpg',
    icon: 'radio',
  },
  {
    key: 'buli',
    route: 'buli',
    name: 'Buli rádió',
    tagline: 'Táncra fel – a bulik lejátszási listája',
    cover: 'assets/images/buli-cover.svg',
    icon: 'celebration',
  },
];

// Média → Zene: the two playlists as cards - each in its own page's look
// (the cream radio, the dark party list), with how much is on it and
// whether it's the one playing now. A card opens the playlist's own page
// (music.ts, party.ts). The same kind of start page as Videók's and Fotók's.
@Component({
  selector: 'app-music-home',
  imports: [RouterLink, MatIconModule],
  templateUrl: './music-home.html',
  styleUrl: './music-home.scss',
})
export class MusicHome implements OnInit {
  private music = inject(MusicPlayerService);

  // Each card with its list's size ("42 dal · kb. 2 óra 10 perc" - null
  // until the list has arrived) and whether it's playing.
  cards = computed(() =>
    CARDS.map((card) => {
      const tracks = this.music.lists()[card.key];
      return {
        ...card,
        summary: tracks ? summary(tracks) : null,
        playing: this.music.activeKey() === card.key && this.music.isPlaying(),
      };
    }),
  );

  ngOnInit() {
    for (const card of CARDS) void this.music.loadPlaylist(card.key);
  }
}

function summary(tracks: { durationMs: number | null }[]): string {
  const minutes = Math.round(tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0) / 60000);
  const hours = Math.floor(minutes / 60);
  const length = hours ? `kb. ${hours} óra ${minutes % 60} perc` : `kb. ${minutes} perc`;
  return minutes ? `${tracks.length} dal · ${length}` : `${tracks.length} dal`;
}
