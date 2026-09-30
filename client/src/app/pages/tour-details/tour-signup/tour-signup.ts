import { Component, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TourService } from '../../../services/tour';
import { AuthService } from '../../../auth/auth.service';

// One selectable entry in the sign-up picker - a plain subset shared by
// FamilyMember, AdminUser and the logged-in user's own auth profile, all
// of which have _id + name but otherwise different shapes.
export interface PickerOption {
  _id: string;
  name: string;
}

// A tour's sign-up (tour-details): the bar at the bottom - log in, "already
// signed up", the advance payment, sign-up closed, or the Jelentkezés
// button - and the "who" picker for a member/admin with more than one
// person to choose from. Who can be picked (options) is worked out by
// tour-details, which also needs those users for the program sign-ups;
// after a successful sign-up it reloads the tour (signedUp).
@Component({
  selector: 'app-tour-signup',
  imports: [RouterLink],
  templateUrl: './tour-signup.html',
  styleUrl: './tour-signup.scss',
})
export class TourSignup {
  private tourService = inject(TourService);
  auth = inject(AuthService);

  tourId = input.required<string>();
  options = input.required<PickerOption[]>();
  alreadySignedUp = input(false);
  isFull = input(false);
  signUpOpen = input(false);
  // "Előleg befizetés" - only while someone in my own payment group still
  // owes an advance (else the payment page would be empty).
  showAdvancePayment = input(false);
  signedUp = output<void>();

  signingUp = signal(false);
  signUpError = signal<string | null>(null);
  selectedAttendeeIds = signal<Set<string>>(new Set());
  showAttendeePicker = signal(false);

  // The simple one-click case: exactly one person to offer (a guest, or a
  // member/admin who has nobody else left to add) - no picker needed.
  signUpSingle() {
    const opt = this.options()[0];
    if (opt) this.doSignUp([opt._id]);
  }

  openAttendeePicker() {
    this.signUpError.set(null);
    this.showAttendeePicker.set(true);
  }

  closeAttendeePicker() {
    this.showAttendeePicker.set(false);
    this.selectedAttendeeIds.set(new Set());
    this.signUpError.set(null);
  }

  isAttendeeSelected(id: string): boolean {
    return this.selectedAttendeeIds().has(id);
  }

  toggleAttendeeSelected(id: string) {
    this.selectedAttendeeIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  signUpSelected() {
    this.doSignUp([...this.selectedAttendeeIds()]);
  }

  private doSignUp(attendeeIds: string[]) {
    if (attendeeIds.length === 0) return;

    this.signingUp.set(true);
    this.signUpError.set(null);

    this.tourService.signUp(this.tourId(), attendeeIds).subscribe({
      next: () => {
        // tour-details reloads the whole tour - the simplest way to keep
        // every derived total (participantCount, attendeePayments,
        // paymentTotals) in sync with the server.
        this.signedUp.emit();
        this.selectedAttendeeIds.set(new Set());
        this.signingUp.set(false);
        // A successful submit always closes the picker - a no-op for the
        // single-click self/guest path, which never opens it in the first
        // place.
        this.showAttendeePicker.set(false);
      },
      error: (err) => {
        this.signUpError.set(err?.error?.message ?? 'Hiba történt a jelentkezés során.');
        this.signingUp.set(false);
      },
    });
  }

  login() {
    this.auth.login();
  }
}
