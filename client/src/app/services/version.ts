import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NavigationStart, Router } from '@angular/router';
import { environment } from '../../environments/environment';

// A build's version: the commit it was built from (its first seven
// digits) and that commit's date - `version` is the two together,
// "2026.10.01 · adc1c34" (a + after it: built with uncommitted changes).
export interface BuildVersion {
  version: string;
  commit: string | null;
  date: string | null;
  builtAt: string | null;
}

// Written into a deployed build by deploy-build.js (ng build --define);
// not there under `ng serve` or a plain `ng build`.
declare const BODORGO_BUILD: BuildVersion | undefined;

// This client's own version - null when it isn't a deployed build.
export const CLIENT_BUILD: BuildVersion | null =
  typeof BODORGO_BUILD !== 'undefined' ? BODORGO_BUILD : null;

// As shown on screen.
export const CLIENT_VERSION = CLIENT_BUILD?.version ?? 'fejlesztői';

// How often an open app asks whether a newer version is out.
const CHECK_EVERY_MS = 30 * 60 * 1000;

// The versions, and the app refreshing itself once a newer client has been
// deployed: an open app (the installed one stays open for days) compares
// its own version with version.json beside it - when it comes back to the
// foreground and every half hour. Once they differ it reloads, but only
// when there's nothing to lose: on coming back to the foreground with
// nothing typed anywhere, or at the next move to another page (which then
// loads from the server instead of switching inside the old app).
@Injectable({ providedIn: 'root' })
export class VersionService {
  private http = inject(HttpClient);
  private router = inject(Router);

  private newerIsOut = false;
  private watching = false;

  // The server's version (anyone logged in may ask).
  getServerVersion() {
    return this.http.get<{ status: string; data: BuildVersion }>(
      `${environment.apiBaseUrl}/health/version`,
    );
  }

  // Called once, when the app starts.
  watchForNewVersion() {
    if (!CLIENT_BUILD || this.watching) return;
    this.watching = true;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.check(true);
    });
    setInterval(() => void this.check(false), CHECK_EVERY_MS);

    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart && this.newerIsOut) {
        // The page they asked for, in the new version.
        window.location.assign(event.url);
      }
    });
  }

  private async check(cameBack: boolean) {
    if (!this.newerIsOut) {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const latest = (await res.json()) as BuildVersion;
        this.newerIsOut = !!latest.version && latest.version !== CLIENT_BUILD?.version;
      } catch {
        return; // offline, or between two deploys - next time
      }
    }
    if (this.newerIsOut && cameBack && !somethingTyped()) window.location.reload();
  }
}

// Text someone has typed and not sent yet (a chat message, a form) - a
// reload would lose it.
function somethingTyped(): boolean {
  const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'textarea, input[type="text"], input:not([type])',
  );
  for (const field of fields) if (field.value.trim()) return true;
  for (const editor of document.querySelectorAll<HTMLElement>('[contenteditable="true"]')) {
    if (editor.textContent?.trim()) return true;
  }
  return false;
}
