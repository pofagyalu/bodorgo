import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { UserService } from '../../services/user';

const PREVIEW_SIZE = 160;
const PREVIEW_GAP = 8;
const HOVER_DELAY_MS = 150;
// Must match avatar.scss's .avatar-preview transition duration.
const FADE_MS = 180;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// A user's profile photo, or their initials when there isn't one - the
// size/shape/colors come from whatever class the parent puts on
// <app-avatar> (e.g. members.scss's .person-avatar), this only fills it.
// Always sits next to the person's name, so the enlarged preview (hover on
// desktop, tap on a phone) is just the bigger photo, no caption.
@Component({
  selector: 'app-avatar',
  standalone: true,
  templateUrl: './avatar.html',
  styleUrl: './avatar.scss',
})
export class Avatar {
  private userService = inject(UserService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  name = input.required<string>();
  userId = input<string | null | undefined>(null);
  // The user's photoUpdatedAt - null/undefined means no photo.
  photoVersion = input<string | null | undefined>(null);
  preview = input(true);

  // A photo that failed to load (deleted meanwhile, session expired...)
  // falls back to the initials instead of a broken-image icon.
  private failedUrl = signal<string | null>(null);

  initials = computed(() => initialsOf(this.name()));

  photoUrl = computed(() => {
    const id = this.userId();
    const version = this.photoVersion();
    if (!id || !version) return null;
    const url = this.userService.photoUrl(id, version);
    return url === this.failedUrl() ? null : url;
  });

  previewPos = signal<{ top: number; left: number; above: boolean } | null>(null);
  readonly previewSize = PREVIEW_SIZE;

  // Rendered (previewPos) vs. faded in (previewShown) are separate so the
  // preview can animate both ways: it's added invisible, faded/zoomed in
  // on the next frame, and on close faded out first, removed only after.
  previewShown = signal(false);
  private openTimer: ReturnType<typeof setTimeout> | undefined;
  private removeTimer: ReturnType<typeof setTimeout> | undefined;

  // Mouse hovers open/close it; a touch has no hover, so a tap toggles it
  // instead (and doesn't also count as a tap on whatever row it's in).
  private lastPointerType = 'mouse';

  onPointerDown(e: PointerEvent) {
    this.lastPointerType = e.pointerType;
  }

  // A short delay on hover, so just moving the mouse across a list of
  // avatars doesn't flash a preview up for each one.
  onPointerEnter(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(this.openTimer);
    this.openTimer = setTimeout(() => this.openPreview(), HOVER_DELAY_MS);
  }

  onPointerLeave(e: PointerEvent) {
    if (e.pointerType === 'mouse') this.closePreview();
  }

  // A tap is deliberate - no delay, just the same fade.
  onClick(e: MouseEvent) {
    if (this.lastPointerType === 'mouse' || !this.canPreview()) return;
    e.stopPropagation();
    if (this.previewShown()) this.closePreview();
    else this.openPreview();
  }

  onImageError() {
    this.failedUrl.set(this.photoUrl());
    this.closePreview();
  }

  // A tap anywhere else, or any scrolling (see onAnyScroll), closes an open
  // preview.
  @HostListener('document:click')
  @HostListener('window:resize')
  closePreview() {
    clearTimeout(this.openTimer);
    document.removeEventListener('scroll', this.onAnyScroll, true);
    if (!this.previewPos()) return;
    this.previewShown.set(false);
    clearTimeout(this.removeTimer);
    this.removeTimer = setTimeout(() => this.previewPos.set(null), FADE_MS);
  }

  // Scroll events don't bubble - a capturing listener on the document
  // catches every scrolling element's; only attached while a preview is
  // open.
  private onAnyScroll = () => this.closePreview();

  private canPreview(): boolean {
    return this.preview() && !!this.photoUrl();
  }

  // position: fixed, computed from the avatar's on-screen box - above it
  // when there's room, otherwise below, and nudged sideways to stay fully
  // on screen (it's often inside a sideways-scrolling table). `above` sets
  // which edge it grows out of, so it seems to come from the avatar.
  private openPreview() {
    if (!this.canPreview()) return;
    clearTimeout(this.removeTimer);
    const rect = this.host.nativeElement.getBoundingClientRect();
    const above = rect.top - PREVIEW_SIZE - PREVIEW_GAP >= 0;
    const top = above ? rect.top - PREVIEW_SIZE - PREVIEW_GAP : rect.bottom + PREVIEW_GAP;
    const centered = rect.left + rect.width / 2 - PREVIEW_SIZE / 2;
    const left = Math.min(Math.max(centered, 8), window.innerWidth - PREVIEW_SIZE - 8);
    this.previewPos.set({ top, left, above });
    document.addEventListener('scroll', this.onAnyScroll, { capture: true, passive: true });
    requestAnimationFrame(() => requestAnimationFrame(() => this.previewShown.set(true)));
  }
}
