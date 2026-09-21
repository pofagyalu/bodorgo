import { Component, inject, signal, computed, effect } from '@angular/core';
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
  birthday: string;
  gender: string;
}

function emptyUserForm(): UserFormModel {
  return { name: '', email: '', familyId: '', birthday: '', gender: '' };
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

  // Bounds for the birthday <input type="date"> fields. Without a `max`,
  // Chrome's year segment allows up to 6 digits and can't tell you're done
  // after 4 - it won't auto-advance to the month field until you either
  // type further or move focus manually. Giving it a realistic max (and a
  // matching min) lets it recognize a 4-digit year as already at its
  // limit, fixing that - and it's sensible validation regardless (no one's
  // birthday is in the future or before 1900).
  readonly minBirthday = '1900-01-01';
  readonly maxBirthday = new Date().toISOString().slice(0, 10);

  attendance = signal<AttendanceRow[]>([]);
  attendanceError = signal<string | null>(null);

  // Every logged-in user's own family roster (Hozzátartozók), not just an
  // admin's.
  family = signal<FamilyMember[]>([]);
  familyError = signal<string | null>(null);

  // Shown to admin and member alike (see loadUsersList()) - a plain
  // member gets a trimmed-down response (no familyId/role/lastLoginAt,
  // see userController.js's getAllUsers), which the template also reflects
  // by hiding those columns and every edit affordance for non-admins.
  users = signal<AdminUser[]>([]);
  usersError = signal<string | null>(null);
  private roleBasedDataRequested = false;

  // Clicking a sortable column header (Név/Kor/Család/Táborok) sorts by
  // it; clicking the same one again flips direction. Defaults to Név/asc
  // (matching the server's own default order) so the ▲ arrow is visible
  // from the first load, hinting that the columns are sortable at all.
  sortColumn = signal<'name' | 'age' | 'familyId' | 'toursAttended'>('name');
  sortDirection = signal<'asc' | 'desc'>('asc');

  sortedUsers = computed(() => {
    const column = this.sortColumn();
    const list = this.users();
    const dir = this.sortDirection() === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      // Missing values (e.g. no birthday yet, so no age) always sort last,
      // regardless of direction - flipping to desc shouldn't bury filled-in
      // rows under a pile of blanks.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), 'hu') * dir;
    });
  });

  // The direction each column starts in on its first click - age/toursAttended
  // are more useful sorted highest-first (oldest, most-attended), while
  // name/familyId read naturally A-Z.
  private static readonly DEFAULT_SORT_DIRECTION: Record<'name' | 'age' | 'familyId' | 'toursAttended', 'asc' | 'desc'> = {
    name: 'asc',
    age: 'desc',
    familyId: 'asc',
    toursAttended: 'desc',
  };

  toggleSort(column: 'name' | 'age' | 'familyId' | 'toursAttended') {
    if (this.sortColumn() === column) {
      this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set(Profile.DEFAULT_SORT_DIRECTION[column]);
    }
  }

  // A Material icon name for a sortable header's indicator - unfold_more
  // (a neutral up/down chevron) when it isn't the active column, a single
  // direction arrow once it is.
  sortIcon(column: 'name' | 'age' | 'familyId' | 'toursAttended'): string {
    if (this.sortColumn() !== column) return 'unfold_more';
    return this.sortDirection() === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  // Self-service opt-out toggle (I/N pill, same visual language as the
  // event form's isOptional switch) - defaults to true, so this only ever
  // reflects an explicit false from the server.
  savingEmailNotifications = signal(false);

  toggleEmailNotifications() {
    const next = !(this.auth.user()?.wantsEmailNotifications ?? true);
    this.savingEmailNotifications.set(true);
    this.userService.updateMe({ wantsEmailNotifications: next }).subscribe({
      next: () => {
        this.savingEmailNotifications.set(false);
        this.auth.patchCurrentUser({ wantsEmailNotifications: next });
        this.notifications.addSuccess('Beállítás mentve');
      },
      error: (err) => {
        this.savingEmailNotifications.set(false);
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a mentés során.');
      },
    });
  }

  isAdmin = computed(() => this.auth.user()?.role === 'admin');
  // 'admin' and 'member' are both real, dues-paying club members; only
  // 'guest' (a login-less dependent's own login, or an outside visitor)
  // isn't. Drives the "Klubtag: igen/nem" line at the top of the page.
  isClubMember = computed(() => this.auth.user()?.role !== 'guest');

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
      if (role !== 'admin') {
        this.loadFamily();
      }
      if (role === 'admin' || role === 'member') {
        this.loadUsersList();
      }
    });
  }

  // Clicking edit/save/cancel on a row swaps its cells between plain text
  // and input fields. The table isn't table-layout:fixed, so column widths
  // are shared across every row - an input in one row can force ALL rows'
  // columns to a new width, rewrapping text and changing row heights above
  // the one that was actually clicked. That means restoring the page's old
  // absolute scrollY isn't enough (a real reported bug: the clicked row
  // still ended up somewhere else on screen, or off the bottom entirely) -
  // the fix has to anchor on the row itself: capture where it sits on
  // screen before the change, then after Angular repaints, nudge the
  // scroll by exactly however far that row moved. requestAnimationFrame is
  // used (rather than restoring synchronously) so the new layout already
  // exists when we measure it.
  private restoreRowPosition(row: HTMLElement | null, prevTop: number) {
    if (!row) return;
    requestAnimationFrame(() => {
      const newTop = row.getBoundingClientRect().top;
      if (newTop !== prevTop) {
        window.scrollBy(0, newTop - prevTop);
      }
    });
  }

  private loadUsersList(keepRow?: { row: HTMLElement; prevTop: number }) {
    this.userService.getAllUsers().subscribe({
      next: (res) => {
        this.users.set(res.data.users);
        if (keepRow) {
          this.restoreRowPosition(keepRow.row, keepRow.prevTop);
        }
      },
      error: () => this.usersError.set('A felhasználók betöltése nem sikerült.'),
    });
  }

  private loadFamily() {
    this.userService.getMyFamily().subscribe({
      next: (res) => this.family.set(res.data.members),
      error: () => this.familyError.set('A hozzátartozók betöltése nem sikerült.'),
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
        birthday: f.birthday || undefined,
        gender: f.gender || undefined,
      })
      .subscribe({
        next: () => {
          this.addUserSaving.set(false);
          this.addingUser.set(false);
          this.notifications.addSuccess('Felhasználó hozzáadva');
          this.loadUsersList();
        },
        error: (err) => {
          this.notifications.addError(err?.error?.message ?? 'Hiba történt a hozzáadás során.');
          this.addUserSaving.set(false);
        },
      });
  }

  startEditUser(user: AdminUser, event: MouseEvent) {
    this.editUserForm = {
      name: user.name,
      email: user.email ?? '',
      familyId: user.familyId ?? '',
      // A native date input wants a bare "YYYY-MM-DD", not the full ISO
      // timestamp the API returns.
      birthday: user.birthday ? user.birthday.slice(0, 10) : '',
      gender: user.gender ?? '',
    };
    // See restoreRowPosition()'s comment - entering/leaving edit mode can
    // shift this row (and others) on screen.
    const row = (event.currentTarget as HTMLElement).closest('tr');
    const prevTop = row?.getBoundingClientRect().top ?? 0;
    this.editingUserId.set(user._id);
    this.restoreRowPosition(row as HTMLElement | null, prevTop);
  }

  cancelEditUser(event: MouseEvent) {
    const row = (event.currentTarget as HTMLElement).closest('tr');
    const prevTop = row?.getBoundingClientRect().top ?? 0;
    this.editingUserId.set(null);
    this.restoreRowPosition(row as HTMLElement | null, prevTop);
  }

  saveEditUser(user: AdminUser, event: MouseEvent) {
    const f = this.editUserForm;
    if (!f.name.trim()) {
      this.notifications.addError('A névnek nem lehet üres.');
      return;
    }

    const row = (event.currentTarget as HTMLElement).closest('tr') as HTMLElement | null;
    const prevTop = row?.getBoundingClientRect().top ?? 0;

    this.editUserSaving.set(true);
    this.userService
      .updateUser(user._id, {
        name: f.name.trim(),
        email: f.email.trim(),
        familyId: f.familyId.trim(),
        birthday: f.birthday,
        gender: f.gender,
      })
      .subscribe({
        next: () => {
          this.editUserSaving.set(false);
          this.editingUserId.set(null);
          // Reverting this row out of edit mode is itself a layout change,
          // so correct for it before the reload (below) causes another one.
          this.restoreRowPosition(row, prevTop);
          this.notifications.addSuccess('Felhasználó mentve');
          this.loadUsersList(row ? { row, prevTop } : undefined);
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
        this.loadUsersList();
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'Hiba történt az összekapcsolás során.');
        this.joiningFamily.set(false);
      },
    });
  }
}
