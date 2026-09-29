import {
  Directive,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { AuthService } from '../../../auth/auth.service';
import { NotificationsService } from '../../../notifications/notifications.service';
import { MusicPlayerService, PlaylistKey } from '../../../services/music-player';

// What a playlist's own page (Bódorgó FM, Buli) needs, whatever it looks
// like: this playlist's tracks, and - only while it's the one on - what's
// playing and where. ▶ here starts this list (switching over from the other
// one); picking a song plays it from this list. Admins can reload the list
// from Jellyfin. The playing itself is MusicPlayerService.
@Directive()
export abstract class PlaylistPage implements OnInit {
  abstract readonly key: PlaylistKey;

  music = inject(MusicPlayerService);
  private auth = inject(AuthService);
  private notifications = inject(NotificationsService);
  private list = viewChild<ElementRef<HTMLElement>>('list');

  tracks = computed(() => this.music.lists()[this.key] ?? []);
  // This list is the one on (playing or paused).
  active = computed(() => this.music.activeKey() === this.key);
  playing = computed(() => this.active() && this.music.isPlaying());
  now = computed(() => (this.active() ? this.music.currentTrack() : null));
  currentIndex = computed(() => (this.active() ? this.music.index() : -1));
  position = computed(() => (this.active() ? this.music.currentTime() : 0));
  length = computed(() => (this.active() ? this.music.duration() : 0));
  // "kb. 2 óra 10 perc" in all.
  totalMinutes = computed(() =>
    Math.round(this.tracks().reduce((sum, t) => sum + (t.durationMs ?? 0), 0) / 60000),
  );

  isAdmin = computed(() => this.auth.user()?.role === 'admin');
  refreshing = signal(false);

  constructor() {
    // The playing song kept in view in the list.
    effect(() => {
      const i = this.currentIndex();
      this.tracks();
      if (i < 0) return;
      queueMicrotask(() =>
        this.list()
          ?.nativeElement.querySelector(`[data-index="${i}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      );
    });
  }

  ngOnInit() {
    void this.music.loadPlaylist(this.key);
  }

  playPause() {
    void this.music.playPlaylist(this.key);
  }

  pick(i: number) {
    void this.music.playAt(i, this.key);
  }

  // ⏮ ⏹ ⏭ act on this list only while it's the one on; otherwise they start
  // it.
  next() {
    if (this.active()) this.music.next();
    else this.playPause();
  }

  previous() {
    if (this.active()) this.music.previous();
    else this.playPause();
  }

  stop() {
    if (this.active()) this.music.stop();
  }

  // Admins: reload the list from Jellyfin now (otherwise every 12 hours).
  async refresh() {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    const ok = await this.music.loadPlaylist(this.key, true);
    this.refreshing.set(false);
    if (ok) this.notifications.addSuccess(`Lista frissítve: ${this.tracks().length} dal.`);
    else this.notifications.addError('Nem sikerült frissíteni a listát.');
  }

  // "2:36" (or "1:02:05").
  time(seconds: number | null | undefined): string {
    if (!seconds || !Number.isFinite(seconds)) return '0:00';
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }

  // "kb. 2 óra 10 perc" / "kb. 45 perc"
  totalLabel(): string {
    const m = this.totalMinutes();
    if (!m) return '';
    const h = Math.floor(m / 60);
    return h ? `kb. ${h} óra ${m % 60} perc` : `kb. ${m} perc`;
  }

  onSeek(event: Event) {
    if (this.active()) this.music.seek(Number((event.target as HTMLInputElement).value));
  }

  onVolume(event: Event) {
    this.music.setVolume(Number((event.target as HTMLInputElement).value));
  }
}
