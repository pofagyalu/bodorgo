import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { BlockLine, Segment, parseChordPro, toBlocks, toWords } from '../chordpro';
import { parseChord, transposer } from '../chords';
import { ChordShape, Instrument, chordShape, uniqueChords } from '../chord-shapes';
import { songKey } from '../song-key';
import { ChordDiagram } from '../chord-diagram/chord-diagram';
import { ChordName } from '../chord-name/chord-name';

interface ViewLine {
  type: BlockLine['type'];
  text: string;
  hasChords: boolean;
  words: Segment[][];
}

// The diagram shown at a chord under the pointer (or the finger).
interface Popup {
  anchor: HTMLElement;
  name: string;
  shape: ChordShape | null;
  left: number;
  top: number;
  // Opened by a tap or a click: it stays until the next one.
  pinned: boolean;
}

// The popup's size on the screen, for placing it (CSS px).
const POPUP_WIDTH = 124;
const POPUP_HEIGHT = 150;

// A song's lyrics drawn from its ChordPro text, each chord over its own
// syllable - on the song page, and as the editor's live preview. With an
// instrument it also knows how the chords are held: all of them in a strip
// above the lyrics (showDiagrams), and one at a time over the chord the
// pointer is on (or a finger taps). Sized from the --scale of whatever it
// stands in (1 without one).
@Component({
  selector: 'app-song-sheet',
  imports: [ChordDiagram, ChordName],
  templateUrl: './song-sheet.html',
  styleUrl: './song-sheet.scss',
})
export class SongSheet {
  chordpro = input.required<string>();
  // Semitones up (+) or down (-) - on the screen only.
  transpose = input(0);
  // The song's key as its home chord ("C", "am"), when it was set by hand -
  // the moved chords are spelled for it. '': the key the chords say.
  songKey = input('');
  // Whose diagrams - null: none.
  instrument = input<Instrument | null>(null);
  showDiagrams = input(false);

  popup = signal<Popup | null>(null);

  // The song's lines with the chords moved to the key on the screen.
  private lines = computed(() => {
    const lines = parseChordPro(this.chordpro()).lines;
    const key = songKey({ key: this.songKey(), chordpro: this.chordpro() });
    const move = transposer(key, this.transpose());
    return lines.map((line) =>
      line.type === 'lyrics' || line.type === 'chords-only'
        ? {
            ...line,
            segments: line.segments.map((s) =>
              s.chord === undefined ? s : { ...s, chord: move(s.chord) },
            ),
          }
        : line,
    );
  });

  blocks = computed(() =>
    toBlocks(this.lines()).map((block) => ({
      chorus: block.chorus,
      lines: block.lines.map((line): ViewLine => {
        if (line.type === 'comment') {
          return { type: line.type, text: line.text, hasChords: false, words: [] };
        }
        return {
          type: line.type,
          text: '',
          hasChords: line.segments.some((s) => s.chord),
          words: toWords(line.segments),
        };
      }),
    })),
  );

  // Every chord of the song once, with how it's held.
  diagrams = computed(() => {
    const instrument = this.instrument();
    if (!instrument || !this.showDiagrams()) return [];
    const chords = this.lines().flatMap((l) =>
      l.type === 'lyrics' || l.type === 'chords-only' ? l.segments.map((s) => s.chord ?? '') : [],
    );
    return uniqueChords(chords).map((name) => ({ name, shape: chordShape(name, instrument) }));
  });

  constructor() {
    // The popup is pinned to the screen, the chord isn't: once anything
    // scrolls, it goes. A tap anywhere else closes it too.
    const close = () => this.popup.set(null);
    window.addEventListener('scroll', close, true);
    document.addEventListener('click', close);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('scroll', close, true);
      document.removeEventListener('click', close);
    });
  }

  // The mouse is over a chord.
  onEnter(event: PointerEvent, name: string) {
    if (event.pointerType !== 'mouse' || this.popup()?.pinned) return;
    this.open(event.currentTarget as HTMLElement, name, false);
  }

  onLeave(event: PointerEvent) {
    if (event.pointerType === 'mouse' && !this.popup()?.pinned) this.popup.set(null);
  }

  // A tap (or a click): the diagram stays; the same chord again closes it.
  onTap(event: Event, name: string) {
    event.stopPropagation();
    const el = event.currentTarget as HTMLElement;
    const current = this.popup();
    if (current?.anchor === el && current.pinned) this.popup.set(null);
    else this.open(el, name, true);
  }

  // What stands in [brackets] but isn't a chord ("Intro", "2x", "/"): a
  // label over the lyrics - drawn quieter, and with nothing to show how to
  // hold.
  isChord(name: string): boolean {
    return parseChord(name) !== null;
  }

  private open(anchor: HTMLElement, name: string, pinned: boolean) {
    const instrument = this.instrument();
    const shape = instrument ? chordShape(name, instrument) : null;
    // Not a chord: nothing pops up (and what was open closes).
    if (!instrument || !shape) {
      this.popup.set(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - POPUP_WIDTH / 2, 8),
      window.innerWidth - POPUP_WIDTH - 8,
    );
    // Above the chord; under it when there is no room above.
    const above = rect.top - POPUP_HEIGHT - 8;
    this.popup.set({
      anchor,
      name,
      shape,
      left,
      top: above < 8 ? rect.bottom + 8 : above,
      pinned,
    });
  }
}
