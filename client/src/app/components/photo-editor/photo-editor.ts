import { Component, inject, input, output, signal } from '@angular/core';
import { UserService } from '../../services/user';
import { NotificationsService } from '../../notifications/notifications.service';
import { CropDialog } from '../crop-dialog/crop-dialog';

// 320px square is enough for the small avatar circle on a sharp screen and
// for the 160px hover/tap preview (see components/avatar).
const OUTPUT_SIZE = 320;

export interface PhotoChange {
  photoUpdatedAt: string | null;
  photoSetBy: 'admin' | 'self' | null;
}

// Upload/replace/remove buttons for a profile photo. Picking a photo opens
// the shared crop dialog (square frame), and only its 320x320 JPEG result
// is uploaded. userId null = the logged-in user's own photo (Profil page);
// otherwise an admin editing someone else's (member-edit page), which the
// parent disables via `locked` once that person has set their own.
@Component({
  selector: 'app-photo-editor',
  standalone: true,
  imports: [CropDialog],
  templateUrl: './photo-editor.html',
  styleUrl: './photo-editor.scss',
})
export class PhotoEditor {
  private userService = inject(UserService);
  private notifications = inject(NotificationsService);

  userId = input<string | null>(null);
  hasPhoto = input(false);
  locked = input(false);
  changed = output<PhotoChange>();

  readonly outputSize = OUTPUT_SIZE;

  file = signal<File | null>(null);
  saving = signal(false);

  onFileChosen(e: Event) {
    const inputEl = e.target as HTMLInputElement;
    const picked = inputEl.files?.[0] ?? null;
    inputEl.value = ''; // picking the same file again should reopen the dialog
    if (picked) this.file.set(picked);
  }

  onLoadFailed() {
    this.file.set(null);
    this.notifications.addError('Ezt a képet nem sikerült megnyitni - válassz JPG vagy PNG képet.');
  }

  upload(photo: Blob) {
    this.saving.set(true);
    this.userService.uploadPhoto(this.userId(), photo).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.file.set(null);
        this.changed.emit(res.data);
        this.notifications.addSuccess('Profilkép mentve');
      },
      error: (err) => {
        this.saving.set(false);
        this.notifications.addError(err?.error?.message ?? 'Nem sikerült menteni a profilképet.');
      },
    });
  }

  remove() {
    if (this.saving()) return;
    this.saving.set(true);
    this.userService.deletePhoto(this.userId()).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.changed.emit(res.data);
        this.notifications.addSuccess('Profilkép törölve');
      },
      error: (err) => {
        this.saving.set(false);
        this.notifications.addError(err?.error?.message ?? 'Nem sikerült törölni a profilképet.');
      },
    });
  }
}
