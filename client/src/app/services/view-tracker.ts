import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';

// Megtekintések (server utils/views.js): what counts as seen is decided
// where it is seen - these are the rules.
// A photo: this long as the one open in the viewer (the ones it preloads,
// or swipes past, don't count).
export const PHOTO_SEEN_MS = 2000;
// A video or a song: this many seconds really played - or half of a
// shorter one.
export const PLAY_SEEN_SECONDS = 30;
// A Daloskönyv song: its page open this long.
export const SONG_SEEN_MS = 10_000;
// A songbook search that finds nothing: counted once the typing has
// stopped this long (not every half-typed word on the way).
export const SEARCH_SETTLE_MS = 2000;

export type ViewType = 'photo' | 'video' | 'tour' | 'track' | 'song' | 'search';

// What was seen. key: "tour:<tourId>:<filename>" / "media:<category>:
// <filename>" for a photo, the same with the video's id for a video, the
// tour's id, a song's id (with the playlist it was played from), a
// Daloskönyv song's id, the words searched for.
export interface SeenItem {
  type: ViewType;
  key: string;
  playlist?: string;
}

// Opened from its home screen icon - the installed app, not a browser tab.
export function isInstalledApp(): boolean {
  return (
    !!window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// Seconds to play before it counts: 30, or half of a shorter one.
export function secondsToCount(duration: number): number {
  return Number.isFinite(duration) && duration > 0
    ? Math.min(PLAY_SEEN_SECONDS, duration / 2)
    : PLAY_SEEN_SECONDS;
}

// How long it really played, from an <audio>/<video>'s "timeupdate"s: only
// the small steps of playing add up - a jump (seeking, another source)
// doesn't.
export class PlayedTime {
  seconds = 0;
  private last: number | null = null;

  update(currentTime: number) {
    if (this.last !== null) {
      const step = currentTime - this.last;
      if (step > 0 && step < 2) this.seconds += step;
    }
    this.last = currentTime;
  }

  reset() {
    this.seconds = 0;
    this.last = null;
  }
}

// The homepage's "Népszerű" (GET /views/popular): each kind's most viewed
// of the last 30 days that this person may see - null where there is none.
// Addresses are relative, on the API server.
interface Counted {
  key: string;
  views: number;
  viewers: number;
}
export interface PopularPhoto extends Counted {
  source: 'tour' | 'media';
  title: string;
  link: string;
  filename: string;
  width: number;
  height: number;
  fullUrl: string;
  thumbUrl: string;
  downloadUrl: string;
}
export interface PopularVideo extends Counted {
  source: 'tour' | 'media';
  title: string;
  subtitle: string;
  link: string;
  coverUrl: string | null;
  src: string;
  smallSrc: string | null;
  subtitlesSrc: string | null;
  height: number | null;
  smallHeight: number | null;
}
export interface PopularTour extends Counted {
  id: string;
  title: string;
  order: number;
  link: string;
  coverUrl: string | null;
}
export interface PopularTrack extends Counted {
  playlist: string;
  id: string;
  title: string;
  artist: string;
  imageUrl: string | null;
}
export interface Popular {
  days: number;
  photo: PopularPhoto | null;
  video: PopularVideo | null;
  tour: PopularTour | null;
  track: PopularTrack | null;
  song: TopSong | null;
}

// Klub → Statisztika (GET /views/stats, admins): totals only.
export type StatsDays = 7 | 30 | 90 | 0;
export interface TopSong extends Counted {
  title: string;
  artist: string;
  link: string;
}
export interface ViewStats {
  days: StatsDays;
  since: string | null;
  // People a day (YYYY-MM-DD) - or a month (YYYY-MM) for every day.
  activity: { unit: 'day' | 'month'; points: { label: string; people: number }[] };
  people: { today: number; week: number; period: number; personDays: number; returning: number };
  // Person-days on each.
  devices: { phone: number; tablet: number; desktop: number };
  app: { days: number; people: number };
  top: {
    photo: PopularPhoto[];
    video: PopularVideo[];
    tour: PopularTour[];
    track: PopularTrack[];
    song: TopSong[];
  };
  searches: { words: string; times: number; people: number }[];
}

const SEND_AFTER_MS = 1_000;
const MAX_BATCH = 50;

// Collects what was seen and sends it a moment later (what is seen
// together goes together) - or at once, by navigator.sendBeacon, when the page
// is hidden or closed (the phone's home button, a closed tab). The server
// counts each item once a day per person anyway; what was sent today isn't
// sent again from here either.
@Injectable({ providedIn: 'root' })
export class ViewTrackerService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private readonly url = `${environment.apiBaseUrl}/views`;

  private queue: SeenItem[] = [];
  private sent = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush(true);
      // Back in the app - maybe on another day by now.
      else this.noteInstalledApp();
    });
    window.addEventListener('pagehide', () => this.flush(true));
  }

  seen(item: SeenItem) {
    if (!this.auth.isLoggedIn()) return;
    const id = `${new Date().toDateString()}\n${item.type}\n${item.key}`;
    if (this.sent.has(id)) return;
    this.sent.add(id);
    this.queue.push(item);
    if (this.queue.length >= MAX_BATCH) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), SEND_AFTER_MS);
  }

  // The installed app says it is the one in use - once a day (Klub →
  // Statisztika's share of the installed app; the server can't tell).
  private appDay = '';
  noteInstalledApp() {
    if (!this.auth.isLoggedIn() || !isInstalledApp()) return;
    const day = new Date().toDateString();
    if (this.appDay === day) return;
    this.appDay = day;
    this.http.post(`${this.url}/app`, {}).subscribe({ error: () => (this.appDay = '') });
  }

  stats(days: StatsDays): Observable<ViewStats> {
    return this.http
      .get<{ data: ViewStats }>(`${this.url}/stats?days=${days}`)
      .pipe(map((res) => res.data));
  }

  popular(): Observable<Popular> {
    return this.http.get<{ data: Popular }>(`${this.url}/popular`).pipe(map((res) => res.data));
  }

  // Sends what is waiting. `closing`: the page may be gone in a moment -
  // sendBeacon gets it out even then (as text: it can't send JSON across
  // the client's and the API's subdomains). A batch that fails is let go.
  flush(closing = false) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.queue.length) {
      const views = this.queue.splice(0, MAX_BATCH);
      const body = JSON.stringify({ views });
      if (closing && navigator.sendBeacon?.(this.url, new Blob([body], { type: 'text/plain' }))) {
        continue;
      }
      this.http.post(this.url, { views }).subscribe({ error: () => {} });
    }
  }
}
