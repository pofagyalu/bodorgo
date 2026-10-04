import { Component, HostListener, inject, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Tour, TourImage, TourService } from '../../../../../services/tour';

// A photo of a tour's album, picked.
export interface PickedTourPhoto {
  tourId: string;
  filename: string;
}

// Móka → Kvíz → the editor: a picture for a question from the tours'
// albums - first the tour (every one of them, the newest first), then one
// of its photos. Laid over the editor; it only says what was picked.
@Component({
  selector: 'app-quiz-photo-picker',
  imports: [MatIconModule],
  templateUrl: './photo-picker.html',
  styleUrl: './photo-picker.scss',
})
export class QuizPhotoPicker {
  private tourService = inject(TourService);

  picked = output<PickedTourPhoto>();
  closed = output<void>();

  // null: still loading.
  tours = signal<Tour[] | null>(null);
  // The tour whose album is open - none: the list of tours.
  tour = signal<Tour | null>(null);
  photos = signal<TourImage[] | null>(null);

  constructor() {
    this.tourService.getTours().subscribe({
      next: (res) =>
        this.tours.set(
          [...res.data.tours].sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate)),
        ),
      error: () => this.tours.set([]),
    });
  }

  year = (tour: Tour) => new Date(tour.startDate).getFullYear();

  open(tour: Tour) {
    this.tour.set(tour);
    this.photos.set(null);
    this.tourService.getTourImages(tour._id).subscribe({
      // A slower answer for an album since left is dropped. A restricted
      // photo can't go into a quiz - everybody would see it.
      next: (res) => {
        if (this.tour() === tour) this.photos.set(res.data.images.filter((p) => !p.restricted));
      },
      error: () => this.photos.set([]),
    });
  }

  back() {
    this.tour.set(null);
  }

  thumbUrl(photo: TourImage): string {
    return this.tourService.tourImageThumbUrl(this.tour()!._id, photo.filename);
  }

  pick(photo: TourImage) {
    this.picked.emit({ tourId: this.tour()!._id, filename: photo.filename });
  }

  @HostListener('document:keydown.escape')
  close() {
    this.closed.emit();
  }
}
