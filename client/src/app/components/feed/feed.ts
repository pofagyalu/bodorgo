import { Component, signal, OnInit, OnDestroy } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Compose } from './compose/compose';
import { Post } from './post/post';

interface IPost {
  id: string;
  creator: string;
  text: string;
  image?: string;
  createdAt: Date;
  updatedAt: Date;
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
  posts = signal<IPost[]>([]);
  private socket!: Socket;

  ngOnInit() {
    this.socket = io('http://localhost:8235');

    this.socket.on('initial-posts', (data: IPost[]) => {
      const converted = data.map((p) => ({
        ...p,
        timestamp: new Date(p.createdAt),
      }));

      this.posts.set(converted);
    });

    this.socket.on('new-post', (post: IPost) => {
      const converted = {
        ...post,
        timestamp: new Date(post.createdAt),
      };

      this.posts.update((p) => [...p, converted]);
    });
  }

  onCompose(data: { text: string }) {
    this.socket.emit('create-post', {
      text: data.text,
      creator: 'Me', // You can replace this with actual user
      timestamp: new Date().toISOString(),
    });
  }

  ngOnDestroy() {
    this.socket?.disconnect();
  }
}
