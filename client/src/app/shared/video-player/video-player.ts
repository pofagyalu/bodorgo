import { Component, HostListener, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

// A video playing in a dialog over the page - the title (and a smaller
// line under it) on top, closed with ✕, Esc or a click beside it. Opened
// from an app-video-card; used on Média → Videók and the tour page.
@Component({
  selector: 'app-video-player',
  imports: [MatIconModule],
  templateUrl: './video-player.html',
  styleUrl: './video-player.scss',
})
export class VideoPlayer {
  title = input.required<string>();
  subtitle = input<string | null>(null);
  src = input.required<string>();
  subtitlesSrc = input<string | null>(null);

  closed = output<void>();

  @HostListener('document:keydown.escape')
  close() {
    this.closed.emit();
  }
}
