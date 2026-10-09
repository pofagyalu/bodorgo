import { Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Song, SongService } from '../../../services/song';
import { AuthService } from '../../../auth/auth.service';
import { canEditSongs } from '../../../auth/song-edit.guard';
import { NotificationsService } from '../../../notifications/notifications.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { SongSheet } from '../song-sheet/song-sheet';
import {
  TextEdit,
  insertChord,
  insertDefine,
  nudgeChord,
  toggleRepeat,
  toggleScreenOnly,
  wrapChorus,
  wrapTab,
} from '../chord-text';
import { defineLine } from '../chord-shapes';
import { chordsOverLyrics } from '../paste-chords';
import { allKeys, chordSignature, detectKey, keyName } from '../song-key';
import { TEMPO_MAX, TEMPO_MIN, TapTempo, readTempo } from '../tempo';

// The Daloskönyv's editor - a new song, or an existing one: its title
// and artist, and the ChordPro text with the song drawn live beside
// it (under it on a phone). Only for the role manager (song-edit.guard.ts;
// the server checks too).
@Component({
  selector: 'app-song-edit',
  imports: [RouterLink, MatIconModule, SongSheet],
  templateUrl: './song-edit.html',
  styleUrl: './song-edit.scss',
})
export class SongEdit implements OnInit {
  private songService = inject(SongService);
  private auth = inject(AuthService);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // The preview's chords can be pointed at, like on the song page.
  instrument = this.songService.instrument;

  // The book's keeper: their songs are the book itself. Anyone else's
  // song stands beside it (the note over the text says so).
  isKeeper = computed(() => canEditSongs(this.auth.user()));

  private textarea = viewChild<ElementRef<HTMLTextAreaElement>>('text');

  // The song being changed - null for a new one.
  song = signal<Song | null>(null);
  isNew = !this.route.snapshot.paramMap.get('slug');
  loading = signal(!this.isNew);
  saving = signal(false);

  title = signal('');
  artist = signal('');
  chordpro = signal('');

  // --- The song's key (hangnem) ---

  // Every key there is to choose, with its name ("a-moll").
  readonly keys = allKeys().map((home) => ({ home, name: keyName(home) }));
  // What the chords in the text say, as they are typed.
  detectedKey = computed(() => keyName(detectKey(this.chordpro())));
  // The key chosen by hand, and the chords it was chosen for: it holds only
  // while the chords stay as they were - change a chord, and the key is
  // worked out again (and can be set by hand again).
  private chosenKey = signal('');
  private chosenFor = signal('');
  key = computed(() =>
    this.chosenKey() && chordSignature(this.chordpro()) === this.chosenFor()
      ? this.chosenKey()
      : '',
  );

  // The key as the song will show it: the one chosen, or the one the
  // chords say.
  previewKey = computed(() => (this.key() ? keyName(this.key()) : this.detectedKey()));

  chooseKey(home: string) {
    this.chosenKey.set(home);
    this.chosenFor.set(chordSignature(this.chordpro()));
  }

  // --- The song's tempo (tempo.ts) ---

  // As it stands in its field - '' for none.
  tempoText = signal('');
  private taps = new TapTempo();

  // A tap on "Koppints": from the second one on the field shows the tempo
  // of the tapping.
  tapTempo() {
    const tempo = this.taps.tap(performance.now());
    if (tempo !== null) this.tempoText.set(String(tempo));
  }

  // Where "Mégse" leads: back to the song, or to the list.
  backLink = computed(() => {
    const song = this.song();
    const base = this.songService.base();
    return song ? [base, song.slug] : [base];
  });

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) return;
    this.songService.getSong(slug).subscribe({
      next: (song) => {
        // Someone else's song: to look at, not to change.
        if (!song.canEdit) {
          this.notifications.addError('Ezt a dalt csak az módosíthatja, aki felvette.');
          void this.router.navigate([this.songService.base(), song.slug]);
          return;
        }
        this.song.set(song);
        this.title.set(song.title);
        this.artist.set(song.artist);
        this.chordpro.set(song.chordpro);
        this.chooseKey(song.key);
        this.tempoText.set(song.tempo ? String(song.tempo) : '');
        this.loading.set(false);
      },
      error: () => {
        this.notifications.addError('Nincs ilyen dal a daloskönyvben.');
        void this.router.navigate([this.songService.base()]);
      },
    });
  }

  // --- The text's helpers (chord-text.ts) ---

  private apply(edit: TextEdit | null) {
    const el = this.textarea()?.nativeElement;
    if (!el || !edit) return;
    // Straight into the textarea, so the cursor can be set at once. The
    // text stays where it was scrolled to: a new value (and the cursor set
    // in it) would otherwise jump the box, and the line just worked on
    // would be out of sight.
    const top = el.scrollTop;
    el.value = edit.text;
    this.chordpro.set(edit.text);
    el.focus({ preventScroll: true });
    el.setSelectionRange(edit.start, edit.end);
    el.scrollTop = top;
  }

  addChord() {
    const el = this.textarea()?.nativeElement;
    if (el) this.apply(insertChord(el.value, el.selectionStart, el.selectionEnd));
  }

  markChorus() {
    const el = this.textarea()?.nativeElement;
    if (el) this.apply(wrapChorus(el.value, el.selectionStart, el.selectionEnd));
  }

  // The cursor's chord held its own way in this song: a {define} line at
  // the song's top, with the songbook's shape to change.
  defineChord() {
    const el = this.textarea()?.nativeElement;
    if (!el) return;
    this.apply(
      insertDefine(el.value, el.selectionStart, (name) => defineLine(name, this.instrument())),
    );
  }

  // A guitar tab: the selected lines marked as one, or - on an empty line -
  // six empty strings to type on.
  markTab() {
    const el = this.textarea()?.nativeElement;
    if (el) this.apply(wrapTab(el.value, el.selectionStart, el.selectionEnd));
  }

  // The selected lines (or the cursor's) between repeat signs: ||: … :|| -
  // or the signs taken off them.
  markRepeat() {
    const el = this.textarea()?.nativeElement;
    if (!el) return;
    const edit = toggleRepeat(el.value, el.selectionStart, el.selectionEnd);
    if (edit) this.apply(edit);
    else el.focus();
  }

  // The cursor's verse: its chords for the screen only ({screen}) - or
  // printed again, if it was marked.
  markScreenOnly() {
    const el = this.textarea()?.nativeElement;
    if (!el) return;
    this.apply(toggleScreenOnly(el.value, el.selectionStart));
  }

  // The chord under the cursor, a letter left or right.
  nudge(by: -1 | 1) {
    const el = this.textarea()?.nativeElement;
    if (!el) return;
    const edit = nudgeChord(el.value, el.selectionStart, by);
    if (edit) this.apply(edit);
    else el.focus();
  }

  // A song copied from a page of tabs - lines of chords over lines of
  // words - goes in as ChordPro (paste-chords.ts). First as it was copied,
  // then turned: so one Ctrl+Z gives back the copied text, should the turn
  // be wrong for a song. Anything else is pasted as usual.
  onPaste(event: ClipboardEvent) {
    const el = this.textarea()?.nativeElement;
    const pasted = event.clipboardData?.getData('text/plain') ?? '';
    const turned = chordsOverLyrics(pasted);
    if (!el || turned === null) return;
    event.preventDefault();

    const raw = pasted.replace(/\r\n?/g, '\n');
    const start = el.selectionStart;
    const before = el.value.slice(0, start);
    const after = el.value.slice(el.selectionEnd);
    el.focus();
    // execCommand keeps the text box's own undo; without it (or where it
    // does nothing) the text is set straight.
    const typed =
      typeof document.execCommand === 'function' &&
      document.execCommand('insertText', false, raw) &&
      el.value === before + raw + after;
    if (typed) {
      el.setSelectionRange(start, start + raw.length);
      document.execCommand('insertText', false, turned);
    }
    if (el.value !== before + turned + after) {
      el.value = before + turned + after;
      el.setSelectionRange(start + turned.length, start + turned.length);
    }
    this.chordpro.set(el.value);
    this.notifications.addSuccess(
      'Az akkordok a szövegbe kerültek. Ctrl+Z: vissza a másolt szöveghez.',
    );
  }

  // Alt + ← / →: the same from the keyboard.
  onKeydown(event: KeyboardEvent) {
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    this.nudge(event.key === 'ArrowLeft' ? -1 : 1);
  }

  // --- Saving and deleting ---

  save() {
    const title = this.title().trim();
    if (!title) {
      this.notifications.addError('A dalnak kell legyen címe.');
      return;
    }
    const tempo = readTempo(this.tempoText());
    if (this.tempoText().trim() && tempo === null) {
      this.notifications.addError(`A tempó ${TEMPO_MIN} és ${TEMPO_MAX} közötti egész szám lehet.`);
      return;
    }
    const input = {
      title,
      artist: this.artist().trim(),
      chordpro: this.chordpro(),
      // The key set by hand, if it still holds - '' leaves it to the chords.
      key: this.key(),
      tempo,
    };
    const song = this.song();
    this.saving.set(true);
    (song
      ? this.songService.updateSong(song._id, input)
      : this.songService.createSong(input)
    ).subscribe({
      next: (saved) => {
        this.notifications.addSuccess('A dal elmentve.');
        this.songService.loadSongs();
        void this.router.navigate([this.songService.base(), saved.slug]);
      },
      error: (err) => {
        this.saving.set(false);
        this.notifications.addError(err?.error?.message ?? 'A dalt nem sikerült elmenteni.');
      },
    });
  }

  async delete() {
    const song = this.song();
    if (!song) return;
    const ok = await this.confirm.ask({
      title: 'Dal törlése',
      message: `Biztosan törlöd ezt a dalt: „${song.title}”?`,
      detail: 'A dal szövege és akkordjai végleg elvesznek.',
    });
    if (!ok) return;
    this.songService.deleteSong(song._id).subscribe({
      next: () => {
        this.notifications.addSuccess('A dal törölve.');
        this.songService.loadSongs();
        void this.router.navigate([this.songService.base()]);
      },
      error: (err) =>
        this.notifications.addError(err?.error?.message ?? 'A dalt nem sikerült törölni.'),
    });
  }
}
