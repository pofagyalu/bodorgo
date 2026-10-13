import {
  Component,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { NotificationsService } from '../../../notifications/notifications.service';
import { LibraryBookDetails, LibraryService, TocEntry } from '../../../services/library';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { errorMessage } from '../../../shared/errors';
import { byline, printedPage } from './library';

// What is being changed while the book is edited - saved together.
interface Draft {
  title: string;
  subtitle: string;
  author: string;
  pageOffset: number;
  toc: TocEntry[];
}

// Média → Könyvtár: one book, a page at a time - the page is a picture the
// server draws (the whole PDF never comes down). Beside it the table of
// contents; the page shown is in the address (?page=), so a search hit
// opens right there. The pencil turns the column into the book's editor:
// its title, subtitle and author, which number is printed on the page shown, and the lines of
// the contents.
@Component({
  selector: 'app-library-book',
  imports: [RouterLink, MatIconModule],
  templateUrl: './library-book.html',
  styleUrl: './library-book.scss',
})
export class LibraryBookPage implements OnInit {
  private library = inject(LibraryService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  book = signal<LibraryBookDetails | null>(null);
  missing = signal(false);
  // The PDF's page number, from 1.
  page = signal(1);
  // Until the page's picture has arrived.
  loading = signal(true);
  // A phone's table of contents: behind a button.
  tocOpen = signal(false);

  // null: not editing.
  draft = signal<Draft | null>(null);
  saving = signal(false);
  proposing = signal(false);

  // "Author · subtitle" under the title - as being written while editing.
  byline = computed(() => {
    const shown = this.draft() ?? this.book();
    return shown ? byline(shown) : '';
  });

  pageUrl = computed(() => {
    const book = this.book();
    return book ? this.library.pageUrl(book._id, this.page()) : null;
  });

  // The printed number minus the PDF's - the one being set while editing.
  offset = computed(() => this.draft()?.pageOffset ?? this.book()?.pageOffset ?? 0);

  printed = computed(() => printedPage({ pageOffset: this.offset() }, this.page()));

  // Where we are in the contents: the last line at or before this page.
  currentToc = computed(() => {
    const toc = this.book()?.toc ?? [];
    let at = -1;
    toc.forEach((entry, i) => {
      if (entry.page <= this.page()) at = i;
    });
    return at;
  });

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.show(Number(params.get('page')) || 1);
    });
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('book') ?? '';
    this.library.book(id).subscribe({
      next: (book) => {
        this.book.set(book);
        this.show(this.page());
      },
      error: () => this.missing.set(true),
    });
  }

  // Shows a page - kept inside the book once its length is known.
  private show(page: number) {
    const pages = this.book()?.pages;
    const next = Math.max(1, pages ? Math.min(pages, Math.round(page)) : Math.round(page));
    if (next !== this.page()) this.loading.set(true);
    this.page.set(next);
    // The page after it is fetched ahead, so turning is instant.
    const book = this.book();
    if (book && next < book.pages) new Image().src = this.library.pageUrl(book._id, next + 1);
  }

  // Turning a page changes the address (without a new history step: Back
  // leaves the book). While editing, the contents stay open on a phone.
  go(page: number) {
    const pages = this.book()?.pages ?? 1;
    const next = Math.max(1, Math.min(pages, Math.round(page) || 1));
    if (!this.draft()) this.tocOpen.set(false);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: next },
      replaceUrl: true,
    });
  }

  // The printed number typed into the box.
  goPrinted(value: string) {
    const printed = Number(value);
    if (this.book() && Number.isFinite(printed) && value.trim()) this.go(printed - this.offset());
  }

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent) {
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (event.key === 'ArrowRight') this.go(this.page() + 1);
    else if (event.key === 'ArrowLeft') this.go(this.page() - 1);
  }

  // --- Editing ---

  edit() {
    const book = this.book();
    if (!book) return;
    this.draft.set({
      title: book.title,
      subtitle: book.subtitle,
      author: book.author,
      pageOffset: book.pageOffset,
      toc: book.toc.map((e) => ({ ...e })),
    });
    this.tocOpen.set(true);
  }

  cancel() {
    this.draft.set(null);
    this.tocOpen.set(false);
  }

  private change(changes: Partial<Draft>) {
    this.draft.update((d) => (d ? { ...d, ...changes } : d));
  }

  setTitle(value: string) {
    this.change({ title: value });
  }

  setSubtitle(value: string) {
    this.change({ subtitle: value });
  }

  setAuthor(value: string) {
    this.change({ author: value });
  }

  // "This page has number N printed on it" - the shift follows from it.
  setPrinted(value: string) {
    const printed = Number(value);
    if (value.trim() && Number.isInteger(printed)) {
      this.change({ pageOffset: printed - this.page() });
    }
  }

  setLineTitle(index: number, value: string) {
    this.change({
      toc: this.draft()!.toc.map((e, i) => (i === index ? { ...e, title: value } : e)),
    });
  }

  // A line's page, typed as the printed number; the lines stay in the
  // order of their pages.
  setLinePage(index: number, value: string) {
    const draft = this.draft()!;
    const pages = this.book()?.pages ?? 1;
    const page = Number(value) - draft.pageOffset;
    if (!value.trim() || !Number.isInteger(page)) return;
    const toc = draft.toc.map((e, i) =>
      i === index ? { ...e, page: Math.max(1, Math.min(pages, page)) } : e,
    );
    this.change({ toc: byPage(toc) });
  }

  removeLine(index: number) {
    this.change({ toc: this.draft()!.toc.filter((_, i) => i !== index) });
  }

  // A new line pointing at the page shown, offered with the page's first
  // words - ready to be typed over.
  addCurrentPage() {
    const book = this.book();
    if (!book || !this.draft()) return;
    const page = this.page();
    this.library.pageOpening(book._id, page).subscribe({
      next: (opening) => this.insertLine(opening, page),
      error: () => this.insertLine('', page),
    });
  }

  private insertLine(title: string, page: number) {
    const draft = this.draft();
    if (!draft) return;
    const line: TocEntry = { title, page, level: 0 };
    const toc = byPage([...draft.toc, line]);
    this.change({ toc });
    const index = toc.indexOf(line);
    // Once it is drawn: the cursor into it, its text selected.
    setTimeout(() => {
      const input = this.host.nativeElement.querySelector<HTMLInputElement>(
        `[data-toc-line="${index}"]`,
      );
      input?.focus();
      input?.select();
    });
  }

  // The contents guessed from the book itself - instead of what is there.
  async propose() {
    const book = this.book();
    const draft = this.draft();
    if (!book || !draft) return;
    if (
      draft.toc.length &&
      !(await this.confirm.ask({
        title: 'Javaslat a könyvből',
        message: 'A mostani sorok helyére a könyvből kiolvasott címek kerülnek.',
        detail: 'Csak mentéskor lesz végleges.',
        confirmText: 'Csere',
      }))
    ) {
      return;
    }
    this.proposing.set(true);
    this.library.tocProposal(book._id).subscribe({
      next: (toc) => {
        this.proposing.set(false);
        if (!toc.length) {
          this.notifications.addError('Ebből a könyvből nem sikerült címeket kiolvasni.');
          return;
        }
        this.change({ toc });
      },
      error: (err) => {
        this.proposing.set(false);
        this.notifications.addError(errorMessage(err, 'Nem sikerült a javaslat.'));
      },
    });
  }

  save() {
    const book = this.book();
    const draft = this.draft();
    if (!book || !draft) return;
    if (!draft.title.trim()) {
      this.notifications.addError('A könyvnek kell legyen címe.');
      return;
    }
    // A line left empty is not kept.
    const toc = draft.toc.map((e) => ({ ...e, title: e.title.trim() })).filter((e) => e.title);
    const tocChanged = JSON.stringify(toc) !== JSON.stringify(book.toc);
    this.saving.set(true);
    this.library
      .update(book._id, {
        title: draft.title.trim(),
        subtitle: draft.subtitle.trim(),
        author: draft.author.trim(),
        pageOffset: draft.pageOffset,
        // Untouched contents are not sent - a new scan may still refresh
        // them from the PDF's bookmarks.
        ...(tocChanged ? { toc } : {}),
      })
      .subscribe({
        next: (saved) => {
          this.saving.set(false);
          this.book.set(saved);
          this.draft.set(null);
          this.tocOpen.set(false);
          // The shelf shows the new title.
          this.library.load();
        },
        error: (err) => {
          this.saving.set(false);
          this.notifications.addError(errorMessage(err, 'Nem sikerült menteni.'));
        },
      });
  }
}

const byPage = (toc: TocEntry[]) => [...toc].sort((a, b) => a.page - b.page);
