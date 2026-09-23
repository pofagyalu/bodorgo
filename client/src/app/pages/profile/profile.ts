import { Component, inject, signal, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { UserService, AttendedTour, FamilyMember } from '../../services/user';
import { PaymentService } from '../../services/payment';
import { AuthService } from '../../auth/auth.service';

interface AttendanceRow {
  tour: AttendedTour;
  paid: boolean;
  paymentId: string | null;
  paymentMethod: 'stripe' | 'cash' | null;
}

// The admin user-management table (add/edit/join-family) moved to Klub
// Felhasználók + its per-user "Szerkesztés" page (see
// pages/klub/member-edit); the personal-info/notifications/address
// summary moved to Klub Profilom (see pages/klub/profile). This page is
// now purely "your tours" and (for non-admins) "your family roster".
@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [RouterLink, MatIconModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  private userService = inject(UserService);
  private paymentService = inject(PaymentService);
  auth = inject(AuthService);

  attendance = signal<AttendanceRow[]>([]);
  attendanceError = signal<string | null>(null);

  // Every logged-in user's own family roster (Hozzátartozók), not just an
  // admin's.
  family = signal<FamilyMember[]>([]);
  familyError = signal<string | null>(null);
  private familyRequested = false;

  constructor() {
    this.userService.getMyAttendance().subscribe({
      next: (res) => this.attendance.set(res.data.tours),
      error: () => this.attendanceError.set('A táboraid betöltése nem sikerült.'),
    });

    // auth.user() often isn't resolved yet at construction time -
    // AppComponent's checkAuth() call is still in flight on a fresh page
    // load - so a plain one-time check here could run before the role is
    // known and silently skip loading the family list forever, even
    // though the template's own @if would still show that section once
    // the role does resolve. effect() re-evaluates whenever the signal
    // changes, so it fires as soon as the role is actually known, whether
    // that's immediately or a moment later.
    effect(() => {
      const role = this.auth.user()?.role;
      if (!role || this.familyRequested) return;
      this.familyRequested = true;
      if (role !== 'admin') {
        this.loadFamily();
      }
    });
  }

  private loadFamily() {
    this.userService.getMyFamily().subscribe({
      next: (res) => this.family.set(res.data.members),
      error: () => this.familyError.set('A hozzátartozók betöltése nem sikerült.'),
    });
  }

  // Long Hungarian format, same reasoning as tour-details.ts's
  // formattedStartDate - Angular's DatePipe needs hu locale data
  // registered, which this app doesn't do.
  formatDate(dateStr: string): string {
    return new Intl.DateTimeFormat('hu-HU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(dateStr));
  }

  receiptUrl(paymentId: string): string {
    return this.paymentService.receiptUrl(paymentId);
  }
}
