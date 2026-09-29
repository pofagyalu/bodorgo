import {
  Component,
  Output,
  EventEmitter,
  signal,
  viewChild,
  afterRenderEffect,
  ElementRef,
  computed,
  input,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { shrinkImage } from '../../../shared/image-resize';

// Someone who can be "@mentioned" in this tour's chat.
export interface Mentionable {
  username: string;
  name: string;
}

const MAX_SUGGESTIONS = 6;
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

@Component({
  selector: 'app-compose',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  templateUrl: './compose.html',
  styleUrls: ['./compose.scss'],
})
export class Compose {
  text = signal<string>('');

  // The tour's attendees with a username (not me) - typing "@" suggests them.
  mentionables = input<Mentionable[]>([]);

  private messageInput = viewChild<ElementRef<HTMLTextAreaElement>>('messageInput');

  // image: a photo picked with the 📷 button, already shrunk (see
  // shared/image-resize.ts) - sent by the chat as an upload, not over the socket.
  @Output() send = new EventEmitter<{ text: string; image?: Blob }>();
  // True while the chat uploads a photo - the send button waits.
  sending = input(false);

  // The photo about to be sent, with a preview URL for the thumbnail.
  photo = signal<{ blob: Blob; url: string } | null>(null);
  photoError = signal<string | null>(null);

  async pickPhoto(event: Event) {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = ''; // picking the same file again still triggers change
    if (!file) return;
    this.photoError.set(null);
    try {
      const blob = await shrinkImage(file);
      this.removePhoto();
      this.photo.set({ blob, url: URL.createObjectURL(blob) });
    } catch {
      this.photoError.set('Ez a fájl nem olvasható képként.');
    }
  }

  removePhoto() {
    const p = this.photo();
    if (p) URL.revokeObjectURL(p.url);
    this.photo.set(null);
  }
  // The 📊 button - the chat opens the "Új szavazás" form.
  @Output() pollRequested = new EventEmitter<void>();

  // The "@..." being typed right before the cursor, if any.
  private mentionQuery = signal<{ start: number; query: string } | null>(null);
  highlighted = signal(0);
  // The message field has the focus - on a phone the 📷/📊 buttons step
  // aside meanwhile, so the field gets the whole row (compose.scss).
  typing = signal(false);

  suggestions = computed(() => {
    const q = this.mentionQuery();
    if (!q) return [];
    const needle = plain(q.query);
    return this.mentionables()
      .filter(
        (m) =>
          plain(m.username).startsWith(needle) ||
          plain(m.name)
            .split(/\s+/)
            .some((w) => w.startsWith(needle)),
      )
      .slice(0, MAX_SUGGESTIONS);
  });

  constructor() {
    // Grows the textarea to fit its content (and shrinks it back once
    // cleared) instead of letting long text scroll off to the left the way
    // a plain <input> would. Reacts to text() and runs after render so the
    // DOM already has the up-to-date value when scrollHeight is read - same
    // timing issue afterRenderEffect solves in feed.ts.
    afterRenderEffect(() => {
      this.text();
      const el = this.messageInput()?.nativeElement;
      if (el) {
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      }
    });
  }

  onTextChange(value: string) {
    this.text.set(value);
    this.updateMentionQuery();
  }

  // Looks for "@abc" right before the cursor (at the start, or after a
  // space/line break).
  updateMentionQuery() {
    const el = this.messageInput()?.nativeElement;
    if (!el) return;
    const before = this.text().slice(0, el.selectionStart ?? this.text().length);
    const m = /(^|\s)@([\p{L}\p{N}._-]*)$/u.exec(before);
    this.mentionQuery.set(m ? { start: before.length - m[2].length - 1, query: m[2] } : null);
    this.highlighted.set(0);
  }

  pick(m: Mentionable) {
    const q = this.mentionQuery();
    const el = this.messageInput()?.nativeElement;
    if (!q || !el) return;
    const text = this.text();
    const end = q.start + 1 + q.query.length;
    const inserted = `@${m.username} `;
    this.text.set(text.slice(0, q.start) + inserted + text.slice(end));
    this.mentionQuery.set(null);
    const caret = q.start + inserted.length;
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  // Arrow keys / Enter / Tab / Esc steer the suggestion list while it's open.
  onKeydown(event: KeyboardEvent) {
    const list = this.suggestions();
    if (list.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.highlighted.set((this.highlighted() + step + list.length) % list.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        this.pick(list[this.highlighted()]);
        return;
      }
      if (event.key === 'Escape') {
        this.mentionQuery.set(null);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      // Shift+Enter still inserts a newline
      event.preventDefault();
      this.submit();
    }
  }

  submit() {
    const message = this.text().trim();
    const photo = this.photo();
    if ((!message && !photo) || this.sending()) return;

    this.send.emit({ text: message, image: photo?.blob });
    this.text.set(''); // Clear textbox
    this.removePhoto();
    this.mentionQuery.set(null);
  }
}
