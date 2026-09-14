import { Component, inject, signal, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UserService, AdminUser, AttendedTour, FamilyMember } from '../../services/user';
import { AuthService } from '../../auth/auth.service';

interface AttendanceRow {
  tour: AttendedTour;
  paid: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'admin',
  bodorgo: 'klubtag',
  guest: 'vendég',
};

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  private userService = inject(UserService);
  auth = inject(AuthService);

  attendance = signal<AttendanceRow[]>([]);
  attendanceError = signal<string | null>(null);

  // Every logged-in user's own family roster, not just an admin's.
  family = signal<FamilyMember[]>([]);
  familyError = signal<string | null>(null);

  // Only ever populated for an admin - see loadAdminUsers(). An admin
  // already sees everyone (with their own family highlighted, see
  // isOwnFamily()), so they don't get the separate Családtagok section a
  // non-admin does - loadFamily() is never called for them.
  users = signal<AdminUser[]>([]);
  usersError = signal<string | null>(null);
  private roleBasedDataRequested = false;

  constructor() {
    this.userService.getMyAttendance().subscribe({
      next: (res) => this.attendance.set(res.data.tours),
      error: () => this.attendanceError.set('A táboraid betöltése nem sikerült.'),
    });

    // auth.user() often isn't resolved yet at construction time -
    // AppComponent's checkAuth() call is still in flight on a fresh page
    // load - so a plain one-time check here could run before the role is
    // known and silently skip loading data forever, even though the
    // template's own @if would still show the (now permanently empty)
    // section once the role does resolve. effect() re-evaluates whenever
    // the signal changes, so it fires as soon as the role is actually
    // known, whether that's immediately or a moment later.
    effect(() => {
      const role = this.auth.user()?.role;
      if (!role || this.roleBasedDataRequested) return;
      this.roleBasedDataRequested = true;
      if (role === 'admin') {
        this.loadAdminUsers();
      } else {
        this.loadFamily();
      }
    });
  }

  private loadAdminUsers() {
    this.userService.getAllUsers().subscribe({
      next: (res) => this.users.set(res.data.users),
      error: () => this.usersError.set('A felhasználók betöltése nem sikerült.'),
    });
  }

  private loadFamily() {
    this.userService.getMyFamily().subscribe({
      next: (res) => this.family.set(res.data.members),
      error: () => this.familyError.set('A családtagok betöltése nem sikerült.'),
    });
  }

  roleLabel(role: string): string {
    return ROLE_LABELS[role] || role;
  }

  // Highlights the admin's own family within the full user list, so they
  // stand out from the rest without needing a separate lookup.
  isOwnFamily(user: AdminUser): boolean {
    const myFamilyId = this.auth.user()?.familyId;
    return !!myFamilyId && user.familyId === myFamilyId;
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

  formatDateTime(dateStr: string): string {
    return new Intl.DateTimeFormat('hu-HU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(dateStr));
  }
}
