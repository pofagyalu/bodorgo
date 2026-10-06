import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { NotificationsService } from '../notifications/notifications.service';

// A video's small copy (see server/src/utils/videoCopies.js): a 720p,
// lighter version an admin has the server make. Once 'ready' it is what
// plays, unless the viewer picks the original in the player.
export type SmallCopyState = 'none' | 'queued' | 'converting' | 'ready' | 'failed';

export interface SmallCopyJob {
  // "media:<category>:<id>" or "tour:<tourId>:<id>" - see media()/tour().
  ref: string;
  state: SmallCopyState;
  // While converting.
  percent?: number;
  // When it failed.
  error?: string;
}

// One video's place among the conversions: how its job is known, and the
// address its copy is made and removed at.
export interface SmallCopyTarget {
  ref: string;
  url: string;
}

const POLL_MS = 3000;

// The admins' side of the small copies: asking for one, removing it, and
// following the conversions (one at a time on the server, hours for a long
// video). What is known here overrides what the video lists said when they
// were loaded, so a page needs no reload to show a copy that got ready.
@Injectable({ providedIn: 'root' })
export class VideoCopiesService {
  private http = inject(HttpClient);
  private notifications = inject(NotificationsService);
  private api = environment.apiBaseUrl;

  // By ref - only what was asked for or removed since the server started.
  readonly jobs = signal<Record<string, SmallCopyJob>>({});
  private pollTimer?: ReturnType<typeof setTimeout>;

  media(category: string, id: string): SmallCopyTarget {
    return {
      ref: `media:${category}:${id}`,
      url: `${this.api}/media/videos/${category}/${id}/small`,
    };
  }

  tour(tourId: string, id: string): SmallCopyTarget {
    return { ref: `tour:${tourId}:${id}`, url: `${this.api}/tours/${tourId}/videos/${id}/small` };
  }

  // The video's copy as it is now: what is known here, else what its list
  // said (`listed`).
  stateOf(ref: string, listed: SmallCopyState | undefined): SmallCopyJob {
    return this.jobs()[ref] ?? { ref, state: listed ?? 'none' };
  }

  // An admin's page calls it when it opens: conversions already going
  // (started before a reload, or by another admin) are followed too.
  refresh() {
    clearTimeout(this.pollTimer);
    this.http
      .get<{ data: { jobs: SmallCopyJob[] } }>(`${this.api}/media/videos/small-copies`)
      .subscribe({
        next: (res) => {
          // What was removed here stays 'none' - the server no longer
          // lists it.
          const removed = Object.values(this.jobs()).filter((j) => j.state === 'none');
          this.jobs.set(Object.fromEntries([...removed, ...res.data.jobs].map((j) => [j.ref, j])));
          this.pollWhileActive();
        },
        error: () => this.pollWhileActive(),
      });
  }

  convert(target: SmallCopyTarget) {
    this.http.post<{ data: { job: SmallCopyJob } }>(target.url, {}).subscribe({
      next: (res) => {
        this.set(res.data.job);
        this.pollWhileActive();
      },
      error: (err) =>
        this.notifications.addError(
          err?.error?.message ?? 'Nem sikerült elindítani az átalakítást.',
        ),
    });
  }

  // Also stops a conversion that is waiting or going.
  remove(target: SmallCopyTarget) {
    this.http.delete(target.url).subscribe({
      next: () => this.set({ ref: target.ref, state: 'none' }),
      error: (err) =>
        this.notifications.addError(
          err?.error?.message ?? 'Nem sikerült törölni a kis méretű változatot.',
        ),
    });
  }

  private set(job: SmallCopyJob) {
    this.jobs.update((jobs) => ({ ...jobs, [job.ref]: job }));
  }

  private pollWhileActive() {
    clearTimeout(this.pollTimer);
    const active = Object.values(this.jobs()).some(
      (j) => j.state === 'queued' || j.state === 'converting',
    );
    if (active) this.pollTimer = setTimeout(() => this.refresh(), POLL_MS);
  }
}
