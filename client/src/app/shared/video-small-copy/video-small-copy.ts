import { Component, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SmallCopyJob } from '../../services/video-copies';
import { ConfirmService } from '../confirm-dialog/confirm.service';

// An admin's line under a video card: whether the video has its small copy
// (see services/video-copies.ts), a button to have it made, how far its
// conversion is, and a way to stop or remove it. Used on Média → Videók
// and the tour page.
@Component({
  selector: 'app-video-small-copy',
  imports: [MatIconModule],
  templateUrl: './video-small-copy.html',
  styleUrl: './video-small-copy.scss',
})
export class VideoSmallCopy {
  job = input.required<SmallCopyJob>();

  convert = output<void>();
  remove = output<void>();

  private confirm = inject(ConfirmService);

  async askRemove() {
    const going = this.job().state !== 'ready';
    const ok = await this.confirm.ask({
      message: going ? 'Megszakítod a tömörítést?' : 'Törlöd a tömörített változatot?',
      detail: going
        ? undefined
        : 'Az eredeti videó megmarad, és újra az indul el. A tömörített változat bármikor újra elkészíthető.',
      confirmText: going ? 'Megszakítás' : 'Törlés',
    });
    if (ok) this.remove.emit();
  }
}
