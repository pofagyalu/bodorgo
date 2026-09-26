import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

export interface EventFormModel {
  time: string;
  description: string;
  isOptional: boolean;
  extraCost: number | null;
}

// Every half hour, 00:00 through 23:30 - matches the "starting hour"
// dropdown's granularity the admin asked for.
export const EVENT_FORM_TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.floor(i / 2)
    .toString()
    .padStart(2, '0');
  const minute = i % 2 === 0 ? '00' : '30';
  return `${hour}:${minute}`;
});

// The time/description/optional-toggle/cost fields shared by both editing
// an existing schedule event (tour-event.ts) and adding a new one
// (tour-details.ts) - a purely presentational component: model is a plain
// object mutated in place via ngModel (the same reference the parent
// holds), so no @Output for every field is needed, just save/cancel.
@Component({
  selector: 'app-event-form',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  templateUrl: './event-form.html',
  styleUrl: './event-form.scss',
})
export class EventForm {
  @Input({ required: true }) model!: EventFormModel;
  @Input() saving = false;
  @Input() error: string | null = null;
  @Output() save = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  readonly timeOptions = EVENT_FORM_TIME_OPTIONS;
}
