import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService, AdminUser } from '../../../services/user';
import { NotificationsService } from '../../../notifications/notifications.service';
import { AuthService } from '../../../auth/auth.service';
import { Avatar } from '../../../components/avatar/avatar';
import { PhotoEditor, PhotoChange } from '../../../components/photo-editor/photo-editor';

interface AddressForm {
  zipCode: string;
  city: string;
  street: string;
  country: string;
}

function emptyAddress(): AddressForm {
  return { zipCode: '', city: '', street: '', country: 'Magyarország' };
}

// Admin-only (see the memberEditGuard on this route) - the full editable
// record for one specific user, reached from Klub Felhasználók's
// "Szerkesztés" action. Covers the same fields the old top-level Profil
// page's admin table used to manage - name stays read-only here too when
// editing (it comes from Authentik, nobody edits it directly in this app).
//
// Also doubles as the "add a new user" page (route 'felhasznalok/uj', no
// :id - see app.routes.ts and isCreateMode below), reusing this exact same
// form rather than a separate, smaller one - a manually pre-created person
// (e.g. a family member with no Authentik login yet) needs the same fields
// filled in either way, and name is the one field only editable here in
// create mode, since there's no Authentik account yet to source it from.
@Component({
  selector: 'app-member-edit',
  imports: [Avatar, PhotoEditor],
  templateUrl: './member-edit.html',
  styleUrl: './member-edit.scss',
})
export class MemberEdit implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private userService = inject(UserService);
  private notifications = inject(NotificationsService);
  private auth = inject(AuthService);

  readonly minBirthday = '1900-01-01';
  readonly maxBirthday = new Date().toISOString().slice(0, 10);
  readonly clubFoundingYear = 2019;
  readonly currentYear = new Date().getFullYear();

  private userId = this.route.snapshot.paramMap.get('id');
  isCreateMode = this.userId === null;

  loading = signal(!this.isCreateMode);
  saving = signal(false);
  user = signal<AdminUser | null>(null);

  // Only actually editable in create mode (see member-edit.html) - once a
  // real person's own Authentik login exists, their name comes from there
  // on every login, so nothing in this app lets it be typed over.
  name = signal('');
  email = signal('');
  username = signal('');
  familyId = signal('');
  birthday = signal('');
  gender = signal('');
  memberSince = signal('');
  role = signal('guest');

  // Only the role manager (server utils/roleManager.js) sets roles - not
  // their own; other admins see it, and add new people as Vendég.
  canEditRole = computed(() => {
    const me = this.auth.user();
    return !!me?.canManageRoles && this.user()?._id !== me.id;
  });
  roleHint = computed(() => {
    const me = this.auth.user();
    if (me?.canManageRoles) {
      return this.user()?._id === me.id
        ? 'A saját szerepköröd nem módosíthatod.'
        : 'A szerepkört csak te módosíthatod.';
    }
    return 'Szerepkört csak a szerepkör-kezelő admin módosíthat.';
  });
  address = signal<AddressForm>(emptyAddress());

  ngOnInit() {
    if (this.isCreateMode) return;

    this.userService.getUser(this.userId!).subscribe({
      next: (res) => {
        const u = res.data.user;
        this.user.set(u);
        this.name.set(u.name);
        this.email.set(u.email ?? '');
        this.username.set(u.username ?? '');
        this.familyId.set(u.familyId ?? '');
        this.birthday.set(u.birthday ? u.birthday.slice(0, 10) : '');
        this.gender.set(u.gender ?? '');
        this.memberSince.set(u.memberSince != null ? String(u.memberSince) : '');
        this.role.set(u.role);
        this.address.set({
          zipCode: u.address?.zipCode ?? '',
          city: u.address?.city ?? '',
          street: u.address?.street ?? '',
          country: u.address?.country ?? 'Magyarország',
        });
        this.loading.set(false);
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'A felhasználó betöltése nem sikerült.');
        this.loading.set(false);
      },
    });
  }

  // Once someone has set (or removed) their own photo, it's theirs - the
  // server refuses an admin change too (see userPhotoController.js). An
  // admin's own record is never locked for themselves.
  photoLocked(): boolean {
    const u = this.user();
    return !!u && u.photoSetBy === 'self' && u._id !== this.auth.user()?.id;
  }

  onPhotoChanged(change: PhotoChange) {
    this.user.update((u) => (u ? { ...u, ...change } : u));
    // An admin editing their own record here - keep the header in sync.
    if (this.user()?._id === this.auth.user()?.id) {
      this.auth.patchCurrentUser({ photoUpdatedAt: change.photoUpdatedAt });
    }
  }

  updateAddress(field: keyof AddressForm, value: string) {
    this.address.update((a) => ({ ...a, [field]: value }));
  }

  // Back to the list it was opened from (?lista=klubtagok / tobbiek /
  // mindenki - see members.ts), or the first one.
  back() {
    const lista = this.route.snapshot.queryParamMap.get('lista');
    this.router.navigate(['/klub/felhasznalok'], lista ? { queryParams: { lista } } : {});
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

  // false: saved, but the address couldn't be found - worth fixing here.
  private handleSaveResult(
    res: { data: { user: AdminUser; addressResolved?: boolean | null } },
    successMessage: string,
  ): boolean {
    this.saving.set(false);
    if (res.data.addressResolved === false) {
      this.notifications.addError(
        'A cím nem található be pontosan - próbáld a hivatalos (pl. angol vagy román) városnevet is, ha külföldi cím.',
      );
      return false;
    }
    this.notifications.addSuccess(successMessage);
    return true;
  }

  save() {
    if (this.saving()) return;

    if (this.isCreateMode) {
      const name = this.name().trim();
      if (!name) {
        this.notifications.addError('A névnek nem lehet üres.');
        return;
      }

      this.saving.set(true);
      this.userService
        .createUser({
          name,
          email: this.email().trim() || undefined,
          familyId: this.familyId().trim() || undefined,
          birthday: this.birthday() || undefined,
          gender: this.gender() || undefined,
          memberSince: this.memberSince() ? Number(this.memberSince()) : undefined,
          role: this.role(),
          address: this.address(),
        })
        .subscribe({
          next: (res) => {
            this.handleSaveResult(res, 'Felhasználó létrehozva');
            // Back to the list, not this same page in edit mode - unlike
            // tour-edit.ts's own "land in edit mode" pattern, there's
            // nothing left here the create form doesn't already cover
            // (role/address included), so there's no reason to
            // keep the admin on this page after a successful save.
            this.back();
          },
          error: (err) => {
            this.notifications.addError(err?.error?.message ?? 'Hiba történt a létrehozás során.');
            this.saving.set(false);
          },
        });
      return;
    }

    this.saving.set(true);
    this.userService
      .updateUser(this.userId!, {
        email: this.email().trim(),
        username: this.username().trim(),
        familyId: this.familyId().trim(),
        birthday: this.birthday(),
        gender: this.gender(),
        memberSince: this.memberSince() ? Number(this.memberSince()) : null,
        role: this.role(),
        address: this.address(),
      })
      .subscribe({
        next: (res) => {
          this.user.set(res.data.user);
          // Done - back to the list it was opened from (unless the address
          // needs another look).
          if (this.handleSaveResult(res, 'Felhasználó mentve')) this.back();
        },
        error: (err) => {
          this.notifications.addError(err?.error?.message ?? 'Hiba történt a mentés során.');
          this.saving.set(false);
        },
      });
  }
}
