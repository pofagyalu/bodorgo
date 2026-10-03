import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { map } from 'rxjs';
import { Song, SongService } from '../../../services/song';
import { NotificationsService } from '../../../notifications/notifications.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { SongSheet } from '../song-sheet/song-sheet';
import { Instrument } from '../chord-shapes';
import { NOTATION, firstChord, stepsBetween, transposeChordPro } from '../chords';
import { keyName, songKey, transposeKey } from '../song-key';
import { Metronome } from '../tempo';

// The play button's paces, in rem per second at the normal letter size
// (they grow with the letters): ▶, ▶▶, ▶▶▶.
const PACES = [0, 0.6, 1.05, 1.7];
const COUNTDOWN_FROM = 3;
// After a finger (or the wheel) moved the page: how long before the
// scrolling goes on.
const HOLD_MS = 1200;

const FONT_STEPS = [0.85, 1, 1.15, 1.3, 1.5, 1.75];
const FONT_KEY = 'daloskonyv-font';
const DIAGRAMS_KEY = 'daloskonyv-diagrams';
// The pace each song was last played at, by its slug.
const PACE_KEY = 'daloskonyv-pace';
// The screens where an open song takes the song list's place
// (daloskonyv.scss hides the list at this width).
const LIST_HIDDEN = '(max-width: 900px)';

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode, full storage: the setting just isn't remembered.
  }
}

// One song of the Daloskönyv: the lyrics with each chord over its
// syllable, the letter size, transposing (on the screen only), and the
// play button that scrolls the page for whoever's hands are on a guitar.
@Component({
  selector: 'app-song',
  imports: [RouterLink, MatIconModule, SongSheet],
  templateUrl: './song.html',
  styleUrl: './song.scss',
})
export class SongPage implements OnDestroy {
  private songService = inject(SongService);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);
  private router = inject(Router);
  private host: ElementRef<HTMLElement> = inject(ElementRef);
  private slug = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('slug') ?? '')), {
    initialValue: '',
  });

  private sheet = viewChild<ElementRef<HTMLElement>>('sheet');

  song = signal<Song | null>(null);
  canEdit = this.songService.canEdit;
  base = this.songService.base;
  search = this.songService.search;
  // Whose chord diagrams - chosen on the songbook's main page.
  instrument = this.songService.instrument;
  // The strip of the song's chords under its title.
  showDiagrams = signal(stored(DIAGRAMS_KEY, true));
  notFound = signal(false);

  // Played tonight: the tick this song carries in the list (set here by
  // hand, or by the play button reaching the song's end).
  isPlayed = computed(() => {
    const song = this.song();
    return !!song && this.songService.played().has(song._id);
  });

  togglePlayed() {
    const song = this.song();
    if (song) this.songService.setPlayed(song._id, !this.isPlayed());
  }

  // --- How it's shown ---

  fontStep = signal(
    Math.min(Math.max(Math.round(+stored(FONT_KEY, 1)) || 0, 0), FONT_STEPS.length - 1),
  );
  fontScale = computed(() => FONT_STEPS[this.fontStep()]);
  // Semitones up (+) or down (-); back to 0 with every song.
  transpose = signal(0);
  transposeLabel = computed(() => {
    const t = this.transpose();
    return t > 0 ? `+${t}` : `${t}`;
  });

  // The neighbours in the book.
  private index = computed(() => {
    const songs = this.songService.songs() ?? [];
    return songs.findIndex((s) => s.slug === this.slug());
  });
  previous = computed(() => (this.songService.songs() ?? [])[this.index() - 1] ?? null);
  next = computed(() => {
    const i = this.index();
    return i < 0 ? null : ((this.songService.songs() ?? [])[i + 1] ?? null);
  });

  // --- Play: the page scrolls by itself ---

  // 0: stopped; 1-3: ▶, ▶▶, ▶▶▶.
  pace = signal(0);
  // Seconds left before it starts moving (hands to the guitar).
  countdown = signal(0);
  // Longer than the screen - otherwise there is nothing to scroll.
  scrollable = signal(false);
  arrows = computed(() => Array.from({ length: Math.max(this.pace(), 1) }));
  playLabel = computed(() =>
    this.pace() ? 'Gyorsabb görgetés' : 'Lejátszás: a dal magától görög',
  );

  private scroller: HTMLElement | null = null;
  private frame = 0;
  private countdownTimer: ReturnType<typeof setInterval> | undefined;
  private lastTime = 0;
  // Where the page should be - scrollTop itself may round.
  private position = 0;
  private touching = false;
  private holdUntil = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private resizeObserver = new ResizeObserver(() => this.measure());

  private onTouchStart = (e: Event) => {
    // The play buttons themselves don't hold the scrolling back.
    if ((e.target as HTMLElement).closest?.('.play-bar')) return;
    this.touching = true;
  };
  private onTouchEnd = () => {
    this.touching = false;
    this.holdUntil = performance.now() + HOLD_MS;
  };
  private onWheel = () => {
    this.holdUntil = performance.now() + HOLD_MS;
  };
  private onVisible = () => {
    if (document.visibilityState === 'visible' && this.pace()) void this.keepAwake();
  };

  constructor() {
    // A new address: that song, from its top, stopped.
    effect(() => {
      const slug = this.slug();
      this.stop();
      this.stopMetronome();
      this.transpose.set(0);
      this.song.set(null);
      this.notFound.set(false);
      if (!slug) return;
      this.songService.getSong(slug).subscribe({
        next: (song) => {
          if (slug !== this.slug()) return;
          this.song.set(song);
          this.scrollerElement()?.scrollTo({ top: 0 });
        },
        error: () => this.notFound.set(true),
      });
    });

    // The sheet's height changes with the song, the letters, the chords.
    effect(() => {
      const sheet = this.sheet()?.nativeElement;
      this.resizeObserver.disconnect();
      if (sheet) this.resizeObserver.observe(sheet);
    });

    document.addEventListener('visibilitychange', this.onVisible);
  }

  ngOnDestroy() {
    this.stop();
    this.stopMetronome();
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  // What scrolls under the song: on a phone the song's own page, laid over
  // the whole screen (song.scss); on a wide screen the pane it is in (the
  // contents stay beside it - daloskonyv.scss); otherwise the page, which
  // is app.component's .page-body, not the window.
  private scrollerElement(): HTMLElement | null {
    const page = this.host.nativeElement.querySelector<HTMLElement>('.song-page');
    if (page && getComputedStyle(page).position === 'fixed') return page;
    const pane = this.host.nativeElement.closest<HTMLElement>('.song-pane');
    return pane && getComputedStyle(pane).overflowY === 'auto'
      ? pane
      : this.host.nativeElement.closest<HTMLElement>('.page-body');
  }

  private measure() {
    const el = this.scrollerElement();
    this.scrollable.set(!!el && el.scrollHeight > el.clientHeight + 24);
  }

  changeFont(by: number) {
    const step = Math.min(Math.max(this.fontStep() + by, 0), FONT_STEPS.length - 1);
    this.fontStep.set(step);
    store(FONT_KEY, step);
  }

  chooseInstrument(instrument: Instrument) {
    this.songService.setInstrument(instrument);
  }

  toggleDiagrams() {
    this.showDiagrams.update((on) => !on);
    store(DIAGRAMS_KEY, this.showDiagrams());
  }

  // This song alone as a PDF - the way it is on the screen now: in the key
  // it is transposed to, with the chosen instrument's chords over it if
  // they are shown.
  pdfUrl = computed(() => {
    const song = this.song();
    return song
      ? this.songService.songPdfUrl(
          song.slug,
          this.showDiagrams() ? this.instrument() : 'none',
          this.transpose(),
        )
      : null;
  });

  changeTranspose(by: number) {
    // Twelve semitones is the same chords again.
    this.transpose.update((t) => (t + by) % 12);
  }

  // The song's key - the one set by hand, or what its chords say -, moved
  // with the transposing on the screen: "a-moll" ('' for a song without
  // chords). Shown after the artist.
  private homeChord = computed(() => {
    const song = this.song();
    return song ? songKey(song) : '';
  });
  keyLabel = computed(() => {
    const home = this.homeChord();
    return home ? keyName(transposeKey(home, this.transpose())) : '';
  });
  // Set by hand in the editor, not worked out.
  keySetByHand = computed(() => !!this.song()?.key);

  // A tap on the artist's name: the song list narrowed to that artist's
  // songs (an earlier search would only hide some of them). Where the list
  // stands beside the song it narrows there; where the song has taken its
  // place (a phone), back to the list.
  showArtist(artist: string) {
    this.songService.search.set('');
    this.songService.artist.set(artist.trim());
    if (window.matchMedia?.(LIST_HIDDEN).matches) {
      void this.router.navigate([this.songService.base()]);
    }
  }

  // --- The metronome: tapped, the tempo's tag blinks the song's tempo for
  // a few bars - or until it is tapped again (tempo.ts) ---

  private metronome = new Metronome();
  beating = signal(false);
  // On for a moment at every beat - the tempo's tag blinks with it.
  beatOn = signal(false);
  private beatOff: ReturnType<typeof setTimeout> | null = null;

  toggleMetronome() {
    const tempo = this.song()?.tempo;
    if (this.beating() || !tempo) {
      this.stopMetronome();
      return;
    }
    this.beating.set(true);
    this.metronome.start(
      tempo,
      () => {
        this.beatOn.set(true);
        if (this.beatOff) clearTimeout(this.beatOff);
        this.beatOff = setTimeout(() => this.beatOn.set(false), 110);
      },
      () => this.stopMetronome(),
    );
  }

  private stopMetronome() {
    this.metronome.stop();
    if (this.beatOff) clearTimeout(this.beatOff);
    this.beatOff = null;
    this.beating.set(false);
    this.beatOn.set(false);
  }

  // The key the song was first written in, while it is saved in another
  // one: its first chord then ("am"), and how many semitones from the
  // saved key lead back to it - null if it never moved (or is back).
  originalKey = computed(() => {
    const song = this.song();
    const now = song ? firstChord(song.chordpro) : undefined;
    if (!song?.originalKey || !now) return null;
    const steps = stepsBetween(now, song.originalKey);
    return steps ? { chord: song.originalKey, steps } : null;
  });

  // A look at the song in its old key - on the screen only.
  showOriginalKey() {
    const original = this.originalKey();
    if (original) this.transpose.set(original.steps);
  }

  // Keeping the key tried on the screen (the songbook's owner only): the
  // song's chords are rewritten as they show now and the song is saved -
  // from then on this is its key, for everyone and in the PDF.
  savingKey = signal(false);

  async saveTransposed() {
    const song = this.song();
    const steps = this.transpose();
    if (!song || !steps || this.savingKey()) return;
    const ok = await this.confirm.ask({
      title: 'Mentés ebben a hangnemben',
      message: `A dal akkordjai ezentúl így lesznek elmentve (${this.transposeLabel()} félhang).`,
      detail: 'Mindenkinek így jelenik meg, és a PDF-be is így kerül.',
      confirmText: 'Mentés',
      danger: false,
    });
    if (!ok) return;
    this.savingKey.set(true);
    this.songService
      .updateSong(song._id, {
        // The very chords on the screen: spelled for the song's key.
        chordpro: transposeChordPro(song.chordpro, steps, NOTATION, this.homeChord()),
        // What it started with is noted the first time it is moved.
        originalKey: song.originalKey || firstChord(song.chordpro) || '',
        // A key set by hand moves with the song; otherwise the new chords
        // say the new key.
        key: song.key ? transposeKey(song.key, steps) : '',
      })
      .subscribe({
        next: (saved) => {
          // The same song, if nobody moved on to another meanwhile.
          if (this.song()?._id === saved._id) {
            this.song.set(saved);
            this.transpose.set(0);
          }
          this.savingKey.set(false);
          this.notifications.addSuccess('A dal ebben a hangnemben elmentve.');
        },
        error: (err) => {
          this.savingKey.set(false);
          this.notifications.addError(err?.error?.message ?? 'A dalt nem sikerült elmenteni.');
        },
      });
  }

  // The round button: starts the scrolling (at this song's last pace, after
  // a short countdown); while it runs, every tap is a pace faster, and
  // after the fastest the slowest again.
  play() {
    const slug = this.slug();
    const paces = stored<Record<string, number>>(PACE_KEY, {});
    if (this.pace()) {
      this.pace.update((p) => (p % (PACES.length - 1)) + 1);
      store(PACE_KEY, { ...paces, [slug]: this.pace() });
      return;
    }
    const el = this.scrollerElement();
    if (!el) return;
    this.scroller = el;
    const saved = paces[slug];
    this.pace.set(saved >= 1 && saved < PACES.length ? saved : 1);
    void this.keepAwake();
    el.addEventListener('touchstart', this.onTouchStart, { passive: true });
    el.addEventListener('touchend', this.onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', this.onTouchEnd, { passive: true });
    el.addEventListener('wheel', this.onWheel, { passive: true });

    this.countdown.set(COUNTDOWN_FROM);
    this.countdownTimer = setInterval(() => {
      this.countdown.update((n) => n - 1);
      if (this.countdown() > 0) return;
      clearInterval(this.countdownTimer);
      this.position = el.scrollTop;
      this.lastTime = 0;
      this.holdUntil = 0;
      this.frame = requestAnimationFrame(this.step);
    }, 1000);
  }

  stop() {
    clearInterval(this.countdownTimer);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.touching = false;
    this.countdown.set(0);
    this.pace.set(0);
    const el = this.scroller;
    el?.removeEventListener('touchstart', this.onTouchStart);
    el?.removeEventListener('touchend', this.onTouchEnd);
    el?.removeEventListener('touchcancel', this.onTouchEnd);
    el?.removeEventListener('wheel', this.onWheel);
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }

  private step = (now: number) => {
    const el = this.scroller;
    if (!el || !this.pace()) return;
    const waiting = this.touching || now < this.holdUntil;
    if (waiting || !this.lastTime) {
      // Go on from wherever a finger left the page.
      this.position = el.scrollTop;
    } else {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const speed = PACES[this.pace()] * rem * this.fontScale();
      // A long gap (the tab was in the background) isn't jumped over.
      this.position += speed * Math.min((now - this.lastTime) / 1000, 0.1);
      el.scrollTop = this.position;
      // The end of the song: it was played.
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
        const song = this.song();
        if (song) this.songService.setPlayed(song._id, true);
        this.stop();
        return;
      }
    }
    this.lastTime = now;
    this.frame = requestAnimationFrame(this.step);
  };

  // The screen stays on while the song plays (where the browser can).
  private async keepAwake() {
    try {
      this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
      if (!this.pace()) {
        void this.wakeLock?.release().catch(() => {});
        this.wakeLock = null;
      }
    } catch {
      // Not allowed (battery saver...): it scrolls all the same.
    }
  }
}
