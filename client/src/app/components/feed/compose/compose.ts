import { Component, Output, EventEmitter, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-compose',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './compose.html',
  styleUrls: ['./compose.scss'],
})
export class Compose {
  text = signal<string>('');

  @Output() send = new EventEmitter<{ text: string }>();

  submit() {
    const message = this.text().trim();
    if (!message) return;

    this.send.emit({ text: message });
    this.text.set(''); // Clear textbox
  }
}
