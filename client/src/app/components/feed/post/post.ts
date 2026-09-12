import { Component, Input, signal, computed } from '@angular/core';

// Fixed, brand-matched colors instead of per-user hashing: orange for your
// own name, blue for everyone else's (see post.scss for the bubble
// background, which follows the same isOwn split).
const OWN_NAME_COLOR = '#fb8c00';
const OTHER_NAME_COLOR = '#1e88e5';

@Component({
  selector: 'app-post',
  standalone: true,
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
    // readableTimestamp's .toLocaleString() call always has a real Date.
    this.timestamp.set(new Date(v));
  }

  @Input() set imageUrlInput(v: string | undefined) {
    this.imageUrl.set(v);
  }

  readableTimestamp = computed(() => {
    const d = this.timestamp();
    const includeYear = d.getFullYear() !== new Date().getFullYear();
    const date = new Intl.DateTimeFormat('hu-HU', {
      year: includeYear ? 'numeric' : undefined,
      month: 'short',
      day: 'numeric',
    }).format(d);
    const time = new Intl.DateTimeFormat('hu-HU', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
    return `${date} ${time}`;
  });
}
