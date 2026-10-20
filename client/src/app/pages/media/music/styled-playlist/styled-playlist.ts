import { Component, inject } from '@angular/core';
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
  // "Csűrdöngölő kultúrpajta" - where it plays, on a line of its own above
  // "42 dal".
  owner?: string;
  // The now-playing bar while nothing is on.
  idleTitle: string;
  idleText: string;
}

const LOOKS: Record<'buli' | 'hatter', PlaylistLook> = {
  // Buli: the party playlist - a modern, streaming-app look (dark, a
  // gradient header with the cover, a green play button, a track table).
  buli: {
    look: 'party',
    name: 'Buli rádió',
    cover: 'assets/images/buli-cover.svg',
    owner: 'Csűrdöngölő kultúrpajta',
    idleTitle: 'Indítsd el a bulit!',
    idleText: 'Nyomd meg a zöld gombot, vagy válassz egy dalt.',
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
  },
};

// Média → Zene → Buli and Duruzsoló: one page in two looks - the header
// with the cover (and the admins' reload), the now-playing bar with every
// control (shuffle ⏮ ▶ ⏹ ⏭ repeat) and the songs (track-list). Which
// playlist it is comes from the route (data.list). The logic: PlaylistPage.
@Component({
  selector: 'app-styled-playlist',
  imports: [MatIconModule, HoverPreview, RouterLink, RouterLinkActive, TrackList],
  templateUrl: './styled-playlist.html',
  styleUrl: './styled-playlist.scss',
})
export class StyledPlaylist extends PlaylistPage {
  readonly key = inject(ActivatedRoute).snapshot.data['list'] as 'buli' | 'hatter';
  readonly look = LOOKS[this.key];
}
