import { Component, computed, inject, input, output, signal, effect } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TourService, AccommodationHouse } from '../../../services/tour';
import { NotificationsService } from '../../../notifications/notifications.service';

function copyHouses(houses: AccommodationHouse[] | undefined): AccommodationHouse[] {
  return (houses ?? []).map((h) => ({ ...h, rooms: h.rooms.map((r) => ({ ...r })) }));
}

// The tour's Szállás - houses -> rooms -> number of places - on the tour
// edit page, with its own save button: the tour itself is usually created
// long before its rooms are known, so the two are saved separately.
// Existing houses/rooms keep their _id through edits (see
// accommodationController.js), which the Szobabeosztás relies on.
@Component({
  selector: 'app-accommodation-editor',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './accommodation-editor.html',
  styleUrl: './accommodation-editor.scss',
})
export class AccommodationEditor {
  private tourService = inject(TourService);
  private notifications = inject(NotificationsService);

  tourId = input.required<string>();
  initialHouses = input<AccommodationHouse[] | undefined>([]);
  // The tour's own "Max létszám" - only for the "fewer places than people"
  // warning, never a hard limit.
  maxCapacity = input<number | null>(null);
  saved = output<AccommodationHouse[]>();

  houses = signal<AccommodationHouse[]>([]);
  saving = signal(false);
  dirty = signal(false);
  // Set on a save attempt, so empty names only show up red after the
  // admin has actually tried to save, not while still typing.
  showErrors = signal(false);

  constructor() {
    // (Re)loaded whenever the parent hands over the tour's saved state.
    effect(() => {
      this.houses.set(copyHouses(this.initialHouses()));
      this.dirty.set(false);
    });
  }

  totals = computed(() => {
    const houses = this.houses();
    const rooms = houses.flatMap((h) => h.rooms);
    return {
      houses: houses.length,
      rooms: rooms.length,
      beds: rooms.reduce((sum, r) => sum + (Number(r.beds) || 0), 0),
    };
  });

  tooFewBeds = computed(() => {
    const max = this.maxCapacity();
    return !!max && this.totals().rooms > 0 && this.totals().beds < max;
  });

  private hasInvalid = computed(() =>
    this.houses().some(
      (h) =>
        !h.name.trim() ||
        h.rooms.some((r) => !r.name.trim() || !Number.isInteger(r.beds) || r.beds < 1 || r.beds > 20),
    ),
  );

  private change(mutate: (houses: AccommodationHouse[]) => void) {
    const next = copyHouses(this.houses());
    mutate(next);
    this.houses.set(next);
    this.dirty.set(true);
  }

  addHouse() {
    this.change((hs) => hs.push({ name: '', description: '', rooms: [] }));
  }

  removeHouse(hi: number) {
    const house = this.houses()[hi];
    if (house.rooms.length && !confirm(`Biztosan törlöd a(z) "${house.name || 'névtelen'}" házat a szobáival együtt?`)) {
      return;
    }
    this.change((hs) => hs.splice(hi, 1));
  }

  setHouse(hi: number, field: 'name' | 'description', value: string) {
    this.change((hs) => (hs[hi][field] = value));
  }

  addRoom(hi: number) {
    this.change((hs) => hs[hi].rooms.push({ name: '', description: '', beds: 2 }));
  }

  removeRoom(hi: number, ri: number) {
    this.change((hs) => hs[hi].rooms.splice(ri, 1));
  }

  setRoom(hi: number, ri: number, field: 'name' | 'description', value: string) {
    this.change((hs) => (hs[hi].rooms[ri][field] = value));
  }

  setBeds(hi: number, ri: number, value: string) {
    this.change((hs) => (hs[hi].rooms[ri].beds = Number(value)));
  }

  reset() {
    this.houses.set(copyHouses(this.initialHouses()));
    this.dirty.set(false);
    this.showErrors.set(false);
  }

  save() {
    this.showErrors.set(true);
    if (this.hasInvalid()) {
      this.notifications.addError('Minden háznak és szobának adj nevet, és 1-20 férőhelyet.');
      return;
    }
    this.saving.set(true);
    this.tourService.updateAccommodation(this.tourId(), this.houses()).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.showErrors.set(false);
        this.saved.emit(res.data.accommodation.houses);
        this.notifications.addSuccess('Szállás mentve');
      },
      error: (err) => {
        this.saving.set(false);
        this.notifications.addError(err?.error?.message ?? 'Nem sikerült menteni a szállást.');
      },
    });
  }
}
