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

  ngOnInit() {
    this.media.loadVideos();
  }
}
