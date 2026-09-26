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

// Someone who can be "@mentioned" in this tour's chat.
export interface Mentionable {
  username: string;
  name: string;
}

const MAX_SUGGESTIONS = 6;
const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

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

  @Output() send = new EventEmitter<{ text: string }>();

  // The "@..." being typed right before the cursor, if any.
  private mentionQuery = signal<{ start: number; query: string } | null>(null);
  highlighted = signal(0);

  suggestions = computed(() => {
    const q = this.mentionQuery();
    if (!q) return [];
    const needle = plain(q.query);
    return this.mentionables()
      .filter((m) => plain(m.username).startsWith(needle) || plain(m.name).split(/\s+/).some((w) => w.startsWith(needle)))
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
    if (!message) return;

    this.send.emit({ text: message });
    this.text.set(''); // Clear textbox
    this.mentionQuery.set(null);
  }
}
