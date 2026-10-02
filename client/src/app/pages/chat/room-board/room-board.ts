import { Component, OnDestroy, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import {
  Tour,
  TourService,
  AccommodationHouse,
  AccommodationRoom,
  RoomBoardPerson,
} from '../../../services/tour';
import { AuthService } from '../../../auth/auth.service';
import { TourSocketService } from '../../../services/tour-socket';
import { NotificationsService } from '../../../notifications/notifications.service';
import { Avatar } from '../../../components/avatar/avatar';

// The chat page's Szobabeosztás panel: the selected tour's houses/rooms
// (set up in the tour edit page's Szállás section) with who sleeps where.
// An admin drags people between the "no room yet" list and the rooms (or,
// where dragging is fiddly, taps a person and picks a room); everyone else
// just sees it. Changes arrive live for everyone who has the page open
// (a "rooms-changed" push on the shared TourSocketService connection). Once
// the admin marks it as final, nobody can be moved until it's unlocked.
@Component({
  selector: 'app-room-board',
  standalone: true,
  imports: [RouterLink, MatIconModule, CdkDropListGroup, CdkDropList, CdkDrag, Avatar],
  templateUrl: './room-board.html',
  styleUrl: './room-board.scss',
})
export class RoomBoard implements OnDestroy {
  private auth = inject(AuthService);
  private tourService = inject(TourService);
  private tourSocket = inject(TourSocketService);
  private notifications = inject(NotificationsService);

  tour = input.required<Tour>();

  houses = signal<AccommodationHouse[]>([]);
  people = signal<RoomBoardPerson[]>([]);
  finalized = signal(false);
  loaded = signal(false);
  busy = signal(false);

  // The person an admin tapped, while choosing their room.
  picking = signal<RoomBoardPerson | null>(null);
  // A tap right after a drag isn't a "pick" tap.
  private justDragged = false;

  // An admin's controls - none on a closed tour (Lezárás, see Tour.closed).
  isAdmin = computed(() => this.auth.user()?.role === 'admin' && !this.tour().closed);
  canEdit = computed(() => this.isAdmin() && !this.finalized());
  myId = computed(() => this.auth.user()?.id ?? null);

  private rooms = computed(() => this.houses().flatMap((h) => h.rooms));
  totalBeds = computed(() => this.rooms().reduce((sum, r) => sum + r.beds, 0));

  // Family members next to each other, so it's easy to see who belongs
  // together; then alphabetical.
  unassigned = computed(() =>
    this.people()
      .filter((p) => !p.roomId)
      .sort(
        (a, b) =>
          (a.familyId ?? a.attendeeId).localeCompare(b.familyId ?? b.attendeeId) ||
          a.name.localeCompare(b.name, 'hu'),
      ),
  );

  // Where the logged-in user (and their family) sleep - shown on top.
  myPlaces = computed(() => {
    const me = this.people().find((p) => p.userId === this.myId());
    if (!me) return [];
    return this.people()
      .filter((p) => p.userId === me.userId || (me.familyId && p.familyId === me.familyId))
      .map((p) => ({ person: p, where: this.placeOf(p.roomId) }));
  });

  private unsubscribe: () => void;

  constructor() {
    effect(() => {
      this.load(this.tour()._id);
    });
    this.unsubscribe = this.tourSocket.on<{ tourId: string }>('rooms-changed', ({ tourId }) => {
      if (tourId === this.tour()._id) this.load(tourId);
    });
  }

  ngOnDestroy() {
    this.unsubscribe();
  }

  private load(tourId: string) {
    this.tourService.getRoomBoard(tourId).subscribe({
      next: (res) => {
        if (tourId !== this.tour()._id) return;
        this.houses.set(res.data.houses);
        this.people.set(res.data.people);
        this.finalized.set(res.data.finalized);
        this.loaded.set(true);
      },
      error: () => this.loaded.set(true),
    });
  }

  occupants(roomId: string | undefined): RoomBoardPerson[] {
    return this.people().filter((p) => p.roomId === roomId);
  }

  // The room someone is currently being dragged into from elsewhere - its
  // ghost chip (CDK's placeholder) takes one of the free places, so one
  // dashed circle less is drawn there: the person "snaps" into a place.
  hoverRoomId = signal<string | null>(null);
  private dragFromRoomId: string | null = null;

  // Dashed circles for the room's still-free places.
  freePlaces(room: AccommodationRoom): number[] {
    const taken = this.occupants(room._id).length + (this.hoverRoomId() === room._id ? 1 : 0);
    return Array.from({ length: Math.max(room.beds - taken, 0) }, (_, i) => i);
  }

  onRoomEntered(roomId: string | undefined) {
    if (roomId && roomId !== this.dragFromRoomId) this.hoverRoomId.set(roomId);
  }

  onRoomExited(roomId: string | undefined) {
    if (this.hoverRoomId() === roomId) this.hoverRoomId.set(null);
  }

  isFull(room: AccommodationRoom): boolean {
    return this.occupants(room._id).length >= room.beds;
  }

  label(p: RoomBoardPerson): string {
    return p.username || p.name;
  }

  placeOf(roomId: string | null): string | null {
    if (!roomId) return null;
    for (const h of this.houses()) {
      const r = h.rooms.find((x) => x._id === roomId);
      if (r) return `${h.name} / ${r.name}`;
    }
    return null;
  }

  // CDK: a full room refuses anyone who isn't already in it.
  roomAccepts = (drag: CdkDrag<RoomBoardPerson>, drop: CdkDropList<string | null>) => {
    const room = this.rooms().find((r) => r._id === drop.data);
    return !room || drag.data.roomId === room._id || !this.isFull(room);
  };

  onDragStarted(p: RoomBoardPerson) {
    this.justDragged = true;
    this.dragFromRoomId = p.roomId;
  }

  // The click a drag's release may produce fires before this timeout, so
  // it's still ignored - but the flag never lingers to swallow a real tap.
  onDragEnded() {
    this.hoverRoomId.set(null);
    this.dragFromRoomId = null;
    setTimeout(() => (this.justDragged = false));
  }

  // The drop list's data is the room's id, or null for the "no room" list.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDrop(event: CdkDragDrop<any, any, RoomBoardPerson>) {
    if (event.previousContainer === event.container) return;
    this.move(event.item.data, (event.container.data as string | null) ?? null);
  }

  onPersonTap(p: RoomBoardPerson) {
    if (this.justDragged) {
      this.justDragged = false;
      return;
    }
    if (this.canEdit()) this.picking.set(p);
  }

  pick(roomId: string | null) {
    const p = this.picking();
    this.picking.set(null);
    if (p && p.roomId !== roomId) this.move(p, roomId);
  }

  // Moved on screen right away; put back (by reloading) if the server says no.
  private move(person: RoomBoardPerson, roomId: string | null) {
    const tourId = this.tour()._id;
    this.people.update((list) =>
      list.map((p) => (p.attendeeId === person.attendeeId ? { ...p, roomId } : p)),
    );
    this.tourService.assignRoom(tourId, person.attendeeId, roomId).subscribe({
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'Nem sikerült áthelyezni.');
        this.load(tourId);
      },
    });
  }

  toggleFinalized() {
    const next = !this.finalized();
    this.busy.set(true);
    this.tourService.setRoomsFinalized(this.tour()._id, next).subscribe({
      next: () => {
        this.busy.set(false);
        this.finalized.set(next);
        this.notifications.addSuccess(
          next ? 'Szobabeosztás véglegesítve' : 'Véglegesítés feloldva',
        );
      },
      error: (err) => {
        this.busy.set(false);
        this.notifications.addError(err?.error?.message ?? 'Nem sikerült.');
      },
    });
  }
}
