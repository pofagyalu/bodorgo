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
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../auth/auth.service';
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
  private socket!: Socket;

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
    this.socket = io(environment.apiBaseUrl, { withCredentials: true });

    // Re-join on every (re)connect, not just the first one, so a dropped
    // network connection recovers cleanly instead of silently going stale.
    this.socket.on('connect', () => {
      this.socket.emit('join-tour-chat', { tourId: this.tourId() });
    });

    this.socket.on('initial-posts', (data: IPost[]) => {
      this.posts.set(data);
      this.scrollTrigger.update((n) => n + 1);
    });

    this.socket.on('new-post', (post: IPost) => {
      this.posts.update((p) => [...p, post]);
      if (post.creator._id === this.currentUserId()) {
        this.scrollTrigger.update((n) => n + 1);
      }
    });

    this.socket.on('chat-error', (message: string) => {
      console.error('Chat error:', message);
    });
  }

  onCompose(data: { text: string }) {
    this.socket.emit('create-post', {
      tourId: this.tourId(),
      text: data.text,
    });
  }

  ngOnDestroy() {
    this.socket?.disconnect();
  }
}
