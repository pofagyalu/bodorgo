import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { Observable, filter, map } from 'rxjs';
import { environment } from '../../environments/environment';

// Média → Könyvtár: the role manager's own PDF books on shelves (the
// server's twin: controllers/libraryController.js). A shelf is a folder on
// the server, a book a PDF in it.

export interface LibraryBook {
  _id: string;
  shelf: string;
  title: string;
  // Written by the owner - empty until then.
  subtitle: string;
  author: string;
  pages: number;
  // The number printed on a page minus the PDF's page number.
  pageOffset: number;
  // False for a scan without OCR - nothing in it can be searched.
  hasText: boolean;
  // How many play-along tracks it has (on the shelves only).
  tracks?: number;
}

export interface TocEntry {
  title: string;
  page: number;
  level: number;
}

// A play-along track: a file in the folder beside the book's PDF.
export interface LibraryTrack {
  file: string;
  // The first number of its name (a CD's track number) - null without one.
  number: number | null;
  title: string;
}

// A track belonging to a page (the PDF's page number).
export interface AudioLink {
  file: string;
  page: number;
}

export interface LibraryBookDetails extends Omit<LibraryBook, 'tracks'> {
  filename: string;
  toc: TocEntry[];
  tracks: LibraryTrack[];
  audioLinks: AudioLink[];
}

export interface LibraryShelf {
  key: string;
  title: string;
  books: LibraryBook[];
}

// How the running (or the last) "Frissítés" stands.
export interface LibraryScan {
  running: boolean;
  done: number;
  total: number;
  current: string | null;
  errors: string[];
}

export interface LibrarySearch {
  titles: LibraryBook[];
  contents: { book: string; page: number; title: string }[];
  pages: {
    book: string;
    page: number;
    snippet: { before: string; match: string; after: string };
  }[];
  more: boolean;
  books: Record<string, LibraryBook>;
}

@Injectable({ providedIn: 'root' })
export class LibraryService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/library`;

  // null until the first answer.
  shelves = signal<LibraryShelf[] | null>(null);
  scan = signal<LibraryScan | null>(null);
  private poll: ReturnType<typeof setTimeout> | null = null;

  load() {
    this.http.get<{ data: { shelves: LibraryShelf[]; scan: LibraryScan } }>(this.apiUrl).subscribe({
      next: (res) => {
        this.shelves.set(res.data.shelves);
        this.scan.set(res.data.scan);
        // A scan fills the shelves book by book - looked at again until
        // it is over.
        if (res.data.scan.running) this.loadSoon();
      },
      error: () => this.shelves.update((s) => s ?? []),
    });
  }

  private loadSoon() {
    if (this.poll) clearTimeout(this.poll);
    this.poll = setTimeout(() => {
      this.poll = null;
      this.load();
    }, 1500);
  }

  // "Frissítés": the server reads the folders again.
  refresh() {
    this.http.post<{ data: { scan: LibraryScan } }>(`${this.apiUrl}/scan`, {}).subscribe({
      next: (res) => {
        this.scan.set(res.data.scan);
        this.loadSoon();
      },
    });
  }

  search(q: string, shelf: string): Observable<LibrarySearch> {
    return this.http
      .get<{ data: LibrarySearch }>(`${this.apiUrl}/search`, { params: { q, shelf } })
      .pipe(map((res) => res.data));
  }

  book(id: string): Observable<LibraryBookDetails> {
    return this.http
      .get<{ data: { book: LibraryBookDetails } }>(`${this.apiUrl}/books/${id}`)
      .pipe(map((res) => res.data.book));
  }

  // The title, subtitle and author, the page numbers' shift and the table of contents - only
  // what is sent changes.
  update(
    id: string,
    changes: {
      title?: string;
      subtitle?: string;
      author?: string;
      pageOffset?: number;
      toc?: TocEntry[];
      audioLinks?: AudioLink[];
    },
  ): Observable<LibraryBookDetails> {
    return this.http
      .patch<{ data: { book: LibraryBookDetails } }>(`${this.apiUrl}/books/${id}`, changes)
      .pipe(map((res) => res.data.book));
  }

  // A table of contents guessed from the book - to correct, not saved.
  tocProposal(id: string): Observable<TocEntry[]> {
    return this.http
      .get<{ data: { toc: TocEntry[] } }>(`${this.apiUrl}/books/${id}/toc-proposal`)
      .pipe(map((res) => res.data.toc));
  }

  // Track-to-page links guessed from the book ("Track 8" on a page) - to
  // correct, not saved.
  audioProposal(id: string): Observable<AudioLink[]> {
    return this.http
      .get<{ data: { audioLinks: AudioLink[] } }>(`${this.apiUrl}/books/${id}/audio-proposal`)
      .pipe(map((res) => res.data.audioLinks));
  }

  audioUrl(bookId: string, file: string): string {
    return `${this.apiUrl}/books/${bookId}/audio/${encodeURIComponent(file)}`;
  }

  // A page's first words: what a new line of the contents is offered as.
  pageOpening(id: string, page: number): Observable<string> {
    return this.http
      .get<{ data: { opening: string } }>(`${this.apiUrl}/books/${id}/pages/${page}/opening`)
      .pipe(map((res) => res.data.opening));
  }

  // Puts a PDF on a shelf. Tells how far the sending is (0-100) as it goes,
  // then 'done' - the server reads the book after that (see load()).
  upload(shelf: string, file: File): Observable<number | 'done'> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http
      .post<{ data: { scan: LibraryScan } }>(`${this.apiUrl}/shelves/${shelf}/books`, body, {
        reportProgress: true,
        observe: 'events',
      })
      .pipe(
        filter((e) => e.type === HttpEventType.UploadProgress || e.type === HttpEventType.Response),
        map((e) => {
          if (e.type === HttpEventType.UploadProgress) {
            return e.total ? Math.round((100 * e.loaded) / e.total) : 0;
          }
          if (e.type === HttpEventType.Response && e.body) {
            this.scan.set(e.body.data.scan);
            this.loadSoon();
          }
          return 'done' as const;
        }),
      );
  }

  pageUrl(bookId: string, page: number): string {
    return `${this.apiUrl}/books/${bookId}/pages/${page}`;
  }
}
