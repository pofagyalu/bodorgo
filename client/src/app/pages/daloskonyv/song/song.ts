import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  untracked,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { map } from 'rxjs';
import { Song, SongListItem, SongService } from '../../../services/song';
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
// A finger's sideways stroke across the song (the swipe* methods). It is
// one once it has gone this far, clearly more sideways than up or down...
const SWIPE_START_PX = 12;
// ...and on letting go it turns the page if the sheet was pulled this far
// (or a third of its width, if that is less), or flicked: this far at
// least, within this time.
const SWIPE_FAR_PX = 110;
const SWIPE_FLICK_PX = 40;
const SWIPE_FLICK_MS = 300;
// Pulled towards a side where there is no song, the sheet follows only
// this much of the finger's way.
const SWIPE_RESIST = 0.3;

// Saved in another key than it was first written in: that key, and how
// many semitones it is from the one the song is in now - null otherwise.
function originalKeyOf(song: Song | null) {
  const now = song ? firstChord(song.chordpro) : undefined;
  if (!song?.originalKey || !now) return null;
  const steps = stepsBetween(now, song.originalKey);
  return steps ? { chord: song.originalKey, steps } : null;
}

// Whether a page's turning can be shown: not where animations are turned
// off on the device.
const canAnimate = (el: HTMLElement) =>
  typeof el.animate === 'function' &&
  !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Whether the touched element, or one around it up to the song's sheet,
// scrolls sideways by itself.
function scrollsSideways(el: HTMLElement | null, within: EventTarget | null) {
  for (; el && el !== within; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const overflow = getComputedStyle(el).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') return true;
    }
  }
  return false;
}

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
  // The sheet and, beside it while the page is turned, the other song's
  // (the peek): the two move together.
  private track = viewChild<ElementRef<HTMLElement>>('track');
  private peekSheet = viewChild<ElementRef<HTMLElement>>('peekSheet');
  private injector = inject(Injector);
  private changes = inject(ChangeDetectorRef);

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

  // The songs in the order they are played: the chosen playlist's, or the
  // whole book's. An open song that isn't in the playlist has no
  // neighbours there - the book's own order serves it then.
  private order = computed(() => {
    const played = this.songService.playOrder() ?? [];
    return played.some((s) => s.slug === this.slug()) ? played : (this.songService.songs() ?? []);
  });
  // The neighbours in that order.
  private index = computed(() => this.order().findIndex((s) => s.slug === this.slug()));
  previous = computed(() => this.order()[this.index() - 1] ?? null);
  next = computed(() => {
    const i = this.index();
    return i < 0 ? null : (this.order()[i + 1] ?? null);
  });

  // Turning the page - by a finger drawn sideways across the song (to the
  // left the next one, to the right the one before); the two links at the
  // song's foot and the list just show the song. The other song's sheet (the peek) stands beside the
  // open one, on the side it comes from, and the two move together like
  // pages in a row: under the finger while it pulls, then on by themselves
  // until the other song is where the open one was - there it becomes the
  // open song. Let go too early, they go back. Scrolling the song, pinching
  // it bigger or pressing a word is none of this (song.scss leaves the up
  // and down strokes to the browser: touch-action).

  // The other song's sheet while the page is turned: on which side (1: to
  // the right - the next song), how far down (level with what is seen of
  // the open one), and the song itself once it is here - its title and
  // artist are known from the list before that.
  peek = signal<{
    slug: string;
    side: 1 | -1;
    top: number;
    title: string;
    artist: string;
    song: Song | null;
  } | null>(null);

  private swipe: {
    x: number;
    y: number;
    at: number;
    mode: '' | 'drag' | 'scroll';
    dx: number;
  } | null = null;
  // How far the sheets were pulled when the page was turned - they go on
  // from there.
  private pulled = 0;

  swipeStart(e: TouchEvent) {
    const touch = e.touches[0];
    // Two fingers are a pinch; something that scrolls sideways itself (a
    // wide chord line) keeps its own stroke. Not while a page is turning.
    this.swipe =
      e.touches.length === 1 &&
      !this.arriving &&
      !scrollsSideways(e.target as HTMLElement, e.currentTarget)
        ? { x: touch.clientX, y: touch.clientY, at: e.timeStamp, mode: '', dx: 0 }
        : null;
  }

  swipeMove(e: TouchEvent) {
    const swipe = this.swipe;
    if (!swipe || swipe.mode === 'scroll') return;
    if (e.touches.length !== 1) return this.swipeCancel();
    const dx = e.touches[0].clientX - swipe.x;
    const dy = e.touches[0].clientY - swipe.y;
    if (!swipe.mode) {
      if (Math.abs(dx) > SWIPE_START_PX && Math.abs(dx) > 1.5 * Math.abs(dy)) swipe.mode = 'drag';
      else if (Math.abs(dy) > SWIPE_START_PX) swipe.mode = 'scroll';
      if (swipe.mode !== 'drag') return;
    }
    const to = dx < 0 ? this.next() : this.previous();
    swipe.dx = to ? dx : dx * SWIPE_RESIST;
    const track = this.track()?.nativeElement;
    if (!track) return;
    this.clipSides(true);
    this.showPeek(to, dx < 0 ? 1 : -1);
    track.style.transform = `translateX(${swipe.dx}px)`;
  }

  swipeEnd(e: TouchEvent) {
    const swipe = this.swipe;
    this.swipe = null;
    if (swipe?.mode !== 'drag') return;
    const track = this.track()?.nativeElement;
    const to = swipe.dx < 0 ? this.next() : this.previous();
    const far = Math.abs(swipe.dx) > Math.min(SWIPE_FAR_PX, (track?.offsetWidth || 400) / 3);
    const flicked = Math.abs(swipe.dx) > SWIPE_FLICK_PX && e.timeStamp - swipe.at < SWIPE_FLICK_MS;
    if (to && (far || flicked)) {
      this.pulled = swipe.dx;
      void this.router.navigate([this.base(), to.slug]);
    } else {
      this.settle(swipe.dx);
    }
  }

  swipeCancel() {
    const swipe = this.swipe;
    this.swipe = null;
    if (swipe?.mode === 'drag') this.settle(swipe.dx);
  }

  // The other song's sheet beside the open one - none towards a side with
  // no song.
  private showPeek(to: SongListItem | null, side: 1 | -1) {
    const now = this.peek();
    if (!to) {
      if (now) this.peek.set(null);
      return;
    }
    if (now?.slug === to.slug && now.side === side) return;
    this.peek.set({
      slug: to.slug,
      side,
      // Level with the top of what is seen: where the open song's own top
      // is once the page is at its top again.
      top: this.scrollerElement()?.scrollTop ?? 0,
      title: to.title,
      artist: to.artist ?? '',
      song: this.fetched.get(to.slug) ?? null,
    });
  }

  // Let go too early: the sheets go back to their place.
  private settle(from: number) {
    const track = this.track()?.nativeElement;
    if (!track) return;
    track.style.transform = '';
    const done = () => {
      if (this.arriving || this.swipe) return;
      this.peek.set(null);
      this.clipSides(false);
    };
    if (!canAnimate(track)) return done();
    track
      .animate([{ transform: `translateX(${from}px)` }, { transform: 'none' }], {
        duration: 200,
        easing: 'ease-out',
      })
      .finished.then(done, done);
  }

  // While the sheets are off their place nothing may stick out sideways
  // (and bring a scrollbar): what scrolls the song cuts it off.
  private clipped: HTMLElement | null = null;

  private clipSides(on: boolean) {
    if (on && !this.clipped) {
      this.clipped = this.scrollerElement() ?? this.host.nativeElement;
      this.clipped.style.overflowX = 'hidden';
    } else if (!on && this.clipped) {
      this.clipped.style.overflowX = '';
      this.clipped = null;
    }
  }

  // The page being turned: the two sheets on their way, until the other
  // song's stands where the open one was (the promise). From where a
  // finger left them.
  private arriving: Promise<void> | null = null;

  private turnPage(track: HTMLElement, to: SongListItem, side: 1 | -1): Promise<void> {
    const from = this.pulled;
    this.pulled = 0;
    this.clipSides(true);
    this.showPeek(to, side);
    const arriving = new Promise<void>((resolve) => {
      // Once the peek is on the page: how far it is says how far to go.
      afterNextRender(
        () => {
          const peek = this.peekSheet()?.nativeElement;
          const to = peek ? -peek.offsetLeft : -side * track.offsetWidth;
          // Kept there until the other song is the open one (endTurn).
          track.style.transform = `translateX(${to}px)`;
          track
            .animate(
              [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }],
              { duration: from ? 220 : 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
            )
            .finished.then(
              () => resolve(),
              () => resolve(),
            );
        },
        { injector: this.injector },
      );
    });
    this.arriving = arriving;
    return arriving;
  }

  // The other song is the open one now: the sheets are as they always
  // stand, at the song's top - in the same instant, so nothing is seen of
  // it but the song staying where it arrived.
  private endTurn() {
    this.arriving = null;
    this.peek.set(null);
    this.changes.detectChanges();
    const track = this.track()?.nativeElement;
    if (track) track.style.transform = '';
    this.scrollerElement()?.scrollTo({ top: 0 });
    if (!this.swipe) this.clipSides(false);
  }

  // The songs already fetched while this page is open - the open one's
  // neighbours ahead of time (see the constructor), so turning to one
  // doesn't wait for the server.
  private fetched = new Map<string, Song>();
  private fetching = new Set<string>();
  // Counts the turns: an answer that arrives for an earlier one is dropped.
  private turn = 0;

  // A song picked by chance, for when nobody knows what to play next: any
  // song of the chosen playlist (of the whole book without one) but this
  // one and the ones played tonight (their ticks) - so an evening doesn't
  // land on the same song twice.
  private randomPool = computed(() => {
    const played = this.songService.played();
    return (this.songService.playOrder() ?? []).filter(
      (s) => s.slug !== this.slug() && !played.has(s._id),
    );
  });
  canPickRandom = computed(() => this.randomPool().length > 0);

  randomSong() {
    const pool = this.randomPool();
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    // Any song of the play order: whatever else the list was narrowed to
    // (a search, one artist) is let go, so the pick is seen in the list as
    // well. The chosen playlist stays.
    this.songService.search.set('');
    this.songService.artist.set('');
    void this.router.navigate([this.base(), pick.slug]);
  }

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
  // The open song's place in the order: where the next one is from it says
  // which way the page turns.
  private shownIndex = -1;
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
    // A new address: that song, from its top, stopped. From another song
    // the page is turned (turnPage): the open one stays until the new one
    // is here - no empty page in between.
    effect(() => {
      const slug = this.slug();
      const index = untracked(() => this.index());
      const side = this.shownIndex >= 0 && index >= 0 ? Math.sign(index - this.shownIndex) : 0;
      this.shownIndex = index;
      this.stop();
      this.stopMetronome();
      this.transpose.set(0);
      this.notFound.set(false);
      const turn = ++this.turn;
      const open = untracked(() => this.song());
      const track = open ? untracked(() => this.track())?.nativeElement : undefined;
      if (!track || !slug) this.song.set(null);
      if (!slug) return;

      // Turned like a page when it is known which way (the song's place in
      // the order) and nothing else is on its way; otherwise the new song
      // simply takes the open one's place. Only after a finger's stroke: a
      // click or a tap (the list, the links at the song's foot) just shows
      // the song.
      const to = untracked(() => this.order())[index];
      const midTurn = !!this.arriving;
      const paged = !!this.pulled;
      let arrived: Promise<void> | null = null;
      if (track && to && side && !midTurn && paged && canAnimate(track)) {
        arrived = this.turnPage(track, to, side > 0 ? 1 : -1);
      } else if (track) {
        this.pulled = 0;
        for (const moving of track.getAnimations?.() ?? []) moving.cancel();
        track.style.transform = '';
        this.peek.set(null);
        this.arriving = null;
        this.clipSides(false);
      }

      const show = (song: Song) => {
        if (turn !== this.turn) return;
        // On its way already: seen in the peek as soon as it is here.
        if (arrived && this.peek()?.slug === slug && !this.peek()?.song) {
          this.peek.update((p) => p && { ...p, song });
        }
        const put = () => {
          if (turn !== this.turn) return;
          const same = untracked(() => this.song())?._id === song._id;
          this.song.set(song);
          if (same) return;
          if (arrived) this.endTurn();
          else this.scrollerElement()?.scrollTo({ top: 0 });
        };
        if (arrived) void arrived.then(put);
        else put();
      };
      // Fetched ahead: shown at once - and asked for again all the same, in
      // case it has changed since.
      const ready = this.fetched.get(slug);
      if (ready) show(ready);
      this.songService.getSong(slug).subscribe({
        next: (song) => {
          this.fetched.set(slug, song);
          show(song);
        },
        error: () => {
          if (turn !== this.turn || ready) return;
          if (track) track.style.transform = '';
          this.arriving = null;
          this.peek.set(null);
          this.clipSides(false);
          this.song.set(null);
          this.notFound.set(true);
        },
      });
    });

    // The open song's neighbours are fetched ahead, so turning to one is
    // immediate.
    effect(() => {
      if (!this.song()) return;
      for (const near of [this.next(), this.previous()]) {
        const slug = near?.slug;
        if (!slug || this.fetched.has(slug) || this.fetching.has(slug)) continue;
        this.fetching.add(slug);
        this.songService.getSong(slug).subscribe({
          next: (song) => {
            this.fetched.set(slug, song);
            // Pulled towards it already: seen in the peek from now.
            if (this.peek()?.slug === slug) this.peek.update((p) => p && { ...p, song });
          },
          error: () => this.fetching.delete(slug),
          complete: () => this.fetching.delete(slug),
        });
      }
    });

    // The sheet's height changes with the song, the letters, the chords.
    effect(() => {
      const sheet = this.sheet()?.nativeElement;
      this.resizeObserver.disconnect();
      if (sheet) this.resizeObserver.observe(sheet);
    });

    // A finger on the sheet (the swipe* methods above) - listened to
    // directly, and without holding the page's own scrolling back.
    effect((onCleanup) => {
      const sheet = this.sheet()?.nativeElement;
      if (!sheet) return;
      const listeners: [string, (e: TouchEvent) => void][] = [
        ['touchstart', (e) => this.swipeStart(e)],
        ['touchmove', (e) => this.swipeMove(e)],
        ['touchend', (e) => this.swipeEnd(e)],
        ['touchcancel', () => this.swipeCancel()],
      ];
      for (const [type, listener] of listeners) {
        sheet.addEventListener(type, listener as EventListener, { passive: true });
      }
      onCleanup(() => {
        for (const [type, listener] of listeners) {
          sheet.removeEventListener(type, listener as EventListener);
        }
      });
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
  originalKey = computed(() => originalKeyOf(this.song()));

  // The other song's head while the page is turned (the peek): the same
  // tags the open song's head has, so nothing moves when it becomes the
  // open one - its key (untransposed, as every song starts), whether it
  // was played tonight, the key it was first written in.
  peekKey = (song: Song) => {
    const home = songKey(song);
    return home ? keyName(home) : '';
  };
  peekPlayed = (song: Song) => this.songService.played().has(song._id);
  peekOriginalKey = originalKeyOf;

  // A look at the song in its old key - on the screen only.
  showOriginalKey() {
    const original = this.originalKey();
    if (original) this.transpose.set(original.steps);
  }

  // Keeping the key tried on the screen (the songbook's owner only): the
  // song's chords are rewritten as they show now and the song is saved -
  // from then on this is its key, for everyone and in the PDF.
  savingKey = signal(false);

  // --- My playlists: this song into one, or out of it ---

  lists = this.songService.lists;
  // The panel with every list, each ticked if this song is in it.
  listsOpen = signal(false);
  // A phone keeps the song's tools behind one button: open, they drop down
  // over the song. One panel at a time: theirs or the playlists'.
  controlsOpen = signal(false);
  toggleControls() {
    this.listsOpen.set(false);
    this.controlsOpen.set(!this.controlsOpen());
  }
  toggleLists() {
    this.controlsOpen.set(false);
    this.listsOpen.set(!this.listsOpen());
  }

  toggleInList(listId: string) {
    const song = this.song();
    if (song) this.songService.toggleInList(listId, song._id);
  }

  // The keeper takes a song someone added beside the book into the
  // Daloskönyv: part of the book from then on (its PDF, its count), and
  // the keeper's own - who added it can no longer change it.
  takingIn = signal(false);

  async takeIntoBook() {
    const song = this.song();
    if (!song || song.inBook || this.takingIn()) return;
    const ok = await this.confirm.ask({
      title: 'Felvétel a daloskönyvbe',
      message: `„${song.title}” a daloskönyv része lesz: bekerül a könyv PDF-jébe és a dalok számába.`,
      detail: song.ownerName
        ? `A dal ezentúl a tiéd: ${song.ownerName} többé nem tudja szerkeszteni vagy törölni.`
        : 'A dal ezentúl a tiéd.',
      confirmText: 'Felvétel',
      danger: false,
    });
    if (!ok) return;
    this.takingIn.set(true);
    this.songService.updateSong(song._id, { inBook: true }).subscribe({
      next: (saved) => {
        if (this.song()?._id === saved._id) this.song.set(saved);
        this.takingIn.set(false);
        // The list's tag and the book's count follow.
        this.songService.loadSongs();
        this.notifications.addSuccess('A dal bekerült a daloskönyvbe.');
      },
      error: (err) => {
        this.takingIn.set(false);
        this.notifications.addError(
          err?.error?.message ?? 'A dalt nem sikerült felvenni a daloskönyvbe.',
        );
      },
    });
  }

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
