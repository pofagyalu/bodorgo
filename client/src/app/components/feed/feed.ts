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
  creator: { _id: string; name: string };
  text: string;
  image?: string;
  createdAt: string;
  updatedAt: string;
  tourId: string;
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

  ngOnDestroy() {
    this.unsubscribers.forEach((off) => off());
  }
}
