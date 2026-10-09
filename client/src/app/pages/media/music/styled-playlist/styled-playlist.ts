import { Component, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { PlaylistPage } from '../playlist-page';
import { HoverPreview } from '../../../../shared/hover-preview';
import { TrackList } from '../track-list/track-list';

// What differs between the playlists this page shows, besides the colors
// (styled-playlist.scss, by `look`).
interface PlaylistLook {
  look: 'party' | 'lounge';
  name: string;
  cover: string;
  // Under the name.
  tagline?: string;
  // "Bódorgó · 42 dal" - whose list it is, before the count.
  owner?: string;
  // The now-playing bar while nothing is on.
  idleTitle: string;
  idleText: string;
  // The play button and its row: at the header's right end with ▶ in the
  // middle - else a row of its own under the header, ▶ first.
  actionsInHero: boolean;
}

const LOOKS: Record<'buli' | 'hatter', PlaylistLook> = {
  // Buli: the party playlist - a modern, streaming-app look (dark, a
  // gradient header with the cover, a big green play button, a track table).
  buli: {
    look: 'party',
    name: 'Buli rádió',
    cover: 'assets/images/buli-cover.svg',
    owner: 'Bódorgó',
    idleTitle: 'Indítsd el a bulit!',
    idleText: 'Nyomd meg a zöld gombot, vagy válassz egy dalt.',
    actionsInHero: false,
  },
  // Duruzsoló: the quiet playlist, music behind a conversation - an evening
  // look (a dusk sky, candlelight amber, serif headings, everything soft and
  // slow).
  hatter: {
    look: 'lounge',
    name: 'Duruzsoló',
    cover: 'assets/images/hatter-cover.svg',
    tagline: 'Zene a beszélgetések mellé',
    idleTitle: 'Gyújts gyertyát, tölts egy pohárral…',
    idleText: '…és indítsd el halkan a zenét.',
    actionsInHero: true,
  },
};

// Média → Zene → Buli and Duruzsoló: one page in two looks - the header
// with the cover, the play button's row, the now-playing bar and the songs
// (track-list). Which playlist it is comes from the route (data.list). The
// logic: PlaylistPage.
@Component({
  selector: 'app-styled-playlist',
  imports: [MatIconModule, NgTemplateOutlet, HoverPreview, RouterLink, RouterLinkActive, TrackList],
  templateUrl: './styled-playlist.html',
  styleUrl: './styled-playlist.scss',
})
export class StyledPlaylist extends PlaylistPage {
  readonly key = inject(ActivatedRoute).snapshot.data['list'] as 'buli' | 'hatter';
  readonly look = LOOKS[this.key];
}
