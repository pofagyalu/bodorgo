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
import { Compose } from './compose/compose';
import { Post } from './post/post';

interface IPost {
  _id: string;
  creator: { _id: string; name: string; username?: string };
  text: string;
  image?: string;
  createdAt: string;
  updatedAt: string;
  tourId: string;
  editedAt?: string;
  deletedAt?: string;
}

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [Compose, Post],
  templateUrl: './feed.html',
  styleUrls: ['./feed.scss'],
})
export class Feed implements OnInit, OnDestroy {
  private authService = inject(AuthService);

  tourId = input.required<string>();
  currentUserId = computed(() => this.authService.user()?.id);

  posts = signal<IPost[]>([]);
  private tourSocket = inject(TourSocketService);
  private unsubscribers: (() => void)[] = [];

  private feedContainer = viewChild<ElementRef<HTMLDivElement>>('feedContainer');

  // Bumped when the chat history first loads (landing on the page should
  // show the latest message) and whenever *I* post something - but not on
  // incoming posts from others, so the view doesn't get yanked out from
  // under someone reading older messages when others post.
  private scrollTrigger = signal(0);

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
  }

  onCompose(data: { text: string }) {
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

  ngOnDestroy() {
    this.unsubscribers.forEach((off) => off());
  }
}
