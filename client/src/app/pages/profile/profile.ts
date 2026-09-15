import { Component, inject, signal, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { UserService, AdminUser, AttendedTour, FamilyMember } from '../../services/user';
import { AuthService } from '../../auth/auth.service';
import { NotificationsService } from '../../notifications/notifications.service';

interface AttendanceRow {
  tour: AttendedTour;
  paid: boolean;
}

interface UserFormModel {
  name: string;
  email: string;
  familyId: string;
}

function emptyUserForm(): UserFormModel {
  return { name: '', email: '', familyId: '' };
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'admin',
  member: 'klubtag',
  guest: 'vendég',
};

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [RouterLink, FormsModule, MatIconModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  private userService = inject(UserService);
  private notifications = inject(NotificationsService);
  auth = inject(AuthService);

  attendance = signal<AttendanceRow[]>([]);
  attendanceError = signal<string | null>(null);

  // Every logged-in user's own family roster (Hozzátartozók), not just an
  // admin's.
  family = signal<FamilyMember[]>([]);
  familyError = signal<string | null>(null);

  // Only for a 'member' (not a mere logged-in guest) - the full
  // membership roster, see loadClubMembers(). An admin doesn't get this
  // separately since they already see everyone in the admin table below.
  clubMembers = signal<FamilyMember[]>([]);
  clubMembersError = signal<string | null>(null);

  // Only ever populated for an admin - see loadAdminUsers(). An admin
  // already sees everyone (with their own family highlighted, see
  // isOwnFamily()), so they don't get the separate Hozzátartozók/Klubtagok
  // sections a non-admin does - loadFamily()/loadClubMembers() are never
  // called for them.
  users = signal<AdminUser[]>([]);
  usersError = signal<string | null>(null);
  private roleBasedDataRequested = false;

  // Admin-only user management: add, per-row edit, and bulk "join into one
  // family" - built for quickly entering/cleaning up historical people by
  // hand (see server/scripts/createFamily.js etc. for the script-based
  // equivalent this complements).
  addingUser = signal(false);
  addUserSaving = signal(false);
  addUserForm: UserFormModel = emptyUserForm();

  editingUserId = signal<string | null>(null);
  editUserSaving = signal(false);
  editUserForm: UserFormModel = emptyUserForm();

  selectedUserIds = signal<Set<string>>(new Set());
  joiningFamily = signal(false);

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
        if (role === 'member') {
          this.loadClubMembers();
        }
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
      error: () => this.familyError.set('A hozzátartozók betöltése nem sikerült.'),
    });
  }

  private loadClubMembers() {
    this.userService.getClubMembers().subscribe({
      next: (res) => this.clubMembers.set(res.data.members),
      error: () => this.clubMembersError.set('A klubtagok betöltése nem sikerült.'),
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

  startAddUser() {
    this.addUserForm = emptyUserForm();
    this.addingUser.set(true);
  }

  cancelAddUser() {
    this.addingUser.set(false);
  }

  saveNewUser() {
    const f = this.addUserForm;
    if (!f.name.trim()) {
      this.notifications.addError('A névnek nem lehet üres.');
      return;
    }

    this.addUserSaving.set(true);
    this.userService
      .createUser({
        name: f.name.trim(),
        email: f.email.trim() || undefined,
        familyId: f.familyId.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.addUserSaving.set(false);
          this.addingUser.set(false);
          this.notifications.addSuccess('Felhasználó hozzáadva');
          this.loadAdminUsers();
        },
        error: (err) => {
          this.notifications.addError(err?.error?.message ?? 'Hiba történt a hozzáadás során.');
          this.addUserSaving.set(false);
        },
      });
  }

  startEditUser(user: AdminUser) {
    this.editUserForm = {
      name: user.name,
      email: user.email ?? '',
      familyId: user.familyId ?? '',
    };
    this.editingUserId.set(user._id);
  }

  cancelEditUser() {
    this.editingUserId.set(null);
  }

  saveEditUser(user: AdminUser) {
    const f = this.editUserForm;
    if (!f.name.trim()) {
      this.notifications.addError('A névnek nem lehet üres.');
      return;
    }

    this.editUserSaving.set(true);
    this.userService
      .updateUser(user._id, {
        name: f.name.trim(),
        email: f.email.trim(),
        familyId: f.familyId.trim(),
      })
      .subscribe({
        next: () => {
          this.editUserSaving.set(false);
          this.editingUserId.set(null);
          this.notifications.addSuccess('Felhasználó mentve');
          this.loadAdminUsers();
        },
        error: (err) => {
          this.notifications.addError(err?.error?.message ?? 'Hiba történt a mentés során.');
          this.editUserSaving.set(false);
        },
      });
  }

  isUserSelected(id: string): boolean {
    return this.selectedUserIds().has(id);
  }

  toggleUserSelected(id: string) {
    this.selectedUserIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  joinSelectedIntoFamily() {
    const ids = [...this.selectedUserIds()];
    if (ids.length < 2) return;

    this.joiningFamily.set(true);
    this.userService.joinFamily(ids).subscribe({
      next: () => {
        this.joiningFamily.set(false);
        this.selectedUserIds.set(new Set());
        this.notifications.addSuccess('Családba kapcsolva');
        this.loadAdminUsers();
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'Hiba történt az összekapcsolás során.');
        this.joiningFamily.set(false);
      },
    });
  }
}
