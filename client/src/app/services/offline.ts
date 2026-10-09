import { Injectable, signal } from '@angular/core';

// The app without a connection. The service worker (src/sw.js) keeps the
// app itself and the server's last answers on the device; the songbook
// keeps its songs (services/song.ts). Here: the worker is started with the
// app, and whether there is a connection is known.
@Injectable({ providedIn: 'root' })
export class OfflineService {
  // The device says it has no connection at all. (It may say it has one
  // where nothing gets through - then the pages find out by themselves.)
  readonly isOffline = signal(typeof navigator !== 'undefined' && navigator.onLine === false);

  private started = false;

  // Called once, when the app starts.
  start() {
    if (this.started) return;
    this.started = true;
    window.addEventListener('online', () => this.isOffline.set(false));
    window.addEventListener('offline', () => this.isOffline.set(true));
    // The same worker the notifications use (services/push.ts) - registered
    // here for everyone, whether they turned notifications on or not.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Not allowed here (private mode, no https): the app works as it
        // did, only not without a connection.
      });
    }
  }
}
