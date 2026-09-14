import { Component, inject, signal, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UserService, AdminUser, AttendedTour } from '../../services/user';
import { AuthService } from '../../auth/auth.service';

interface AttendanceRow {
  tour: AttendedTour;
  paid: boolean;
}

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

  // Only ever populated for an admin - see loadAdminUsers().
  users = signal<AdminUser[]>([]);
  usersError = signal<string | null>(null);
  private adminUsersRequested = false;

  constructor() {
    this.userService.getMyAttendance().subscribe({
      next: (res) => this.attendance.set(res.data.tours),
      error: () => this.attendanceError.set('A táboraid betöltése nem sikerült.'),
    });

    // auth.user() often isn't resolved yet at construction time -
    // AppComponent's checkAuth() call is still in flight on a fresh page
    // load - so a plain one-time check here could run before the role is
    // known and silently skip loading the list forever, even though the
    // template's own @if would still show the (now permanently empty)
    // section once the role does resolve. effect() re-evaluates whenever
    // the signal changes, so it fires as soon as the role is actually
    // known, whether that's immediately or a moment later.
    effect(() => {
      if (this.auth.user()?.role === 'admin' && !this.adminUsersRequested) {
        this.adminUsersRequested = true;
        this.loadAdminUsers();
      }
    });
  }

  private loadAdminUsers() {
    this.userService.getAllUsers().subscribe({
      next: (res) => this.users.set(res.data.users),
      error: () => this.usersError.set('A felhasználók betöltése nem sikerült.'),
    });
  }

  canLogin(user: AdminUser): boolean {
    return !!user.sub;
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
}
