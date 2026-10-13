import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { NotificationsService } from '../../../notifications/notifications.service';
import { errorMessage } from '../../../shared/errors';
import {
  LibraryBook,
  LibrarySearch,
  LibraryService,
  LibraryShelf,
} from '../../../services/library';

// The spines' cloth and leather, in the order they follow each other on a
// shelf - warm and cool by turns, so neighbours never look alike.
const SPINE_COLORS = [
  '#7b2d26',
  '#1f4e5f',
  '#8a6a1f',
  '#4a3560',
  '#3d5a3a',
  '#7a3b4f',
  '#2f3e55',
  '#6b4226',
  '#34615a',
  '#5a2f2f',
];

// A number from a book's id - what its height is picked by.
function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** "Author · subtitle" - whichever the book has; empty with neither. */
export function byline(book: { author: string; subtitle: string }): string {
  return [book.author, book.subtitle].filter(Boolean).join(' · ');
}

/** A page's number as printed in the book - the PDF's own where it has none. */
export function printedPage(book: { pageOffset: number }, page: number): string {
  const printed = page + book.pageOffset;
  return printed >= 1 ? `${printed}. oldal` : `PDF ${page}. lap`;
}

// Média → Könyvtár: the role manager's PDF books standing on shelves - a
// shelf per folder of the server's library folder. Each shelf has its own
// search: in the books' titles, their tables of contents and the text of
// their pages. A spine opens the book (library-book.ts), a hit that page.
@Component({
  selector: 'app-library',
  imports: [RouterLink, MatIconModule],
  templateUrl: './library.html',
  styleUrl: './library.scss',
})
export class Library implements OnInit, OnDestroy {
  library = inject(LibraryService);
  private notifications = inject(NotificationsService);

  // What is typed on each shelf, and what was found for it (null: nothing
  // asked yet, or too short).
  queries = signal<Partial<Record<string, string>>>({});
  results = signal<Partial<Record<string, LibrarySearch | null>>>({});
  searching = signal<Partial<Record<string, boolean>>>({});
  private timers: Record<string, ReturnType<typeof setTimeout>> = {};
  // The shelf whose hits are showing - they drop over the bookcase as a
  // panel, one shelf's at a time.
  openShelf = signal<string | null>(null);

  // A shelf's upload under way: how much of the file has gone (0-100).
  uploading = signal<Partial<Record<string, number>>>({});

  printedPage = printedPage;
  byline = byline;

  ngOnInit() {
    this.library.load();
  }

  ngOnDestroy() {
    for (const timer of Object.values(this.timers)) clearTimeout(timer);
  }

  // A thicker book for more pages, and not all the same height. The colors
  // go round by the book's place on the shelf.
  spineStyle(book: LibraryBook, index: number) {
    const h = hash(book._id);
    return {
      '--spine-color': SPINE_COLORS[index % SPINE_COLORS.length],
      '--spine-width': `${Math.min(4.2, Math.max(2.3, 2.1 + book.pages / 140)).toFixed(2)}rem`,
      '--spine-height': `${(10.6 + ((h >> 4) % 5) * 0.45).toFixed(2)}rem`,
    };
  }

  // A click anywhere but on that shelf's search and hits shuts the panel
  // (what was typed stays - the box opens it again).
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    const open = this.openShelf();
    if (!open) return;
    const inside = (event.target as HTMLElement | null)?.closest?.('.search, .results');
    const shelf = inside?.closest<HTMLElement>('[data-shelf]')?.dataset['shelf'];
    if (shelf !== open) this.openShelf.set(null);
  }

  // Searching waits until the typing stops for a moment.
  onQuery(shelf: LibraryShelf, value: string) {
    this.openShelf.set(shelf.key);
    this.queries.update((q) => ({ ...q, [shelf.key]: value }));
    clearTimeout(this.timers[shelf.key]);
    const q = value.trim();
    if (q.length < 2) {
      this.results.update((r) => ({ ...r, [shelf.key]: null }));
      this.searching.update((s) => ({ ...s, [shelf.key]: false }));
      return;
    }
    this.searching.update((s) => ({ ...s, [shelf.key]: true }));
    this.timers[shelf.key] = setTimeout(() => {
      this.library.search(q, shelf.key).subscribe({
        next: (found) => {
          // An answer to what is no longer in the box is dropped.
          if ((this.queries()[shelf.key] ?? '').trim() !== q) return;
          this.results.update((r) => ({ ...r, [shelf.key]: found }));
          this.searching.update((s) => ({ ...s, [shelf.key]: false }));
        },
        error: () => this.searching.update((s) => ({ ...s, [shelf.key]: false })),
      });
    }, 300);
  }

  // A PDF picked for a shelf: sent, then the server reads it (the scan
  // note shows that part).
  onFile(shelf: LibraryShelf, input: HTMLInputElement) {
    const file = input.files?.[0];
    // The same file can be picked again after a failure.
    input.value = '';
    if (!file) return;
    const done = () =>
      this.uploading.update((u) => {
        const rest = { ...u };
        delete rest[shelf.key];
        return rest;
      });
    this.uploading.update((u) => ({ ...u, [shelf.key]: 0 }));
    this.library.upload(shelf.key, file).subscribe({
      next: (progress) => {
        if (progress === 'done') done();
        else this.uploading.update((u) => ({ ...u, [shelf.key]: progress }));
      },
      error: (err) => {
        done();
        this.notifications.addError(errorMessage(err, 'Nem sikerült feltölteni a könyvet.'));
      },
    });
  }

  clear(shelf: LibraryShelf) {
    this.onQuery(shelf, '');
  }

  // While a shelf is searched, the books with nothing found in them fade.
  isDimmed(shelf: LibraryShelf, book: LibraryBook): boolean {
    const found = this.results()[shelf.key];
    if (!found) return false;
    return !found.books[book._id] && !found.titles.some((b) => b._id === book._id);
  }

  hasHits(found: LibrarySearch): boolean {
    return found.titles.length + found.contents.length + found.pages.length > 0;
  }
}
