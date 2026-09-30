import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { PlaylistPage } from './playlist-page';
import { HoverPreview } from '../../../shared/hover-preview';

// Média → Zene → Buli: the members' party playlist - a modern, streaming-
// app look (dark, a gradient header with the cover, a big green play
// button, a track table). The logic: PlaylistPage.
@Component({
  selector: 'app-party',
  imports: [MatIconModule, HoverPreview, RouterLink, RouterLinkActive],
  templateUrl: './party.html',
  styleUrl: './party.scss',
})
export class Party extends PlaylistPage {
  readonly key = 'buli' as const;
}
