import { Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

// One video as a card: its cover (zooming in slightly on hover, a play
// badge appearing on it), small badges in the bottom corners (e.g. the
// year on the left, the length on the right) and
// its title below. Clicking it emits `playClicked` - the page then opens the
// video in app-video-player. Used on Média → Videók and the tour page,
// laid out in the page's own grid.
@Component({
  selector: 'app-video-card',
  imports: [MatIconModule],
  templateUrl: './video-card.html',
  styleUrl: './video-card.scss',
})
export class VideoCard {
  title = input.required<string>();
  coverUrl = input<string | null>(null);
  // Bottom-left corner of the cover, e.g. the year.
  badge = input<string | number | null>(null);
  // Bottom-right corner of the cover, e.g. the video's length ("12:34").
  badgeRight = input<string | null>(null);
  // Hover text (defaults to the title).
  tooltip = input<string | null>(null);
  // A line under the play badge, shown with it (e.g. the tour page's
  // "Nyomd azt a gombot, te Béla!").
  prompt = input<string | null>(null);

  playClicked = output<void>();
}
