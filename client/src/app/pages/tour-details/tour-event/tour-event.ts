import { Component, EventEmitter, Input, Output, inject, signal, computed } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TourService, ScheduleEntry } from '../../../services/tour';
import { AuthService } from '../../../auth/auth.service';
import { EventForm, EventFormModel } from '../event-form/event-form';
import { Avatar } from '../../../components/avatar/avatar';

// How many faces the collapsed sign-up row shows before "+N".
const STACK_SIZE = 5;

// One candidate the logged-in user could opt in/out of this event - see
// tour-details.ts's myScheduleEventCandidates for who ends up in this
// list (only real attendees of this tour: self + family, or - for an
// admin - anyone attending).
export interface ScheduleCandidate {
  _id: string;
  name: string;
}

// One schedule event row: display, opt-in/participants, and (admin-only)
// the inline editor - split out of tour-details.ts once this grew to be
// the densest part of that page. Never mutates its own @Input() directly;
// a successful opt-in save or edit emits the fresh event so the parent
// can patch its own schedule array, keeping one-way data flow intact.
@Component({
  selector: 'app-tour-event',
  standalone: true,
  imports: [MatIconModule, EventForm, Avatar],
  templateUrl: './tour-event.html',
  styleUrl: './tour-event.scss',
})
export class TourEvent {
  private tourService = inject(TourService);
  auth = inject(AuthService);

  @Input({ required: true }) event!: ScheduleEntry;
  @Input({ required: true }) tourId!: string;
  // Who the logged-in user is allowed to opt in/out of this event - self
  // + family, or (admin) every real attendee. Empty for a guest with no
  // family who isn't even attending - the opt-in row hides itself
  // entirely in that case (see tour-event.html).
  @Input() candidates: ScheduleCandidate[] = [];
  // { userId: photoUpdatedAt } - see tour-details.ts's userPhotos.
  @Input() userPhotos: Record<string, string> = {};
  // { userId: username } - a chip shows this instead of the full name
  // when the person has one (the full name stays as its tooltip).
  @Input() usernames: Record<string, string> = {};
  @Output() updated = new EventEmitter<ScheduleEntry>();

  readonly stackSize = STACK_SIZE;

  expanded = signal(false);
  saving = signal(false);
  saveError = signal<string | null>(null);

  editing = signal(false);
  editSaving = signal(false);
  editError = signal<string | null>(null);
  editForm: EventFormModel = { time: '', description: '', isOptional: false, extraCost: null };

  // Which of MY OWN candidates are currently participants - the button
  // reads "Módosítás" once any of them has already joined, "Jelentkezés"
  // when none has (see tour-event.html), and the picker pre-checks
  // exactly this set when opened.
  myJoinedCandidateIds = computed(() => {
    const candidateIds = new Set(this.candidates.map((c) => c._id));
    return new Set((this.event.participants ?? []).filter((p) => candidateIds.has(p.user)).map((p) => p.user));
  });

  hasAnyOfMineJoined = computed(() => this.myJoinedCandidateIds().size > 0);

  pickerOpen = signal(false);
  selectedIds = signal<Set<string>>(new Set());

  toggleExpanded() {
    this.expanded.update((v) => !v);
  }

  openPicker() {
    this.saveError.set(null);
    this.selectedIds.set(new Set(this.myJoinedCandidateIds()));
    this.pickerOpen.set(true);
  }

  closePicker() {
    this.pickerOpen.set(false);
  }

  isCandidateSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  toggleCandidateSelected(id: string) {
    this.selectedIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  savePicker() {
    this.saving.set(true);
    this.saveError.set(null);

    this.tourService.updateScheduleEventParticipants(this.tourId, this.event._id, [...this.selectedIds()]).subscribe({
      next: (res) => {
        this.updated.emit({ ...this.event, participants: res.data.participants });
        this.saving.set(false);
        this.pickerOpen.set(false);
      },
      error: (err) => {
        this.saveError.set(err?.error?.message ?? 'Hiba történt a jelentkezés módosítása során.');
        this.saving.set(false);
      },
    });
  }

  startEdit() {
    this.editError.set(null);
    this.editForm = {
      time: this.event.time,
      description: this.event.description,
      isOptional: !!this.event.isOptional,
      extraCost: this.event.extraCost ?? null,
    };
    this.editing.set(true);
  }

  cancelEdit() {
    this.editing.set(false);
    this.editError.set(null);
  }

  saveEdit() {
    this.editSaving.set(true);
    this.editError.set(null);

    const form = this.editForm;
    this.tourService
      .updateScheduleEvent(this.tourId, this.event._id, {
        time: form.time,
        description: form.description,
        isOptional: form.isOptional,
        extraCost: form.isOptional ? (form.extraCost ?? undefined) : undefined,
      })
      .subscribe({
        next: (res) => {
          this.updated.emit(res.data.event);
          this.editSaving.set(false);
          this.editing.set(false);
        },
        error: (err) => {
          this.editError.set(err?.error?.message ?? 'Hiba történt a mentés során.');
          this.editSaving.set(false);
        },
      });
  }
}
