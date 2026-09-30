import { Directive, ElementRef, OnDestroy, inject, input } from '@angular/core';

const PREVIEW_SIZE = 200;
const PREVIEW_GAP = 8;
const HOVER_DELAY_MS = 150;
// Must match styles.scss's .hover-preview transition duration.
const FADE_MS = 180;

// A picture's bigger version while the mouse is on it - the same as the
// user avatars' preview (components/avatar): after a short pause it fades
// and zooms in above the picture (below if there's no room), kept on
// screen, and goes on leaving or on any scroll. Mouse only - a tap keeps
// doing what the row does (e.g. playing the song). The preview lives on
// <body> (styles.scss's .hover-preview), so no list clips it.
//   <img [src]="url" [appHoverPreview]="url" />
@Directive({ selector: '[appHoverPreview]' })
export class HoverPreview implements OnDestroy {
  src = input<string | null | undefined>(null, { alias: 'appHoverPreview' });

  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private preview: HTMLImageElement | null = null;
  private openTimer: ReturnType<typeof setTimeout> | undefined;
  private removeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const el = this.host.nativeElement;
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || !this.src()) return;
      clearTimeout(this.openTimer);
      this.openTimer = setTimeout(() => this.open(), HOVER_DELAY_MS);
    });
    el.addEventListener('pointerleave', () => this.close());
  }

  private onAnyScroll = () => this.close();

  private open() {
    const src = this.src();
    if (!src) return;
    clearTimeout(this.removeTimer);
    this.preview?.remove();

    const rect = this.host.nativeElement.getBoundingClientRect();
    const above = rect.top - PREVIEW_SIZE - PREVIEW_GAP >= 0;
    const top = above ? rect.top - PREVIEW_SIZE - PREVIEW_GAP : rect.bottom + PREVIEW_GAP;
    const centered = rect.left + rect.width / 2 - PREVIEW_SIZE / 2;
    const left = Math.min(Math.max(centered, 8), window.innerWidth - PREVIEW_SIZE - 8);

    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.className = `hover-preview${above ? '' : ' below'}`;
    Object.assign(img.style, {
      top: `${top}px`,
      left: `${left}px`,
      width: `${PREVIEW_SIZE}px`,
      height: `${PREVIEW_SIZE}px`,
    });
    document.body.appendChild(img);
    this.preview = img;
    document.addEventListener('scroll', this.onAnyScroll, { capture: true, passive: true });
    requestAnimationFrame(() => requestAnimationFrame(() => img.classList.add('shown')));
  }

  private close() {
    clearTimeout(this.openTimer);
    document.removeEventListener('scroll', this.onAnyScroll, true);
    const img = this.preview;
    if (!img) return;
    this.preview = null;
    img.classList.remove('shown');
    clearTimeout(this.removeTimer);
    this.removeTimer = setTimeout(() => img.remove(), FADE_MS);
  }

  ngOnDestroy() {
    clearTimeout(this.openTimer);
    clearTimeout(this.removeTimer);
    document.removeEventListener('scroll', this.onAnyScroll, true);
    this.preview?.remove();
  }
}
