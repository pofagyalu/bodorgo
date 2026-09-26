import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type PushState =
  | 'unsupported' // this browser can't do web push
  | 'needs-install' // iPhone/iPad: only from the home-screen app
  | 'denied' // the user blocked notifications for the site
  | 'off' // supported, not on for this device
  | 'on';

// Push notifications for this device (browser): turning them on/off,
// and the chat mutes. The server does the sending (see
// server/src/utils/push.js), the service worker (src/sw.js) shows them.
@Injectable({ providedIn: 'root' })
export class PushService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/push`;

  readonly state = signal<PushState>('off');

  private get supported(): boolean {
    return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  // iPhone/iPad Safari only allows web push from a site added to the home
  // screen (and opened from there).
  get isIos(): boolean {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  private get standalone(): boolean {
    return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  }

  private registration(): Promise<ServiceWorkerRegistration> {
    return navigator.serviceWorker.register('/sw.js', { scope: '/' });
  }

  async refresh(): Promise<PushState> {
    let state: PushState;
    if (!this.supported) state = this.isIos && !this.standalone ? 'needs-install' : 'unsupported';
    else if (Notification.permission === 'denied') state = 'denied';
    else {
      const sub = await (await this.registration()).pushManager.getSubscription();
      state = sub && Notification.permission === 'granted' ? 'on' : 'off';
    }
    this.state.set(state);
    return state;
  }

  // Asks the browser's permission, subscribes, and tells the server about
  // this device. Must run from a click (Safari requires it).
  async enable(): Promise<void> {
    const res = await firstValueFrom(
      this.http.get<{ data: { publicKey: string | null } }>(`${this.apiUrl}/public-key`),
    );
    const publicKey = res.data.publicKey;
    if (!publicKey) throw new Error('Az értesítések a szerveren nincsenek beállítva.');

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      await this.refresh();
      throw new Error('Az értesítések nincsenek engedélyezve ebben a böngészőben.');
    }
    const reg = await this.registration();
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(publicKey) }));
    await firstValueFrom(this.http.post(`${this.apiUrl}/subscriptions`, sub.toJSON()));
    this.state.set('on');
  }

  async disable(): Promise<void> {
    const sub = await (await this.registration()).pushManager.getSubscription();
    if (sub) {
      await firstValueFrom(this.http.request('DELETE', `${this.apiUrl}/subscriptions`, { body: { endpoint: sub.endpoint } }));
      await sub.unsubscribe();
    }
    this.state.set('off');
  }

  sendTest() {
    return this.http.post<{ data: { sent: number } }>(`${this.apiUrl}/test`, {});
  }

  getChatMuted(tourId: string) {
    return this.http.get<{ data: { muted: boolean } }>(`${this.apiUrl}/chat-mutes/${tourId}`);
  }

  setChatMuted(tourId: string, muted: boolean) {
    return this.http.put<{ data: { muted: boolean } }>(`${this.apiUrl}/chat-mutes/${tourId}`, { muted });
  }
}

// The server's VAPID public key (base64url) as the bytes subscribe() wants.
function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
