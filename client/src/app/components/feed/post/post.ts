import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  afterRenderEffect,
  computed,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { usernameKey } from '../../../shared/usernames';
import { PollCard } from '../../poll-card/poll-card';

// Fixed, brand-matched colors instead of per-user hashing: orange for your
// own name, blue for everyone else's (see post.scss for the bubble
// background, which follows the same isOwn split).
const OWN_NAME_COLOR = '#fb8c00';
const OTHER_NAME_COLOR = '#1e88e5';

// How long a finger has to stay on a message (phone) to open its menu.
const LONG_PRESS_MS = 500;

export interface TextPart {
  text: string;
  mention?: boolean;
  me?: boolean;
}

// Splits a message into plain text and "@username" mentions of people who
// really are in this tour. `known` and `me` are usernameKey()s. A dot or
// dash straight after the name ("@Zoli.") isn't part of it.
export function splitMentions(text: string, known: Set<string>, me: string | null): TextPart[] {
  const parts: TextPart[] = [];
  const re = /(^|[^\p{L}\p{N}._-])@([\p{L}\p{N}._-]{3,40})/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let name = m[2];
    while (name && !known.has(usernameKey(name)) && /[._-]$/.test(name)) name = name.slice(0, -1);
    if (!name || !known.has(usernameKey(name))) continue;
    const start = m.index + m[1].length;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: `@${name}`, mention: true, me: !!me && usernameKey(name) === me });
    last = start + 1 + name.length;
    re.lastIndex = last;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

@Component({
  selector: 'app-post',
  standalone: true,
  imports: [MatIconModule, PollCard],
  templateUrl: './post.html',
  styleUrls: ['./post.scss'],
  host: {
    '[class.own]': 'isOwn',
  },
})
export class Post {
  creator = signal<string>('');
  text = signal<string>('');
  timestamp = signal<Date>(new Date());
  imageUrl = signal<string | undefined>(undefined);

  @Input() isOwn = false;

  get nameColor(): string {
    return this.isOwn ? OWN_NAME_COLOR : OTHER_NAME_COLOR;
  }

  @Input({ required: true }) set creatorInput(v: string) {
    this.creator.set(v);
  }

  @Input({ required: true }) set textInput(v: string) {
    this.text.set(v);
  }

  @Input({ required: true }) set timestampInput(v: string | Date) {
    // The server sends an ISO string (createdAt); normalize either way so
    // dayLabel/timeLabel always has a real Date.
    this.timestamp.set(new Date(v));
  }

  @Input() set imageUrlInput(v: string | undefined) {
    this.imageUrl.set(v);
  }

  // "@username" mentions: every username in this tour (lower-cased), and
  // mine - a mention of a real attendee is highlighted, one of me more so.
  private knownUsernames = signal<Set<string>>(new Set());
  private myUsername = signal<string | null>(null);

  @Input() set knownUsernamesInput(v: Set<string> | null) {
    this.knownUsernames.set(v ?? new Set());
  }

  @Input() set myUsernameInput(v: string | null) {
    this.myUsername.set(v);
  }

  textParts = computed(() => splitMentions(this.text(), this.knownUsernames(), this.myUsername()));

  // A poll started in the chat - shown as its live card; managed from the
  // card itself, so no edit/delete here.
  @Input() pollId: string | null = null;

  // Edited afterwards by its author -> "(szerkesztve)" next to the time.
  @Input() edited = false;
  // Deleted by its author -> a "Hozzászólás törölve" placeholder.
  @Input() deleted = false;

  // Own, not deleted posts only (see feed.ts, which sends these to the
  // server - the server itself also only allows the author).
  @Output() editSaved = new EventEmitter<string>();
  @Output() deleteConfirmed = new EventEmitter<void>();

  editing = signal(false);
  draft = signal('');
  confirmingDelete = signal(false);
  askDelete() {
    this.confirmingDelete.set(true);
  }

  // --- Phone: long press -> a menu sliding up from the bottom ---
  // (A phone has no hover, so the date and the edit/delete buttons that sit
  // beside the bubble on a desktop live in this menu instead. Built as a
  // list so more actions can be added later - reply, react...)
  sheetOpen = signal(false);
  sheetConfirmingDelete = signal(false);
  private pressTimer: ReturnType<typeof setTimeout> | undefined;
  private pressStart: { x: number; y: number } | null = null;

  onPointerDown(e: PointerEvent) {
    if (e.pointerType !== 'touch' || this.editing() || this.pollId) return;
    this.pressStart = { x: e.clientX, y: e.clientY };
    clearTimeout(this.pressTimer);
    this.pressTimer = setTimeout(() => {
      this.pressStart = null;
      this.sheetConfirmingDelete.set(false);
      this.sheetOpen.set(true);
      navigator.vibrate?.(15);
    }, LONG_PRESS_MS);
  }

  // Moving the finger (scrolling) is not a long press.
  onPointerMove(e: PointerEvent) {
    if (!this.pressStart) return;
    if (Math.hypot(e.clientX - this.pressStart.x, e.clientY - this.pressStart.y) > 10)
      this.cancelPress();
  }

  cancelPress() {
    clearTimeout(this.pressTimer);
    this.pressStart = null;
  }

  // The phone's own long-press menu (select/copy...) would pop up on top.
  onContextMenu(e: Event) {
    if (this.sheetOpen() || this.pressStart) e.preventDefault();
  }

  closeSheet() {
    this.sheetOpen.set(false);
    this.sheetConfirmingDelete.set(false);
  }

  sheetEdit() {
    this.closeSheet();
    this.startEdit();
  }

  sheetConfirmDelete() {
    this.closeSheet();
    this.deleteConfirmed.emit();
  }

  async copyText() {
    try {
      await navigator.clipboard.writeText(this.text());
    } catch {
      // Clipboard unavailable (old browser / not allowed) - nothing to do.
    }
    this.closeSheet();
  }

  private editBox = viewChild<ElementRef<HTMLTextAreaElement>>('editBox');

  constructor() {
    // Straight into the box, cursor at the end, as soon as it appears.
    afterRenderEffect(() => {
      const el = this.editBox()?.nativeElement;
      if (el && this.editing() && document.activeElement !== el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  startEdit() {
    this.draft.set(this.text());
    this.confirmingDelete.set(false);
    this.editing.set(true);
  }

  cancelEdit() {
    this.editing.set(false);
  }

  saveEdit() {
    const text = this.draft().trim();
    if (!text) return;
    if (text !== this.text()) this.editSaved.emit(text);
    this.editing.set(false);
  }

  // Enter saves (Shift+Enter: new line), Esc cancels - like the compose box.
  onEditKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.saveEdit();
    } else if (e.key === 'Escape') {
      this.cancelEdit();
    }
  }

  confirmDelete() {
    this.confirmingDelete.set(false);
    this.deleteConfirmed.emit();
  }

  // Short, like a messenger - shown as two lines beside the bubble: the day
  // ("ma" today, the Hungarian day name - "kedd" - earlier this week, from
  // Monday; otherwise the date, "szept. 22.", with the year if it wasn't
  // this year), then the time. Intl rather than the date pipe - no
  // Hungarian locale data is registered in the app.
  dayLabel = computed(() => {
    const d = this.timestamp();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - ((startOfToday.getDay() + 6) % 7)); // back to Monday

    if (d >= startOfToday) return 'ma';
    if (d >= startOfWeek) return new Intl.DateTimeFormat('hu-HU', { weekday: 'long' }).format(d);
    return new Intl.DateTimeFormat('hu-HU', {
      year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      month: 'short',
      day: 'numeric',
    }).format(d);
  });

  timeLabel = computed(() =>
    new Intl.DateTimeFormat('hu-HU', { hour: '2-digit', minute: '2-digit' }).format(
      this.timestamp(),
    ),
  );

  // The full date and time, as the short one's tooltip.
  fullTimestamp = computed(() =>
    new Intl.DateTimeFormat('hu-HU', { dateStyle: 'long', timeStyle: 'short' }).format(
      this.timestamp(),
    ),
  );
}
