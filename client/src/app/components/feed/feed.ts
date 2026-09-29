import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  input,
  signal,
  computed,
  viewChild,
  afterRenderEffect,
  ElementRef,
} from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { TourSocketService } from '../../services/tour-socket';
import { Compose, Mentionable } from './compose/compose';
import { ChatBackground, TourService } from '../../services/tour';
import { MatIconModule } from '@angular/material/icon';
import { Post, Reaction } from './post/post';
import { PollCreate } from '../poll-create/poll-create';
import { usernameKey } from '../../shared/usernames';
import { NotificationsService } from '../../notifications/notifications.service';

interface IPost {
  _id: string;
  creator: { _id: string; name: string; username?: string };
  text: string;
  // A photo sent with it (see server chat/chatImages.js) - expired: the
  // size quota removed it, the message shows it's no longer available.
  image?: { width: number; height: number; expired?: boolean } | null;
  createdAt: string;
  updatedAt: string;
  tourId: string;
  editedAt?: string;
  deletedAt?: string;
  // A poll started in the chat (see components/poll-card).
  poll?: string | null;
  // Hangulatjelek, one per person (see post.ts).
  reactions?: Reaction[];
}

function dayBreakLabel(d: Date): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfToday.getDate() - ((startOfToday.getDay() + 6) % 7)); // back to Monday

  const weekday = new Intl.DateTimeFormat('hu-HU', { weekday: 'long' }).format(d);
  if (d >= startOfToday) return 'ma';
  if (d >= startOfWeek) return weekday;
  const date = new Intl.DateTimeFormat('hu-HU', {
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    month: 'short',
    day: 'numeric',
  }).format(d);
  return `${weekday}, ${date}`;
}

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [Compose, Post, PollCreate, MatIconModule],
  templateUrl: './feed.html',
  styleUrls: ['./feed.scss'],
})
export class Feed implements OnInit, OnDestroy {
  private authService = inject(AuthService);

  tourId = input.required<string>();
  currentUserId = computed(() => this.authService.user()?.id);

  posts = signal<IPost[]>([]);
  // The "Új szavazás" form (the 📊 button in compose).
  creatingPoll = signal(false);
  private tourSocket = inject(TourSocketService);
  private tourService = inject(TourService);

  // The tour's attendees with their usernames (from the Szobabeosztás
  // board's list) - for "@" suggestions and for highlighting mentions.
  private people = signal<{ userId: string | null; name: string; username: string | null }[]>([]);
  mentionables = computed<Mentionable[]>(() =>
    this.people()
      .filter((p) => p.username && p.userId !== this.currentUserId())
      .map((p) => ({ username: p.username!, name: p.name })),
  );
  // Compared without case or accents ("@bela" is Béla) - see usernameKey.
  knownUsernames = computed(
    () => new Set(this.people().flatMap((p) => (p.username ? [usernameKey(p.username)] : []))),
  );
  myUsername = computed(() => {
    const mine = this.people().find((p) => p.userId === this.currentUserId())?.username;
    return mine ? usernameKey(mine) : null;
  });
  private unsubscribers: (() => void)[] = [];

  // A day's first message gets the day above it, centered: "ma", the day
  // name this week ("péntek", from Monday), else with the date too
  // ("péntek, okt. 9." - and the year if it wasn't this year).
  dayBreaks = computed(() => {
    const breaks = new Map<string, string>();
    let lastDay = '';
    for (const post of this.posts()) {
      const d = new Date(post.createdAt);
      const day = d.toDateString();
      if (day !== lastDay) breaks.set(post._id, dayBreakLabel(d));
      lastDay = day;
    }
    return breaks;
  });

  private feedContainer = viewChild<ElementRef<HTMLDivElement>>('feedContainer');

  // Bumped when the chat history first loads (landing on the page should
  // show the latest message) and whenever *I* post something - but not on
  // incoming posts from others, so the view doesn't get yanked out from
  // under someone reading older messages when others post.
  private scrollTrigger = signal(0);

  // The chat's background: this week's pale photo from the tour's album
  // (the server bakes the paleness in), or the plain one if it has none.
  // Admins can switch to another one for the rest of the week.
  private background = signal<ChatBackground | null>(null);
  backgroundImage = computed(() => {
    const b = this.background();
    return b ? `url("${this.tourService.chatBackgroundUrl(this.tourId(), b)}")` : null;
  });
  isAdmin = computed(() => this.authService.user()?.role === 'admin');
  switchingBackground = signal(false);

  private loadBackground() {
    this.tourService.getChatBackground(this.tourId()).subscribe({
      next: (res) => this.background.set(res.data.background),
      error: () => {},
    });
  }

  nextBackground() {
    if (this.switchingBackground()) return;
    this.switchingBackground.set(true);
    this.tourService.nextChatBackground(this.tourId()).subscribe({
      next: (res) => {
        this.background.set(res.data.background);
        this.switchingBackground.set(false);
      },
      error: (err) => {
        this.switchingBackground.set(false);
        this.notifications.addError(err?.error?.message ?? 'Nem sikerült hátteret váltani.');
      },
    });
  }

  constructor() {
    // A plain effect() can fire before the newly-added <app-post> child
    // component has actually rendered/laid out its content, so scrollHeight
    // gets read too early and the scroll lands short. afterRenderEffect is
    // guaranteed to run only once the whole tree has actually painted.
    afterRenderEffect(() => {
      this.scrollTrigger();
      const el = this.feedContainer()?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  ngOnInit() {
    this.loadBackground();
    // The shared connection (see TourSocketService) - events are checked
    // against this feed's own tour, since the same connection may just
    // have switched over from another tour.
    this.unsubscribers = [
      this.tourSocket.on<{ tourId: string; posts: IPost[] }>('initial-posts', (data) => {
        if (data.tourId !== this.tourId()) return;
        this.posts.set(data.posts);
        this.scrollTrigger.update((n) => n + 1);
      }),
      this.tourSocket.on<IPost>('new-post', (post) => {
        if (String(post.tourId) !== this.tourId()) return;
        this.posts.update((p) => [...p, post]);
        if (post.creator._id === this.currentUserId()) {
          this.scrollTrigger.update((n) => n + 1);
        }
      }),
      // Someone edited or deleted a post - swap in the new version.
      this.tourSocket.on<IPost>('post-updated', (post) => {
        if (String(post.tourId) !== this.tourId()) return;
        this.posts.update((list) => list.map((p) => (p._id === post._id ? post : p)));
      }),
      this.tourSocket.on<string>('chat-error', (message) => console.error('Chat error:', message)),
    ];
    this.tourSocket.joinTour(this.tourId());

    this.tourService.getRoomBoard(this.tourId()).subscribe({
      next: (res) => {
        // One entry per person, even if they're on two reservations.
        const byUser = new Map(res.data.people.map((p) => [p.userId ?? p.attendeeId, p]));
        this.people.set(
          [...byUser.values()].map((p) => ({
            userId: p.userId,
            name: p.name,
            username: p.username,
          })),
        );
      },
      error: () => {}, // no suggestions/highlighting - the chat itself still works
    });
  }

  // A photo goes as an upload (the server then announces the message over
  // the socket like any other); plain text straight over the socket.
  sendingPhoto = signal(false);

  chatThumb(postId: string): string {
    return this.tourService.chatImageThumbUrl(this.tourId(), postId);
  }

  chatFull(postId: string): string {
    return this.tourService.chatImageUrl(this.tourId(), postId);
  }
  private notifications = inject(NotificationsService);

  onCompose(data: { text: string; image?: Blob }) {
    if (data.image) {
      this.sendingPhoto.set(true);
      this.tourService.sendChatImage(this.tourId(), data.image, data.text).subscribe({
        next: () => this.sendingPhoto.set(false),
        error: (err) => {
          this.sendingPhoto.set(false);
          this.notifications.addError(err?.error?.message ?? 'A fotót nem sikerült elküldeni.');
        },
      });
      return;
    }
    this.tourSocket.emit('create-post', {
      tourId: this.tourId(),
      text: data.text,
    });
  }

  // Own posts only - the server checks it too, and answers everyone in the
  // tour with 'post-updated'.
  onEdit(postId: string, text: string) {
    this.tourSocket.emit('edit-post', { postId, text });
  }

  onDelete(postId: string) {
    this.tourSocket.emit('delete-post', { postId });
  }

  // Mine on anyone's message - the same one again takes it back.
  onReact(postId: string, emoji: string) {
    this.tourSocket.emit('react-post', { postId, emoji });
  }

  ngOnDestroy() {
    this.unsubscribers.forEach((off) => off());
  }
}
