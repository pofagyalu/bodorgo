import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService, AdminUser } from '../../../services/user';
import { NotificationsService } from '../../../notifications/notifications.service';

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
// page's admin table used to manage - name stays read-only here too
// (it comes from Authentik, nobody edits it directly in this app).
@Component({
  selector: 'app-member-edit',
  imports: [],
  templateUrl: './member-edit.html',
  styleUrl: './member-edit.scss',
})
export class MemberEdit implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private userService = inject(UserService);
  private notifications = inject(NotificationsService);

  readonly minBirthday = '1900-01-01';
  readonly maxBirthday = new Date().toISOString().slice(0, 10);
  readonly clubFoundingYear = 2019;
  readonly currentYear = new Date().getFullYear();

  private userId = this.route.snapshot.paramMap.get('id')!;
  loading = signal(true);
  saving = signal(false);
  user = signal<AdminUser | null>(null);

  email = signal('');
  familyId = signal('');
  birthday = signal('');
  gender = signal('');
  memberSince = signal('');
  role = signal('guest');
  address = signal<AddressForm>(emptyAddress());

  ngOnInit() {
    this.userService.getUser(this.userId).subscribe({
      next: (res) => {
        const u = res.data.user;
        this.user.set(u);
        this.email.set(u.email ?? '');
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

  initials(): string {
    const name = this.user()?.name ?? '';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  updateAddress(field: keyof AddressForm, value: string) {
    this.address.update((a) => ({ ...a, [field]: value }));
  }

  back() {
    this.router.navigate(['/klub/felhasznalok']);
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

  save() {
    if (this.saving()) return;

    this.saving.set(true);
    this.userService
      .updateUser(this.userId, {
        email: this.email().trim(),
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
          this.saving.set(false);
          if (res.data.addressResolved === false) {
            this.notifications.addError(
              'A cím nem található be pontosan - próbáld a hivatalos (pl. angol vagy román) városnevet is, ha külföldi cím.',
            );
          } else {
            this.notifications.addSuccess('Felhasználó mentve');
          }
        },
        error: (err) => {
          this.notifications.addError(err?.error?.message ?? 'Hiba történt a mentés során.');
          this.saving.set(false);
        },
      });
  }
}
