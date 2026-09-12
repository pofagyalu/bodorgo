import { Component } from '@angular/core';
import { Feed } from '../../components/feed/feed';

@Component({
  selector: 'app-chat',
  imports: [Feed],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
})
export class Chat {}
