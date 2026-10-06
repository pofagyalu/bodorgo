import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { NotificationsService } from '../notifications/notifications.service';
import { SmallCopyState } from './video-copies';

// Média → Videók - discovered by the server from the NAS folders (see
// server/src/controllers/mediaVideoController.js), nothing stored or
// uploaded here.
export interface MediaVideo {
  id: string;
  // Its own title when it was given one, otherwise the discovered one.
  title: string;
  // The title read from the file name.
  discoveredTitle: string;
  year: number | null;
  season: number | null;
  episode: number | null;
  hasCover: boolean;
  hasSubtitles: boolean;
  // Its length - null if the server couldn't read it from the file.
  durationSeconds?: number | null;
  // Its small copy (see services/video-copies.ts) - 'ready': that one
  // plays unless the original is picked.
  small?: SmallCopyState;
  // The lines of the original's picture and of the small copy's (1080,
  // 720...) - the player's quality switch is labelled with them.
  height?: number | null;
  smallHeight?: number | null;
  // The role manager only: the only members who see it - empty: every
  // member does.
  viewers?: string[];
  // Admins only: an Új média felfedezése met it in the last two weeks.
  isNew?: boolean;
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
  // Only to address the photo by - never shown.
  filename: string;
  // The name it was given - most photos have none.
  title?: string | null;
  // The role manager only: the only members who see it - empty: every
  // member does.
  viewers?: string[];
  width: number;
  height: number;
  takenAt: string | null;
  // Admins only: an Új média felfedezése added it in the last two weeks.
  isNew?: boolean;
}

// How many of them carry "Új" - the count beside a category's name.
export const newCount = (items: { isNew?: boolean }[]) => items.filter((i) => i.isNew).length;

export interface MediaPhotoCategory {
  key: string; // the folder's name
  title: string;
  photos: MediaPhoto[];
}

// What the role manager sets for a video or a photo.
export interface MediaSettings {
  title: string;
  viewers: string[];
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
    // How many video files (tours' and Média's) it met for the first time.
    newVideos?: number;
    // How many videos (tours' and Média's) have no small copy yet.
    videosWithoutSmall?: number;
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

  // The role manager: a video's own title, instead of the one from its file name (an
  // empty one goes back to that), and who may see it. The list here follows.
  updateVideo(categoryKey: string, id: string, settings: MediaSettings) {
    return this.http
      .patch<{
        data: { video: { id: string; title: string; discoveredTitle: string; viewers: string[] } };
      }>(`${this.apiUrl}/${categoryKey}/${id}`, settings)
      .pipe(
        tap((res) =>
          this.categories.update((categories) =>
            categories.map((c) =>
              c.key !== categoryKey
                ? c
                : {
                    ...c,
                    videos: c.videos.map((v) =>
                      v.id === id
                        ? { ...v, title: res.data.video.title, viewers: res.data.video.viewers }
                        : v,
                    ),
                  },
            ),
          ),
        ),
      );
  }

  loadVideos(force = false) {
    if ((this.loaded && !force) || this.loading()) return;
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
  // cookie itself (crossorigin="use-credentials" on the video). The video
  // in the quality asked for: the original, or its small copy.
  videoUrl(category: string, id: string, quality: 'small' | 'original'): string {
    return `${this.apiUrl}/${category}/${id}/video?quality=${quality}`;
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

  // The role manager: a photo's name (an empty one: none) and who may see it. The
  // list here follows.
  updatePhoto(categoryKey: string, filename: string, settings: MediaSettings) {
    return this.http
      .patch<{
        data: { photo: { filename: string; title: string | null; viewers: string[] } };
      }>(this.photoUrl(categoryKey, filename), settings)
      .pipe(
        tap((res) =>
          this.photoCategories.update((categories) =>
            categories.map((c) =>
              c.key !== categoryKey
                ? c
                : {
                    ...c,
                    photos: c.photos.map((p) =>
                      p.filename === filename
                        ? { ...p, title: res.data.photo.title, viewers: res.data.photo.viewers }
                        : p,
                    ),
                  },
            ),
          ),
        ),
      );
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
      report.newVideos ? `${report.newVideos} új videó` : null,
      // A reminder: they are made one by one, on the video's own card.
      report.videosWithoutSmall
        ? `${report.videosWithoutSmall} videónak nincs tömörített változata`
        : null,
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
          // What it brought carries "Új" from now - both lists anew.
          this.loadPhotos(true);
          this.loadVideos(true);
        },
        error: () => this.pollDiscovery(),
      });
    }, 2000);
  }
}
