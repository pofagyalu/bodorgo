import { Component, inject, input, output, signal, viewChild } from '@angular/core';
import { ImageCropperComponent, ImageTransform } from 'ngx-image-cropper';
import { UserService } from '../../services/user';
import { NotificationsService } from '../../notifications/notifications.service';

// The browser does all the resizing: whatever photo is picked (even a
// 12MB phone photo) is cropped to a square the user positions and zooms,
// and exported as a 320x320 JPEG (~30KB) - the only thing ever uploaded.
// 320px is enough for the small avatar circle on a sharp screen and for
// the 160px hover/tap preview (see components/avatar). No server-side
// resizing on purpose: sharp isn't available on the production NAS.
const OUTPUT_SIZE = 320;

export interface PhotoChange {
  photoUpdatedAt: string | null;
  photoSetBy: 'admin' | 'self' | null;
}

// Upload/replace/remove buttons plus the crop dialog. userId null = the
// logged-in user's own photo (Profil page); otherwise an admin editing
// someone else's (member-edit page), which the parent disables via
// `locked` once that person has set their own.
@Component({
  selector: 'app-photo-editor',
  standalone: true,
  imports: [ImageCropperComponent],
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

  private cropper = viewChild(ImageCropperComponent);

  file = signal<File | null>(null);
  ready = signal(false);
  saving = signal(false);
  transform = signal<ImageTransform>({ scale: 1, translateUnit: 'px' });

  onFileChosen(e: Event) {
    const inputEl = e.target as HTMLInputElement;
    const picked = inputEl.files?.[0] ?? null;
    inputEl.value = ''; // picking the same file again should reopen the dialog
    if (!picked) return;
    this.ready.set(false);
    this.transform.set({ scale: 1, translateUnit: 'px' });
    this.file.set(picked);
  }

  setZoom(value: string) {
    this.transform.update((t) => ({ ...t, scale: Number(value) }));
  }

  onLoadFailed() {
    this.file.set(null);
    this.notifications.addError('Ezt a képet nem sikerült megnyitni - válassz JPG vagy PNG képet.');
  }

  cancel() {
    if (this.saving()) return;
    this.file.set(null);
  }

  async save() {
    const cropper = this.cropper();
    if (!cropper || this.saving()) return;
    this.saving.set(true);
    const result = await cropper.crop('blob');
    if (!result?.blob) {
      this.saving.set(false);
      this.notifications.addError('Nem sikerült a képet kivágni.');
      return;
    }
    this.userService.uploadPhoto(this.userId(), result.blob).subscribe({
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

  readonly outputSize = OUTPUT_SIZE;
}
