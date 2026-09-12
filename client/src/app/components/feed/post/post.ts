import { Component, Input, signal, computed } from '@angular/core';

@Component({
  selector: 'app-post',
  standalone: true,
  templateUrl: './post.html',
  styleUrls: ['./post.scss'],
})
export class Post {
  creator = signal<string>('');
  text = signal<string>('');
  timestamp = signal<Date>(new Date());
  imageUrl = signal<string | undefined>(undefined);

  @Input({ required: true }) set creatorInput(v: string) {
    this.creator.set(v);
  }

  @Input({ required: true }) set textInput(v: string) {
    this.text.set(v);
  }

  @Input({ required: true }) set timestampInput(v: Date) {
    this.timestamp.set(v);
  }

  @Input() set imageUrlInput(v: string | undefined) {
    this.imageUrl.set(v);
  }

  readableTimestamp = computed(() => this.timestamp().toLocaleString());
}
