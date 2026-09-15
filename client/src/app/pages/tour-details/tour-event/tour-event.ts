import { Component, EventEmitter, Input, Output, inject, signal, computed } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TourService, ScheduleEntry } from '../../../services/tour';
import { AuthService } from '../../../auth/auth.service';
import { EventForm, EventFormModel } from '../event-form/event-form';

// One schedule event row: display, opt-in/participants, and (admin-only)
// the inline editor - split out of tour-details.ts once this grew to be
// the densest part of that page. Never mutates its own @Input() directly;
// a successful opt-in toggle or edit emits the fresh event so the parent
// can patch its own schedule array, keeping one-way data flow intact.
@Component({
  selector: 'app-tour-event',
  standalone: true,
  imports: [MatIconModule, EventForm],
  templateUrl: './tour-event.html',
  styleUrl: './tour-event.scss',
})
export class TourEvent {
  private tourService = inject(TourService);
  auth = inject(AuthService);

  @Input({ required: true }) event!: ScheduleEntry;
  @Input({ required: true }) tourId!: string;
  @Output() updated = new EventEmitter<ScheduleEntry>();

  expanded = signal(false);
  toggling = signal(false);
  toggleError = signal<string | null>(null);

  editing = signal(false);
  saving = signal(false);
  editError = signal<string | null>(null);
  editForm: EventFormModel = { time: '', description: '', isOptional: false, extraCost: null };

  isOptedIn = computed(() => {
    const uid = this.auth.user()?.id;
    if (!uid) return false;
    return (this.event.participants ?? []).some((p) => p.user === uid);
  });

  toggleExpanded() {
    this.expanded.update((v) => !v);
  }

  toggleOptIn() {
    this.toggling.set(true);
    this.toggleError.set(null);

    this.tourService.toggleScheduleParticipation(this.tourId, this.event._id).subscribe({
      next: (res) => {
        this.updated.emit({ ...this.event, participants: res.data.participants });
        this.toggling.set(false);
      },
      error: (err) => {
        this.toggleError.set(
          err?.error?.message ?? 'Hiba történt a jelentkezés módosítása során.',
        );
        this.toggling.set(false);
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
    this.saving.set(true);
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
          this.saving.set(false);
          this.editing.set(false);
        },
        error: (err) => {
          this.editError.set(err?.error?.message ?? 'Hiba történt a mentés során.');
          this.saving.set(false);
        },
      });
  }
}
