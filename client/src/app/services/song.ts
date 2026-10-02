import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { Instrument } from '../pages/daloskonyv/chord-shapes';

const INSTRUMENT_KEY = 'daloskonyv-instrument';
const PLAYED_KEY = 'daloskonyv-played';

// A song in the table of contents - no lyrics. The book is in the order of
// the titles.
export interface SongListItem {
  _id: string;
  title: string;
  artist: string;
  slug: string;
}

export interface Song extends SongListItem {
  // Lyrics and chords as ChordPro text (pages/daloskonyv/chordpro.ts).
  chordpro: string;
  tags: string[];
  updatedAt: string;
}

// What the editor sends.
export interface SongInput {
  title: string;
  artist: string;
  chordpro: string;
}

// Whose chord diagrams the PDF has - or none.
export type BookDiagrams = Instrument | 'none';

// Daloskönyv: the club's songbook (the server's songController.js).
@Injectable({ providedIn: 'root' })
export class SongService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/songs`;
  private auth = inject(AuthService);

  // Where the songbook is: for members inside Média → Zene (with Média's
  // side menu around it); for guests, who have no Média, the page of its
  // own. Every link to the list, a song or the editor starts from here.
  readonly base = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'admin' || role === 'member' ? '/media/zene/daloskonyv' : '/daloskonyv';
  });

  // Whose chord diagrams the songbook shows - chosen on its main page,
  // remembered on this device.
  readonly instrument = signal<Instrument>(storedInstrument());

  setInstrument(instrument: Instrument) {
    this.instrument.set(instrument);
    try {
      localStorage.setItem(INSTRUMENT_KEY, instrument);
    } catch {
      // Private mode: not remembered.
    }
  }

  // The songs played tonight (their ids) - marked by hand on a song's page,
  // or by its play button reaching the end; shown in the list, and wiped
  // with one tap the next day. Kept on this device only.
  readonly played = signal<ReadonlySet<string>>(storedPlayed());

  setPlayed(id: string, played: boolean) {
    const next = new Set(this.played());
    if (played) next.add(id);
    else next.delete(id);
    this.savePlayed(next);
  }

  clearPlayed() {
    this.savePlayed(new Set());
  }

  private savePlayed(played: Set<string>) {
    this.played.set(played);
    try {
      localStorage.setItem(PLAYED_KEY, JSON.stringify([...played]));
    } catch {
      // Private mode: not remembered.
    }
  }

  // What the song list is narrowed to - typed on the songbook's main page,
  // or above an open song (the list is beside it then).
  readonly search = signal('');

  // The table of contents, in the book's order - null until it arrives.
  // Kept here so the song page's previous/next has it too.
  readonly songs = signal<SongListItem[] | null>(null);
  // Only the role manager may add and change songs.
  readonly canEdit = signal(false);

  // When a song was last added or changed - the book's date on its
  // Dokumentumok card. null: not known yet, or no songs.
  readonly lastChanged = signal<string | null>(null);

  loadSongs() {
    this.http
      .get<{
        data: { songs: SongListItem[]; canEdit: boolean; lastChanged: string | null };
      }>(this.apiUrl)
      .subscribe({
        next: (res) => {
          this.songs.set(res.data.songs);
          this.canEdit.set(res.data.canEdit);
          this.lastChanged.set(res.data.lastChanged);
        },
        error: () => this.songs.update((songs) => songs ?? []),
      });
  }

  getSong(slug: string): Observable<Song> {
    return this.http
      .get<{ data: { song: Song } }>(`${this.apiUrl}/${encodeURIComponent(slug)}`)
      .pipe(map((res) => res.data.song));
  }

  // The whole songbook as a PDF (the server draws it: songs/songBook.js) -
  // a plain link, the session cookie goes with it. download: saved rather
  // than opened.
  bookUrl(diagrams: BookDiagrams, download = false): string {
    const query = [
      diagrams === 'none' ? '' : `diagrams=${diagrams}`,
      download ? 'download=1' : '',
    ].filter(Boolean);
    return `${this.apiUrl}/book.pdf${query.length ? `?${query.join('&')}` : ''}`;
  }

  // The book's cover as a small picture (its Dokumentumok card). version:
  // anything that changes when the book does, so the browser asks again.
  bookPreviewUrl(diagrams: BookDiagrams, version: string): string {
    const query = [
      diagrams === 'none' ? '' : `diagrams=${diagrams}`,
      `v=${encodeURIComponent(version)}`,
    ].filter(Boolean);
    return `${this.apiUrl}/book.webp?${query.join('&')}`;
  }

  // Adding, changing and deleting: only the role manager (the server says
  // 403 to anyone else).
  createSong(input: SongInput): Observable<Song> {
    return this.http
      .post<{ data: { song: Song } }>(this.apiUrl, input)
      .pipe(map((res) => res.data.song));
  }

  updateSong(id: string, input: SongInput): Observable<Song> {
    return this.http
      .patch<{ data: { song: Song } }>(`${this.apiUrl}/${id}`, input)
      .pipe(map((res) => res.data.song));
  }

  deleteSong(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}

function storedPlayed(): Set<string> {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(PLAYED_KEY) ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function storedInstrument(): Instrument {
  try {
    return localStorage.getItem(INSTRUMENT_KEY) === 'ukulele' ? 'ukulele' : 'guitar';
  } catch {
    return 'guitar';
  }
}
