import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { PlaylistPage } from './playlist-page';
import { HoverPreview } from '../../../shared/hover-preview';

// Média → Zene → Duruzsoló: the members' quiet playlist, music behind a
// conversation - an evening look (a dusk sky, candlelight amber, serif
// headings, everything soft and slow). The logic: PlaylistPage.
@Component({
  selector: 'app-lounge',
  imports: [MatIconModule, HoverPreview, RouterLink, RouterLinkActive],
  templateUrl: './lounge.html',
  styleUrl: './lounge.scss',
})
export class Lounge extends PlaylistPage {
  readonly key = 'hatter' as const;
}
