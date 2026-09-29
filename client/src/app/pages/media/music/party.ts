import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PlaylistPage } from './playlist-page';

// Média → Zene → Buli: the members' party playlist - a modern, streaming-
// app look (dark, a gradient header with the cover, a big green play
// button, a track table). The logic: PlaylistPage.
@Component({
  selector: 'app-party',
  imports: [MatIconModule],
  templateUrl: './party.html',
  styleUrl: './party.scss',
})
export class Party extends PlaylistPage {
  readonly key = 'buli' as const;
}
