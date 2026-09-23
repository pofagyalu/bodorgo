import { Component, OnInit, inject, signal } from '@angular/core';
import { UserService, MyProfile, UserAddress } from '../../../services/user';
import { NotificationsService } from '../../../notifications/notifications.service';

function emptyAddress(): UserAddress {
  return { zipCode: '', city: '', street: '', country: 'Magyarország' };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

@Component({
  selector: 'app-klub-profile',
  imports: [],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class KlubProfile implements OnInit {
  private userService = inject(UserService);
  private notifications = inject(NotificationsService);

  loading = signal(true);
  profile = signal<MyProfile | null>(null);

  // Signal-driven, matching the rest of the Klub area's own convention
  // (finance.ts/documents.ts/members.ts) rather than [(ngModel)] - keeps
  // this whole subtree free of a FormsModule dependency.
  usernameDraft = signal('');
  savingUsername = signal(false);

  savingNotifications = signal(false);

  // Self-service home address (see userModel.js's address/location
  // fields) - lets a tour's distance/duration be computed from this
  // person's own home instead of the fixed Budapest reference point when
  // no address is on record.
  address = signal<UserAddress>(emptyAddress());
  savingAddress = signal(false);
  // Whether the address just saved actually geocoded - null before any
  // save this session, or when there's no address at all to resolve. Told
  // to the person directly rather than letting them find out later when a
  // tour's distance quietly never changes from Budapest.
  addressResolved = signal<boolean | null>(null);

  ngOnInit() {
    this.load();
  }

  private load() {
    this.userService.getMe().subscribe({
      next: (res) => {
        this.profile.set(res.data);
        this.usernameDraft.set(res.data.username ?? '');
        this.address.set({
          zipCode: res.data.address?.zipCode ?? '',
          city: res.data.address?.city ?? '',
          street: res.data.address?.street ?? '',
          country: res.data.address?.country ?? 'Magyarország',
        });
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load my profile', err);
        this.loading.set(false);
      },
    });
  }

  updateAddress(field: keyof UserAddress, value: string) {
    this.address.update((a) => ({ ...a, [field]: value }));
  }

  saveAddress() {
    this.savingAddress.set(true);
    this.userService.updateMe({ address: this.address() }).subscribe({
      next: (res) => {
        this.savingAddress.set(false);
        this.addressResolved.set(res.data.addressResolved ?? null);
        this.notifications.addSuccess('Cím mentve');
      },
      error: (err) => {
        this.savingAddress.set(false);
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a mentés során.');
      },
    });
  }

  initials(): string {
    const name = this.profile()?.name;
    return name ? initials(name) : '?';
  }

  saveUsername() {
    const username = this.usernameDraft().trim();
    if (!username) {
      this.notifications.addError('A felhasználónév nem lehet üres.');
      return;
    }

    this.savingUsername.set(true);
    this.userService.updateMe({ username }).subscribe({
      next: () => {
        this.profile.update((p) => (p ? { ...p, username } : p));
        this.savingUsername.set(false);
        this.notifications.addSuccess('Felhasználónév mentve');
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a mentés során.');
        this.savingUsername.set(false);
      },
    });
  }

  toggleEmailNotifications() {
    const current = this.profile();
    if (!current) return;

    const next = !current.wantsEmailNotifications;
    this.savingNotifications.set(true);
    this.userService.updateMe({ wantsEmailNotifications: next }).subscribe({
      next: () => {
        this.profile.update((p) => (p ? { ...p, wantsEmailNotifications: next } : p));
        this.savingNotifications.set(false);
        this.notifications.addSuccess('Beállítás mentve');
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a mentés során.');
        this.savingNotifications.set(false);
      },
    });
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
