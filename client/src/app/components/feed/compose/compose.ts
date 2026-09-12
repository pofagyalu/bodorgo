import {
  Component,
  Output,
  EventEmitter,
  signal,
  viewChild,
  afterRenderEffect,
  ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-compose',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  templateUrl: './compose.html',
  styleUrls: ['./compose.scss'],
})
export class Compose {
  text = signal<string>('');

  private messageInput = viewChild<ElementRef<HTMLTextAreaElement>>('messageInput');

  @Output() send = new EventEmitter<{ text: string }>();

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

  onEnter(event: Event) {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.shiftKey) return; // Shift+Enter still inserts a newline
    event.preventDefault();
    this.submit();
  }

  submit() {
    const message = this.text().trim();
    if (!message) return;

    this.send.emit({ text: message });
    this.text.set(''); // Clear textbox
  }
}
