import { Component, HostListener, inject, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin, map, of } from 'rxjs';
import { AuthService } from '../../../../../auth/auth.service';
import { Tour, TourImage, TourService } from '../../../../../services/tour';
import { UserService } from '../../../../../services/user';

import { Loading } from '../../../../../shared/loading/loading';
// A photo of a tour's album, picked.
export interface PickedTourPhoto {
  tourId: string;
  filename: string;
}

// Móka → Kvíz → the editor: a picture for a question from the tours'
// albums - first the tour (the newest first), then one of its photos. Only
// tours that can have photos for the asker: none that hasn't started yet,
// and for a guest only their own (the server wouldn't give them another's
// album - utils/tourMediaAccess.js). Laid over the editor; it only says what was picked.
@Component({
  selector: 'app-quiz-photo-picker',
  imports: [Loading, MatIconModule],
  templateUrl: './photo-picker.html',
  styleUrl: './photo-picker.scss',
})
export class QuizPhotoPicker {
  private tourService = inject(TourService);
  private userService = inject(UserService);
  private auth = inject(AuthService);

  picked = output<PickedTourPhoto>();
  closed = output<void>();

  // null: still loading.
  tours = signal<Tour[] | null>(null);
  // The tour whose album is open - none: the list of tours.
  tour = signal<Tour | null>(null);
  photos = signal<TourImage[] | null>(null);

  constructor() {
    const guest = this.auth.user()?.role === 'guest';
    forkJoin({
      tours: this.tourService.getTours().pipe(map((res) => res.data.tours)),
      mine: guest
        ? this.userService
            .getMyAttendance()
            .pipe(map((res) => new Set(res.data.tours.map((t) => t.tour._id))))
        : of(null),
    }).subscribe({
      next: ({ tours, mine }) => {
        const now = Date.now();
        this.tours.set(
          tours
            .filter((t) => Date.parse(t.startDate) <= now && (!mine || mine.has(t._id)))
            .sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate)),
        );
      },
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
