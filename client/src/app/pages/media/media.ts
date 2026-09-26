import { Component, OnInit, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MediaService } from '../../services/media';

// Outer shell for media/* - the club's videos (and later event photos)
// that don't belong to one tour. Same sidebar layout as the Klub shell,
// with the video categories as an indented sub-menu under Videók.
@Component({
  selector: 'app-media',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, MatIconModule],
  templateUrl: './media.html',
  styleUrl: './media.scss',
})
export class Media implements OnInit {
  media = inject(MediaService);

  // Each video category's icon in the sub-menu - all that's left of it
  // once the sidebar collapses to an icon rail.
  private readonly categoryIcons: Record<string, string> = {
    szilveszter: 'celebration',
    botv: 'live_tv',
    farsang: 'theater_comedy',
    reklam: 'campaign',
  };

  // Logo colors, brightened a little to read on the dark sidebar.
  private readonly categoryColors: Record<string, string> = {
    szilveszter: '#f6b528',
    botv: '#4fb0e8',
    farsang: '#f58a3c',
    reklam: '#f45b5b',
  };

  categoryIcon(key: string): string {
    return this.categoryIcons[key] ?? 'movie';
  }

  categoryColor(key: string): string {
    return this.categoryColors[key] ?? '#a9bdc5';
  }

  ngOnInit() {
    this.media.loadVideos();
  }
}
