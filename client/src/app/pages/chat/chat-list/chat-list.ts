import { Component, computed, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ChatOverview, ChatRoomSummary } from '../../../services/chat';
import { Tour, TourService } from '../../../services/tour';

// One line of the list: the general room or a tour's.
interface Row {
  key: string; // 'general' or the tour's id
  title: string;
  year: string | null;
  order: number | null;
  coverUrl: string | null;
  summary: ChatRoomSummary | null;
  startTime: number;
}

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const timeOfDay = new Intl.DateTimeFormat('hu-HU', { hour: '2-digit', minute: '2-digit' });
const dayOfYear = new Intl.DateTimeFormat('hu-HU', { month: 'short', day: 'numeric' });
const fullDate = new Intl.DateTimeFormat('hu-HU', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// The phone's first Kotyogó screen: every chat as a list - "Dumák", a
// search, then three groups under each other: the club's own room
// (Bódorgók), the tours whose chat is open (upcoming, or over for no more
// than two weeks), and the archives - the past tours that were chatted in. Each line: the tour's
// picture with its number, its name and year, the last message (who: what),
// when that was, and how many messages are waiting unread. Tapping one
// opens it (the chat page shows the room then).
@Component({
  selector: 'app-chat-list',
  imports: [MatIconModule, NgTemplateOutlet],
  templateUrl: './chat-list.html',
  styleUrl: './chat-list.scss',
})
export class ChatList {
  private tourService = inject(TourService);

  tours = input.required<Tour[]>();
  // null until it has arrived.
  overview = input.required<ChatOverview | null>();
  // The general room's name (the chat page's).
  generalName = input('Bódorgók');

  pick = output<string>();

  search = signal('');

  generalRow = computed<Row>(() => ({
    key: 'general',
    title: this.generalName(),
    year: null,
    order: null,
    coverUrl: null,
    summary: this.overview()?.general ?? null,
    startTime: 0,
  }));

  private tourRows = computed(() => {
    const byTour = new Map((this.overview()?.tours ?? []).map((t) => [t.tourId, t]));
    return this.tours().map((tour) => ({
      past: byTour.get(tour._id)?.past ?? false,
      // Past, read-only and never written in: nothing will ever be said
      // there - not listed. (The test tour's past chat, still writable, is.)
      silent: !byTour.get(tour._id)?.lastPost && (byTour.get(tour._id)?.closed ?? false),
      row: {
        key: tour._id,
        title: tour.title,
        year: tour.startDate.slice(0, 4),
        order: tour.order,
        coverUrl: this.tourService.coverUrl(tour),
        summary: byTour.get(tour._id) ?? null,
        startTime: new Date(tour.startDate).getTime(),
      } satisfies Row,
    }));
  });

  private matches(row: Row): boolean {
    const needle = plain(this.search().trim());
    return !needle || plain(`${row.order ?? ''} ${row.title} ${row.year ?? ''}`).includes(needle);
  }

  showGeneral = computed(() => this.matches(this.generalRow()));

  // Open chats: the nearest tour first.
  active = computed(() =>
    this.tourRows()
      .filter((t) => !t.past && this.matches(t.row))
      .map((t) => t.row)
      .sort((a, b) => a.startTime - b.startTime),
  );

  // The archive: the past tours that were chatted in (one nobody ever
  // wrote in isn't listed), the latest first.
  archived = computed(() =>
    this.tourRows()
      .filter((t) => t.past && !t.silent && this.matches(t.row))
      .map((t) => t.row)
      .sort((a, b) => b.startTime - a.startTime),
  );

  nothingFound = computed(
    () => !this.showGeneral() && !this.active().length && !this.archived().length,
  );

  // "anna: Holnap indulunk…" - a photo or a poll says what it is.
  lastLine(row: Row): string {
    const post = row.summary?.lastPost;
    if (!post) return 'Még nincs üzenet';
    const what = post.isPoll
      ? `📊 ${post.text || 'Szavazás'}`
      : post.hasImage
        ? `📷 ${post.text || 'Fotó'}`
        : post.text;
    return `${post.author}: ${what}`;
  }

  // Today: the time; this year: the day; before that: the whole date.
  lastTime(row: Row): string {
    const at = row.summary?.lastPost?.createdAt;
    if (!at) return '';
    const when = new Date(at);
    const now = new Date();
    if (when.toDateString() === now.toDateString()) return timeOfDay.format(when);
    return when.getFullYear() === now.getFullYear()
      ? dayOfYear.format(when)
      : fullDate.format(when);
  }
}
