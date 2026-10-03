import { Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Song, SongService } from '../../../services/song';
import { NotificationsService } from '../../../notifications/notifications.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { SongSheet } from '../song-sheet/song-sheet';
import { TextEdit, insertChord, nudgeChord, wrapChorus } from '../chord-text';
import { chordsOverLyrics } from '../paste-chords';
import { allKeys, chordSignature, detectKey, keyName } from '../song-key';

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
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // The preview's chords can be pointed at, like on the song page.
  instrument = this.songService.instrument;

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
        this.song.set(song);
        this.title.set(song.title);
        this.artist.set(song.artist);
        this.chordpro.set(song.chordpro);
        this.chooseKey(song.key);
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
    // Straight into the textarea, so the cursor can be set at once.
    el.value = edit.text;
    this.chordpro.set(edit.text);
    el.focus();
    el.setSelectionRange(edit.start, edit.end);
  }

  addChord() {
    const el = this.textarea()?.nativeElement;
    if (el) this.apply(insertChord(el.value, el.selectionStart, el.selectionEnd));
  }

  markChorus() {
    const el = this.textarea()?.nativeElement;
    if (el) this.apply(wrapChorus(el.value, el.selectionStart, el.selectionEnd));
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
    const input = {
      title,
      artist: this.artist().trim(),
      chordpro: this.chordpro(),
      // The key set by hand, if it still holds - '' leaves it to the chords.
      key: this.key(),
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
