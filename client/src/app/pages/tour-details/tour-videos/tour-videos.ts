import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Tour, TourService, TourVideo } from '../../../services/tour';
import { AuthService } from '../../../auth/auth.service';
import { SmallCopyJob, VideoCopiesService } from '../../../services/video-copies';
import { VideoCard } from '../../../shared/video-card/video-card';
import { VideoPlayer } from '../../../shared/video-player/video-player';
import { VideoSmallCopy } from '../../../shared/video-small-copy/video-small-copy';

// A tour's Tábori videók (tour-details): the recap video's versions as
// cards - the same cards and player as Média → Videók - with the admins'
// "Új" tag and small-copy line. Nothing at all on a tour without a video.
@Component({
  selector: 'app-tour-videos',
  imports: [VideoCard, VideoPlayer, VideoSmallCopy],
  templateUrl: './tour-videos.html',
  styleUrl: './tour-videos.scss',
})
export class TourVideos {
  private tourService = inject(TourService);
  private auth = inject(AuthService);
  // The admins: a video's small copy (services/video-copies.ts) - the line
  // under its card.
  private copies = inject(VideoCopiesService);

  tour = input.required<Tour>();
  // Found on the NAS by the tour number (see tourController.js's getTour) -
  // usually one.
  videos = input.required<TourVideo[]>();

  // The one open in the player dialog.
  playingVideo = signal<TourVideo | null>(null);
  isAdmin = computed(() => this.auth.user()?.role === 'admin');

  constructor() {
    // An admin's small-copy line: conversions already going are followed -
    // from every (re)load of the tour's videos.
    effect(() => {
      if (this.isAdmin() && this.videos().length) untracked(() => this.copies.refresh());
    });
  }

  videoUrl(v: TourVideo): string {
    return this.tourService.videoUrl(this.tour()._id, v.id, 'original');
  }

  // Its small copy, if it has one - what the player then starts with.
  smallVideoUrl(v: TourVideo): string | null {
    return this.smallCopy(v).state === 'ready'
      ? this.tourService.videoUrl(this.tour()._id, v.id, 'small')
      : null;
  }

  smallCopy(v: TourVideo): SmallCopyJob {
    return this.copies.stateOf(this.copies.tour(this.tour()._id, v.id).ref, v.small);
  }

  makeSmallCopy(v: TourVideo) {
    this.copies.convert(this.copies.tour(this.tour()._id, v.id));
  }

  removeSmallCopy(v: TourVideo) {
    this.copies.remove(this.copies.tour(this.tour()._id, v.id));
  }

  coverUrl(v: TourVideo): string {
    return this.tourService.videoCoverUrl(this.tour()._id, v.id);
  }

  subtitlesUrl(v: TourVideo): string {
    return this.tourService.subtitlesUrl(this.tour()._id, v.id);
  }
}
