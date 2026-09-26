import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

// Média → Videók - discovered by the server from the NAS folders (see
// server/src/controllers/mediaVideoController.js), nothing stored or
// uploaded here.
export interface MediaVideo {
  id: string;
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
  hasCover: boolean;
  hasSubtitles: boolean;
}

export interface MediaVideoCategory {
  key: string;
  title: string;
  description: string;
  hasCover: boolean;
  videos: MediaVideo[];
}

interface MediaVideosResponse {
  status: string;
  data: { categories: MediaVideoCategory[] };
}

@Injectable({ providedIn: 'root' })
export class MediaService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/media/videos`;

  // Loaded once and shared - the Média sidebar lists the categories, the
  // Videók page shows their videos.
  readonly categories = signal<MediaVideoCategory[]>([]);
  readonly loading = signal(false);
  readonly error = signal(false);
  private loaded = false;

  loadVideos() {
    if (this.loaded || this.loading()) return;
    this.loading.set(true);
    this.error.set(false);
    this.http.get<MediaVideosResponse>(this.apiUrl).subscribe({
      next: (res) => {
        this.categories.set(res.data.categories);
        this.loaded = true;
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  // Plain URLs for <video>/<img>/<track> - the browser sends the session
  // cookie itself (crossorigin="use-credentials" on the video).
  videoUrl(category: string, id: string): string {
    return `${this.apiUrl}/${category}/${id}/video`;
  }

  coverUrl(category: string, id: string): string {
    return `${this.apiUrl}/${category}/${id}/cover`;
  }

  subtitlesUrl(category: string, id: string): string {
    return `${this.apiUrl}/${category}/${id}/subtitles.vtt`;
  }

  categoryCoverUrl(category: string): string {
    return `${this.apiUrl}/${category}/cover`;
  }
}
