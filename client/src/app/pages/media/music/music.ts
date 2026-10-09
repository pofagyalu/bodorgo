import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { PlaylistPage } from './playlist-page';
import { FmRadio } from './fm-radio/fm-radio';
import { TrackList } from './track-list/track-list';

// Média → Zene → Bódorgó FM: the club radio's full player, in a retro
// cream-and-brass look - one paper card with the radio (fm-radio: the
// photo, the FM band and its tuning knob, every control) and under it the
// whole playlist to pick from (track-list). The logic: PlaylistPage.
@Component({
  selector: 'app-music',
  imports: [MatIconModule, RouterLink, RouterLinkActive, FmRadio, TrackList],
  templateUrl: './music.html',
  styleUrl: './music.scss',
})
export class Music extends PlaylistPage {
  readonly key = 'bodorgo-fm' as const;
}
