import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';

// One track of the club's playlist (see server music/jellyfin.js).
export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  durationMs: number | null;
  streamUrl: string; // relative - on our own server
  imageUrl: string | null; // the artist's photo or the album cover (relative)
}

// The playlists, by the name in their addresses (see server
// music/jellyfin.js): Bódorgó FM for everyone, Buli for members.
export type PlaylistKey = 'bodorgo-fm' | 'buli';
export const PLAYLIST_NAMES: Record<PlaylistKey, string> = {
  'bodorgo-fm': 'Bódorgó FM',
  buli: 'Buli rádió',
};

const VOLUME_KEY = 'bodorgo-music-volume';
// Until someone sets their own (remembered per device): quiet, 15%.
const DEFAULT_VOLUME = 0.15;

// The music: Jellyfin playlists, streamed through our server. App-wide
// (providedIn: 'root') with a single <audio>, so it keeps playing while
// moving between pages. One playlist plays at a time - the one started
// last ("active"); the Média → Zene pages are the full players, the
// header's (shared/music-player) the small one, for whatever is on (Bódorgó
// FM if nothing yet). Nothing plays until ▶ is clicked - that click is also
// the browser's required "user gesture". In order (or shuffled), from the
// top again after the last. Stops on logout.
@Injectable({ providedIn: 'root' })
export class MusicPlayerService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  // Each loaded playlist's tracks; the playing one's are `tracks`.
  lists = signal<Partial<Record<PlaylistKey, MusicTrack[]>>>({});
  activeKey = signal<PlaylistKey>('bodorgo-fm');
  tracks = computed(() => this.lists()[this.activeKey()] ?? []);
  index = signal(0);
  isPlaying = signal(false);
  loading = signal(false);
  error = signal<string | null>(null);
  currentTrack = computed(() => this.tracks()[this.index()] ?? null);

  // The full player's extras.
  // Random order by default - for every playlist (🔀 turns it off).
  shuffle = signal(true);
  repeatOne = signal(false);
  currentTime = signal(0); // seconds
  duration = signal(0); // seconds, 0 until known
  volume = signal(readVolume());
  muted = signal(false);

  private audio: HTMLAudioElement | null = null;
  private failures = 0; // tracks in a row that couldn't be played
  private history: number[] = []; // for ⏮ while shuffling

  // Music in one tab at a time: a tab that starts playing tells the other
  // tabs (of this site), and they pause - no two songs over each other.
  private readonly tabId = Math.random().toString(36).slice(2);
  private channel: BroadcastChannel | null =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('bodorgo-music');

  constructor() {
    // Logged out (or the session ended): silence, and forget the list.
    effect(() => {
      if (!this.auth.isLoggedIn()) this.reset();
    });
    this.channel?.addEventListener('message', (event: MessageEvent<{ playing?: string }>) => {
      if (event.data?.playing && event.data.playing !== this.tabId) this.audio?.pause();
    });
  }

  private player(): HTMLAudioElement {
    if (!this.audio) {
      const audio = new Audio();
      this.audio = audio;
      audio.preload = 'none';
      audio.volume = this.volume();
      audio.addEventListener('play', () => {
        this.isPlaying.set(true);
        this.channel?.postMessage({ playing: this.tabId });
      });
      audio.addEventListener('playing', () => (this.failures = 0));
      audio.addEventListener('pause', () => this.isPlaying.set(false));
      audio.addEventListener('timeupdate', () => this.currentTime.set(audio.currentTime));
      audio.addEventListener('durationchange', () =>
        this.duration.set(Number.isFinite(audio.duration) ? audio.duration : 0),
      );
      audio.addEventListener('ended', () => {
        if (this.repeatOne()) {
          audio.currentTime = 0;
          this.play();
        } else {
          this.next(true);
        }
      });
      // A track that can't be played: on to the next one - unless none of
      // them can (then it stops, instead of skipping round and round).
      audio.addEventListener('error', () => {
        if (!audio.getAttribute('src')) return;
        this.failures++;
        if (this.failures >= this.tracks().length) {
          this.error.set('A zene most nem játszható le.');
          this.isPlaying.set(false);
          return;
        }
        this.next(true);
      });
      this.setUpMediaSession();
    }
    return this.audio;
  }

  // A playlist's tracks, once (or again with `reload`, after an admin's
  // refresh). Loading doesn't start anything.
  async loadPlaylist(key: PlaylistKey = this.activeKey(), reload = false): Promise<boolean> {
    if (!reload && this.lists()[key]?.length) return true;
    this.loading.set(true);
    this.error.set(null);
    try {
      const url = `${environment.apiBaseUrl}/music/${key}/${reload ? 'refresh' : 'playlist'}`;
      const request = reload
        ? this.http.post<{ data: { tracks: MusicTrack[] } }>(url, {})
        : this.http.get<{ data: { tracks: MusicTrack[] } }>(url);
      const res = await new Promise<{ data: { tracks: MusicTrack[] } }>((resolve, reject) =>
        request.subscribe({ next: resolve, error: reject }),
      );
      this.lists.update((lists) => ({ ...lists, [key]: res.data.tracks }));
      if (!res.data.tracks.length) this.error.set('A lejátszási lista üres.');
      return res.data.tracks.length > 0;
    } catch {
      this.error.set('A zene most nem érhető el.');
      return false;
    } finally {
      this.loading.set(false);
    }
  }

  // ▶ on a playlist's own page: that one - switching over to it if another
  // was on (from a random song, or the first with shuffle off).
  async playPlaylist(key: PlaylistKey) {
    if (key === this.activeKey() && this.audio?.getAttribute('src')) {
      await this.toggle();
      return;
    }
    if (!(await this.loadPlaylist(key))) return;
    await this.playAt(this.startIndex(key), key);
  }

  // Where a playlist starts from scratch: a random song while shuffling.
  private startIndex(key: PlaylistKey): number {
    const count = this.lists()[key]?.length ?? 0;
    return this.shuffle() && count ? Math.floor(Math.random() * count) : 0;
  }

  // ▶ / ⏸ - the first click also loads the list.
  async toggle() {
    if (this.isPlaying()) {
      this.player().pause();
      return;
    }
    const fresh = !this.audio?.getAttribute('src');
    if (!(await this.loadPlaylist())) return;
    // Nothing played yet: a random song to start (while shuffling).
    if (fresh) this.index.set(this.startIndex(this.activeKey()));
    this.error.set(null);
    this.failures = 0;
    this.play();
  }

  // ⏹ - paused, back at the start of the track.
  stop() {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
    this.currentTime.set(0);
  }

  // A song picked from a playlist: it plays (that playlist becomes the
  // one on) - from `startAt` seconds into it, if given (the FM dial's
  // tuning knob).
  async playAt(i: number, key: PlaylistKey = this.activeKey(), startAt = 0) {
    if (!(await this.loadPlaylist(key))) return;
    if (key !== this.activeKey()) {
      this.activeKey.set(key);
      this.history = [];
    } else if (i !== this.index()) {
      this.history.push(this.index());
    }
    this.index.set(i);
    this.error.set(null);
    this.failures = 0;
    // The new song first - then the jump lands on it, not the old one.
    this.load();
    if (startAt > 0) this.startFrom(startAt);
    this.play();
  }

  // ⏭ - and at a track's end: the next one (a random other one while
  // shuffling), the first after the last. It plays on if music was on (or
  // `play`), otherwise it's just lined up.
  next(play = false) {
    const count = this.tracks().length;
    if (!count) return;
    const audio = this.audio;
    const keepPlaying = play || (!!audio && !audio.paused);
    this.history.push(this.index());
    this.index.set(this.shuffle() ? randomOther(this.index(), count) : (this.index() + 1) % count);
    this.load();
    if (keepPlaying) this.play();
  }

  // ⏮ - a few seconds into a song: back to its start; otherwise the one
  // before (while shuffling: the one played before).
  previous() {
    const count = this.tracks().length;
    if (!count) return;
    const audio = this.audio;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const keepPlaying = !!audio && !audio.paused;
    const back = this.shuffle() ? this.history.pop() : undefined;
    this.index.set(back ?? (this.index() - 1 + count) % count);
    this.load();
    if (keepPlaying) this.play();
  }

  // A song's thumbnail address (on our server), or null.
  imageSrc(track: MusicTrack | null): string | null {
    return track?.imageUrl ? `${environment.apiBaseUrl}${track.imageUrl}` : null;
  }

  // Jump to `seconds` once the new song's audio is ready (setting it
  // earlier would be ignored by some browsers).
  private startFrom(seconds: number) {
    const audio = this.player();
    const go = () => {
      audio.currentTime = seconds;
      this.currentTime.set(seconds);
    };
    if (audio.readyState >= 1) go();
    else audio.addEventListener('loadedmetadata', go, { once: true });
  }

  seek(seconds: number) {
    if (!this.audio || !this.duration()) return;
    this.audio.currentTime = Math.max(0, Math.min(seconds, this.duration()));
  }

  setVolume(value: number) {
    const v = Math.max(0, Math.min(1, value));
    this.volume.set(v);
    this.muted.set(v === 0);
    if (this.audio) {
      this.audio.volume = v;
      this.audio.muted = false;
    }
    try {
      localStorage.setItem(VOLUME_KEY, String(v));
    } catch {
      // just not remembered
    }
  }

  toggleMute() {
    const muted = !this.muted();
    this.muted.set(muted);
    if (this.audio) this.audio.muted = muted;
  }

  // Points the <audio> at the current track (if it isn't already).
  private load() {
    const track = this.currentTrack();
    if (!track) return;
    const src = `${environment.apiBaseUrl}${track.streamUrl}`;
    const audio = this.player();
    if (audio.src !== src) {
      audio.src = src;
      this.currentTime.set(0);
      this.duration.set(track.durationMs ? track.durationMs / 1000 : 0);
    }
    this.updateMediaSession();
  }

  private play() {
    this.load();
    this.player()
      .play()
      .catch(() => this.isPlaying.set(false));
  }

  private reset() {
    this.audio?.pause();
    if (this.audio) this.audio.removeAttribute('src');
    this.lists.set({});
    this.activeKey.set('bodorgo-fm');
    this.index.set(0);
    this.history = [];
    this.failures = 0;
    this.currentTime.set(0);
    this.duration.set(0);
    this.isPlaying.set(false);
  }

  // The phone's lock screen / notification: title, artist, ⏮▶⏸⏭.
  private setUpMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => void this.toggle());
    navigator.mediaSession.setActionHandler('pause', () => this.audio?.pause());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
  }

  private updateMediaSession() {
    const track = this.currentTrack();
    if (!track || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const src = this.imageSrc(track);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: PLAYLIST_NAMES[this.activeKey()],
      artwork: src ? [{ src, sizes: '320x320', type: 'image/jpeg' }] : [],
    });
  }
}

function randomOther(current: number, count: number): number {
  if (count < 2) return current;
  const pick = Math.floor(Math.random() * (count - 1));
  return pick >= current ? pick + 1 : pick;
}

// The volume last set on this device (per-browser convenience).
function readVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return localStorage.getItem(VOLUME_KEY) !== null && v >= 0 && v <= 1 ? v : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}
