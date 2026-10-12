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
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../auth/auth.service';
import { TourSocketService } from '../../services/tour-socket';
import { Compose, Mentionable } from './compose/compose';
import { ChatBackground, TourService } from '../../services/tour';
import { ChatService } from '../../services/chat';
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
  chatRoomId: string;
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

// How far below the top of the view the "Új üzenetek" line sits when a
// chat opens at it.
const UNREAD_TOP_GAP_PX = 12;

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [Compose, Post, PollCreate, MatIconModule],
  templateUrl: './feed.html',
  styleUrls: ['./feed.scss'],
})
export class Feed implements OnInit, OnDestroy {
  private authService = inject(AuthService);

  // The chat room shown (see ChatService), and its tour - null for the
  // general room (no background; everyone can be "@"-mentioned there).
  chatRoomId = input.required<string>();
  tourId = input<string | null>(null);
  // A past tour's chat: an archive - no message field.
  readOnly = input(false);
  // What stands in the message field's place then - when it isn't the
  // usual "this chat is over" (the general room before it opens).
  closedNote = input<string | null>(null);
  currentUserId = computed(() => this.authService.user()?.id);

  posts = signal<IPost[]>([]);
  // The "Új szavazás" form (the 📊 button in compose).
  creatingPoll = signal(false);
  private tourSocket = inject(TourSocketService);
  private tourService = inject(TourService);
  private chatService = inject(ChatService);

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
  private unreadBreak = viewChild<ElementRef<HTMLElement>>('unreadBreak');

  // The first message that arrived since I last had this chat open (the
  // server says when that was) - the chat opens there, under an "Új
  // üzenetek" line, instead of at the very end. null: nothing new.
  firstUnreadId = signal<string | null>(null);

  // Bumped when the chat history first loads (landing on the page should
  // show the latest message) and whenever *I* post something - but not on
  // incoming posts from others, so the view doesn't get yanked out from
  // under someone reading older messages when others post.
  private scrollTrigger = signal(0);
  // The next scroll goes to the "Új üzenetek" line rather than the end.
  private toUnreadNext = false;

  // The chat's background: this week's pale photo from the tour's album
  // (the server bakes the paleness in), or the plain one if it has none.
  // Admins can switch to another one for the rest of the week (the button
  // is on the chat page - chat.html's chatTools).
  private background = signal<ChatBackground | null>(null);
  backgroundImage = computed(() => {
    const b = this.background();
    const tourId = this.tourId();
    return b && tourId ? `url("${this.tourService.chatBackgroundUrl(tourId, b)}")` : null;
  });
  switchingBackground = signal(false);

  private loadBackground() {
    const tourId = this.tourId();
    if (!tourId) return;
    this.tourService.getChatBackground(tourId).subscribe({
      next: (res) => this.background.set(res.data.background),
      error: () => {},
    });
  }

  nextBackground() {
    if (this.switchingBackground()) return;
    this.switchingBackground.set(true);
    const tourId = this.tourId();
    if (!tourId) return;
    this.tourService.nextChatBackground(tourId).subscribe({
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
      if (!el) return;
      // On opening: to the first unread message, if there is one (its
      // line at the top of the view); otherwise - and after my own
      // message - to the end.
      const unread = this.toUnreadNext ? this.unreadBreak()?.nativeElement : null;
      this.toUnreadNext = false;
      if (unread) {
        const offset = unread.getBoundingClientRect().top - el.getBoundingClientRect().top;
        el.scrollTop += offset - UNREAD_TOP_GAP_PX;
      } else {
        el.scrollTop = el.scrollHeight;
      }
    });

    // The search bar just opened: the cursor into its field.
    afterRenderEffect(() => {
      if (this.searching()) this.searchInput()?.nativeElement.focus();
    });

    // The hit shown: into the middle of the view.
    afterRenderEffect(() => {
      const id = this.currentHit();
      const container = this.feedContainer()?.nativeElement;
      if (!id || !container) return;
      container.querySelector(`#post-${id}`)?.scrollIntoView?.({ block: 'center' });
    });
  }

  ngOnInit() {
    this.loadBackground();
    // The shared connection (see TourSocketService) - events are checked
    // against this feed's own room, since the same connection may just
    // have switched over from another one.
    this.unsubscribers = [
      this.tourSocket.on<{ chatRoomId: string; posts: IPost[]; readAt?: string | null }>(
        'initial-posts',
        (data) => {
          if (data.chatRoomId !== this.chatRoomId()) return;
          this.posts.set(data.posts);
          // Others' messages since I was last here. (Never here before:
          // no line - the chat just opens at its end.)
          const readAt = data.readAt ? new Date(data.readAt).getTime() : null;
          const firstUnread =
            readAt === null
              ? undefined
              : data.posts.find(
                  (p) =>
                    !p.deletedAt &&
                    p.creator._id !== this.currentUserId() &&
                    new Date(p.createdAt).getTime() > readAt,
                );
          this.firstUnreadId.set(firstUnread?._id ?? null);
          this.toUnreadNext = !!firstUnread;
          this.scrollTrigger.update((n) => n + 1);
        },
      ),
      this.tourSocket.on<IPost>('new-post', (post) => {
        if (String(post.chatRoomId) !== this.chatRoomId()) return;
        this.posts.update((p) => [...p, post]);
        if (post.creator._id === this.currentUserId()) {
          this.scrollTrigger.update((n) => n + 1);
        }
      }),
      // Someone edited or deleted a post - swap in the new version.
      this.tourSocket.on<IPost>('post-updated', (post) => {
        if (String(post.chatRoomId) !== this.chatRoomId()) return;
        this.posts.update((list) => list.map((p) => (p._id === post._id ? post : p)));
      }),
      this.tourSocket.on<string>('chat-error', (message) => console.error('Chat error:', message)),
    ];
    this.tourSocket.joinChat(this.chatRoomId());

    // Who can be "@"-mentioned: a tour's attendees, or in the general room
    // everyone.
    const tourId = this.tourId();
    if (!tourId) {
      this.chatService.getGeneralPeople().subscribe({
        next: (res) => this.people.set(res.data.people),
        error: () => {}, // no suggestions/highlighting - the chat itself still works
      });
      return;
    }
    this.tourService.getRoomBoard(tourId).subscribe({
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

  // --- Search: this chat's own messages (the whole history is here) ---

  // The search bar is open (the magnifier among the chat's buttons -
  // chat.html's chatTools).
  searching = signal(false);
  searchQuery = signal('');
  private searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  // The messages that have the words searched for - in their text or in
  // their writer's name; no upper/lower case, no accents ("tura" finds
  // "túra"). From two letters on; deleted messages have nothing to find.
  searchHits = computed<string[]>(() => {
    const query = usernameKey(this.searchQuery().trim());
    if (!this.searching() || query.length < 2) return [];
    return this.posts()
      .filter(
        (p) =>
          !p.deletedAt &&
          usernameKey(`${p.text} ${p.creator.username ?? ''} ${p.creator.name}`).includes(query),
      )
      .map((p) => p._id);
  });
  private searchHitSet = computed(() => new Set(this.searchHits()));
  // Which hit is shown, counted back from the newest (0 = the newest).
  private searchStep = signal(0);
  currentHit = computed<string | null>(() => {
    const hits = this.searchHits();
    return hits.length ? hits[hits.length - 1 - (this.searchStep() % hits.length)] : null;
  });
  // "3 / 12" - the newest is 1.
  searchPosition = computed(() => (this.searchStep() % (this.searchHits().length || 1)) + 1);

  isSearchHit(postId: string): boolean {
    return this.searchHitSet().has(postId);
  }

  toggleSearch() {
    if (this.searching()) this.closeSearch();
    else this.searching.set(true);
  }

  closeSearch() {
    this.searching.set(false);
    this.searchQuery.set('');
    this.searchStep.set(0);
  }

  onSearchInput(value: string) {
    this.searchQuery.set(value);
    this.searchStep.set(0); // a new search starts at the newest hit
  }

  // To the hit before this one (older: +1) or after it (newer: -1) - round
  // and round.
  stepSearch(older: 1 | -1) {
    const count = this.searchHits().length;
    if (count) this.searchStep.update((step) => (step + older + count) % count);
  }

  // A photo goes as an upload (the server then announces the message over
  // the socket like any other); plain text straight over the socket.
  sendingPhoto = signal(false);

  chatThumb(postId: string): string {
    return this.chatService.chatImageThumbUrl(this.chatRoomId(), postId);
  }

  chatFull(postId: string): string {
    return this.chatService.chatImageUrl(this.chatRoomId(), postId);
  }
  private notifications = inject(NotificationsService);

  onCompose(data: { text: string; image?: Blob }) {
    if (data.image) {
      this.sendingPhoto.set(true);
      this.chatService.sendChatImage(this.chatRoomId(), data.image, data.text).subscribe({
        next: () => this.sendingPhoto.set(false),
        error: (err) => {
          this.sendingPhoto.set(false);
          this.notifications.addError(err?.error?.message ?? 'A fotót nem sikerült elküldeni.');
        },
      });
      return;
    }
    this.tourSocket.emit('create-post', {
      chatRoomId: this.chatRoomId(),
      text: data.text,
    });
  }

  // Own posts only - the server checks it too, and answers everyone in the
  // room with 'post-updated'.
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
    this.tourSocket.leaveChat(this.chatRoomId());
  }
}
