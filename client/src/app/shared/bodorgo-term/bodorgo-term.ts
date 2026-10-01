import {
  afterRenderEffect,
  Component,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { browserEntryLang, ENTRIES, ENTRY_SOURCES } from './bodorgo-entry';

// How long the card stays after the mouse has left - time to cross the
// gap between the word and the card.
const CLOSE_DELAY_MS = 200;
// The room left between the card and the screen's edges (and the word).
const EDGE_PX = 8;
// The card's type doesn't shrink below this to fit.
const MIN_FONT_PX = 9;

// The word "Bódorgó™", highlighted, with its dictionary entry on a card
// under it (bodorgo-entry.ts): the card opens while the mouse is over the
// word (or the card), and on a tap or click - another tap, a tap anywhere
// else (the card and its ✕ too) or Esc closes it. The card always fits on
// the screen whole.
@Component({
  selector: 'app-bodorgo-term',
  templateUrl: './bodorgo-term.html',
  styleUrl: './bodorgo-term.scss',
})
export class BodorgoTerm implements OnDestroy {
  private host: ElementRef<HTMLElement> = inject(ElementRef);

  readonly lang = browserEntryLang();
  readonly entry = ENTRIES[this.lang];
  readonly sources = ENTRY_SOURCES;

  private word = viewChild.required<ElementRef<HTMLElement>>('word');
  private card = viewChild<ElementRef<HTMLElement>>('card');

  open = signal(false);
  // Opened by a tap or click: the mouse leaving doesn't close it then.
  private pinned = false;
  private closeTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Once the card is on the page, it is sized and placed.
    afterRenderEffect(() => {
      if (this.card()) this.fit();
    });
  }

  ngOnDestroy() {
    clearTimeout(this.closeTimer);
  }

  // The whole card on the screen, without scrolling: its type shrinks
  // until it fits between the site's header and the bottom of the screen,
  // and it starts right under the word - or as much higher as it needs.
  @HostListener('window:resize')
  fit() {
    const card = this.card()?.nativeElement;
    if (!card) return;
    const top =
      (document.querySelector('app-header')?.getBoundingClientRect().bottom ?? 0) + EDGE_PX;
    const room = window.innerHeight - EDGE_PX - top;

    card.style.fontSize = '';
    let size = parseFloat(getComputedStyle(card).fontSize);
    while (card.offsetHeight > room && size > MIN_FONT_PX) {
      size -= 0.5;
      card.style.fontSize = `${size}px`;
    }

    const underWord = this.word().nativeElement.getBoundingClientRect().bottom + EDGE_PX;
    const lowest = window.innerHeight - EDGE_PX - card.offsetHeight;
    card.style.top = `${Math.max(top, Math.min(underWord, lowest))}px`;
  }

  // Hovering is the mouse's - a finger's touch arrives as a click.
  onPointerEnter(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(this.closeTimer);
    this.open.set(true);
  }

  onPointerLeave(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || this.pinned) return;
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.open.set(false), CLOSE_DELAY_MS);
  }

  toggle() {
    clearTimeout(this.closeTimer);
    // Under the mouse it is open already: the click keeps it there.
    this.pinned = !this.pinned;
    this.open.set(this.pinned);
  }

  close() {
    clearTimeout(this.closeTimer);
    this.pinned = false;
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.open()) this.close();
  }
}
