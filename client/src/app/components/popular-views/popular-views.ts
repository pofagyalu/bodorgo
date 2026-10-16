import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '../../../environments/environment';
import {
  Popular,
  PopularPhoto,
  PopularTrack,
  PopularVideo,
  ViewTrackerService,
} from '../../services/view-tracker';
import { PhotoGalleryService } from '../../shared/photo-gallery';
import { VideoPlayer } from '../../shared/video-player/video-player';
import { MusicPlayerService, PlaylistKey } from '../../services/music-player';

// The homepage's "Népszerű": the most viewed photo, video and tour, the
// most played song and the most opened Daloskönyv song of the last 30 days
// (server utils/views.js) - the first of each this person may see. Each
// opens right here: the photo in the viewer, the video in the player, the
// song in the music player - or goes to the tour's page, the songbook's
// song. Nothing at all while nothing has been seen.
@Component({
  selector: 'app-popular-views',
  imports: [MatIconModule, RouterLink, VideoPlayer],
  templateUrl: './popular-views.html',
  styleUrl: './popular-views.scss',
})
export class PopularViews {
  private views = inject(ViewTrackerService);
  private gallery = inject(PhotoGalleryService);
  music = inject(MusicPlayerService);

  popular = signal<Popular | null>(null);
  hasAny = computed(() => {
    const p = this.popular();
    return !!p && !!(p.photo || p.video || p.tour || p.track || p.song);
  });
  playingVideo = signal<PopularVideo | null>(null);

  constructor() {
    this.views.popular().subscribe({
      next: (popular) => this.popular.set(popular),
      error: () => this.popular.set(null),
    });
  }

  // The server's relative addresses, on the API server.
  api(url: string | null): string | null {
    return url ? `${environment.apiBaseUrl}${url}` : null;
  }

  openPhoto(photo: PopularPhoto) {
    void this.gallery.open([
      {
        name: photo.filename,
        caption: photo.title,
        width: photo.width,
        height: photo.height,
        thumbUrl: this.api(photo.thumbUrl)!,
        fullUrl: this.api(photo.fullUrl)!,
        downloadUrl: this.api(photo.downloadUrl)!,
        viewKey: photo.key,
      },
    ]);
  }

  // This song is the one on, and playing.
  isPlaying(track: PopularTrack): boolean {
    return this.music.isPlaying() && this.music.currentTrack()?.id === track.id;
  }

  // ▶ - from its playlist; ⏸ when it's the one already playing.
  async playTrack(track: PopularTrack) {
    if (this.music.currentTrack()?.id === track.id && this.music.activeKey() === track.playlist) {
      await this.music.toggle();
      return;
    }
    const key = track.playlist as PlaylistKey;
    if (!(await this.music.loadPlaylist(key))) return;
    const index = (this.music.lists()[key] ?? []).findIndex((t) => t.id === track.id);
    if (index >= 0) await this.music.playAt(index, key);
  }

  // "1 234 megtekintés"
  count(n: number): string {
    return n.toLocaleString('hu-HU');
  }
}
