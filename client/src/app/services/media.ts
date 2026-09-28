import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { NotificationsService } from '../notifications/notifications.service';

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

// Média → Fotók - every subfolder of the NAS's bódorgó_egyéb is a category
// (see server/src/photos/mediaPhotoSync.js), recorded by "Új média
// felfedezése".
export interface MediaPhoto {
  filename: string;
  width: number;
  height: number;
  takenAt: string | null;
}

export interface MediaPhotoCategory {
  key: string; // the folder's name
  title: string;
  photos: MediaPhoto[];
}

// "Új média felfedezése" - what the last (or running) discovery found.
export interface DiscoveryResult {
  title: string;
  added?: number;
  removed?: number;
  total?: number;
  failures?: number;
  skipped?: string[];
  error?: string;
}

export interface DiscoveryStatus {
  running: boolean;
  startedAt?: string;
  finishedAt?: string;
  by?: string;
  error?: string;
  report?: {
    matched: string[];
    tours: DiscoveryResult[];
    media: DiscoveryResult[];
    // Tours whose new recap video was announced to their attendees.
    videos?: string[];
  };
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

  // --- Fotók ---

  private mediaUrl = `${environment.apiBaseUrl}/media`;
  readonly photoCategories = signal<MediaPhotoCategory[]>([]);
  readonly photosLoading = signal(false);
  readonly photosError = signal(false);
  private photosLoaded = false;

  // force: again after a discovery, to show what it found.
  loadPhotos(force = false) {
    if ((this.photosLoaded && !force) || this.photosLoading()) return;
    this.photosLoading.set(true);
    this.photosError.set(false);
    this.http
      .get<{ data: { categories: MediaPhotoCategory[] } }>(`${this.mediaUrl}/photos`)
      .subscribe({
        next: (res) => {
          this.photoCategories.set(res.data.categories);
          this.photosLoaded = true;
          this.photosLoading.set(false);
        },
        error: () => {
          this.photosError.set(true);
          this.photosLoading.set(false);
        },
      });
  }

  photoUrl(category: string, filename: string): string {
    return `${this.mediaUrl}/photos/${encodeURIComponent(category)}/${encodeURIComponent(filename)}`;
  }

  photoThumbUrl(category: string, filename: string): string {
    return `${this.photoUrl(category, filename)}/thumb`;
  }

  // The original as a download (the viewer's download button).
  photoDownloadUrl(category: string, filename: string): string {
    return `${this.photoUrl(category, filename)}/download`;
  }

  // --- Új média felfedezése (admins) ---
  // The button is in the Média sidebar, the report on top of whichever
  // Média page is open (see media.html) - so the state lives here.

  private notifications = inject(NotificationsService);
  readonly discovery = signal<DiscoveryStatus | null>(null);
  private pollTimer?: ReturnType<typeof setTimeout>;

  // What the last run changed, one line each (empty: nothing new).
  readonly discoveryReport = computed(() => {
    const report = this.discovery()?.report;
    if (!report) return [];
    const describe = (r: DiscoveryResult) => {
      if (r.error) return `${r.title}: hiba – ${r.error}`;
      const parts = [];
      if (r.added) parts.push(`+${r.added} új fotó`);
      if (r.removed) parts.push(`${r.removed} törölve`);
      if (r.failures) parts.push(`${r.failures} nem sikerült`);
      if (r.skipped?.length) parts.push(`kihagyott almappa: ${r.skipped.join(', ')}`);
      return parts.length ? `${r.title}: ${parts.join(', ')}` : null;
    };
    return [
      ...report.matched.map((m) => `Új tábormappa: ${m}`),
      ...(report.videos ?? []).map((t) => `Új tábori videó: ${t} – értesítés kiküldve`),
      ...report.tours.map(describe),
      ...report.media.map((r) => {
        const line = describe(r);
        return line ? `Média – ${line}` : null;
      }),
    ].filter((l): l is string => !!l);
  });

  discover() {
    if (this.discovery()?.running) return;
    this.http.post<{ data: DiscoveryStatus }>(`${this.mediaUrl}/discover`, {}).subscribe({
      next: (res) => {
        this.discovery.set(res.data);
        this.pollDiscovery();
      },
      error: (err) => {
        // 409: one is already running (another admin's) - follow that one.
        if (err?.status === 409 && err.error?.data) {
          this.discovery.set(err.error.data);
          this.pollDiscovery();
        } else {
          this.notifications.addError('Nem sikerült elindítani a felfedezést.');
        }
      },
    });
  }

  // A run already going (e.g. started before a page reload) is followed to
  // its end.
  resumeDiscovery() {
    this.http.get<{ data: DiscoveryStatus }>(`${this.mediaUrl}/discover`).subscribe({
      next: (res) => {
        if (!res.data.running) return;
        this.discovery.set(res.data);
        this.pollDiscovery();
      },
    });
  }

  closeDiscoveryReport() {
    if (!this.discovery()?.running) this.discovery.set(null);
  }

  private pollDiscovery() {
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      this.http.get<{ data: DiscoveryStatus }>(`${this.mediaUrl}/discover`).subscribe({
        next: (res) => {
          this.discovery.set(res.data);
          if (res.data.running) return this.pollDiscovery();
          if (res.data.error) {
            this.notifications.addError(`A felfedezés megszakadt: ${res.data.error}`);
          } else {
            this.notifications.addSuccess('Új média felfedezése kész');
          }
          this.loadPhotos(true);
        },
        error: () => this.pollDiscovery(),
      });
    }, 2000);
  }
}
