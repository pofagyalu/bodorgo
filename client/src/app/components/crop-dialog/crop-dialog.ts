import { Component, input, output, signal, viewChild } from '@angular/core';
import { ImageCropperComponent, ImageTransform } from 'ngx-image-cropper';

// The shared "position and zoom your picture" dialog - a fixed-shape frame
// the user drags/zooms the picked image into, exported as a JPEG exactly
// outputWidth wide (never enlarged beyond the original). Everything
// happens in the browser, so only that small result is ever uploaded -
// no server-side resizing on purpose (sharp isn't available on the
// production NAS). Used for profile photos (1:1, 320px - see
// photo-editor) and tour covers (3:2, 1000px - see tour-edit).
@Component({
  selector: 'app-crop-dialog',
  standalone: true,
  imports: [ImageCropperComponent],
  templateUrl: './crop-dialog.html',
  styleUrl: './crop-dialog.scss',
})
export class CropDialog {
  file = input.required<File>();
  title = input('Kép kivágása');
  aspectRatio = input(1);
  outputWidth = input(320);
  // Set by the parent while it uploads the result - keeps the dialog open
  // with its buttons disabled until that's done.
  busy = input(false);

  cropped = output<Blob>();
  cancelled = output<void>();
  failed = output<void>();

  private cropper = viewChild(ImageCropperComponent);

  ready = signal(false);
  cropping = signal(false);
  transform = signal<ImageTransform>({ scale: 1, translateUnit: 'px' });

  setZoom(value: string) {
    this.transform.update((t) => ({ ...t, scale: Number(value) }));
  }

  cancel() {
    if (this.busy() || this.cropping()) return;
    this.cancelled.emit();
  }

  async confirm() {
    const cropper = this.cropper();
    if (!cropper || this.busy() || this.cropping()) return;
    this.cropping.set(true);
    const result = await cropper.crop('blob');
    this.cropping.set(false);
    if (result?.blob) this.cropped.emit(result.blob);
    else this.failed.emit();
  }
}
