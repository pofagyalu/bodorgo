import { Component, OnInit, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { filter, map, startWith } from 'rxjs';
import { MediaService } from '../../services/media';
import { AuthService } from '../../auth/auth.service';

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
  private auth = inject(AuthService);
  private router = inject(Router);
  // "Új média felfedezése" - the button at the bottom of the sidebar.
  isAdmin = computed(() => this.auth.user()?.role === 'admin');

  // Which of the three one is in ("videok", "fotok", "zene") - the sidebar
  // shows only that one's sub-menu, so it stays short as the sections grow.
  section = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(null),
      map(() => /^\/media\/([^/?#]+)/.exec(this.router.url)?.[1] ?? ''),
    ),
    { initialValue: '' },
  );

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
    this.media.loadPhotos();
    if (this.isAdmin()) this.media.resumeDiscovery();
  }
}
