import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { UserService, MyProfile, UserAddress, AttendedTour, FamilyMember } from '../../../services/user';
import { NotificationsService } from '../../../notifications/notifications.service';
import { PaymentService } from '../../../services/payment';
import { AuthService } from '../../../auth/auth.service';
import { PushService } from '../../../services/push';
import { Avatar } from '../../../components/avatar/avatar';
import { PhotoEditor, PhotoChange } from '../../../components/photo-editor/photo-editor';

interface AttendanceRow {
  tour: AttendedTour;
  paid: boolean;
  paymentId: string | null;
  paymentMethod: 'stripe' | 'cash' | null;
}

function emptyAddress(): UserAddress {
  return { zipCode: '', city: '', street: '', country: 'Magyarország' };
}

@Component({
  selector: 'app-klub-profile',
  imports: [RouterLink, MatIconModule, Avatar, PhotoEditor],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class KlubProfile implements OnInit {
  private userService = inject(UserService);
  private notifications = inject(NotificationsService);
  private paymentService = inject(PaymentService);
  private auth = inject(AuthService);

  loading = signal(true);
  profile = signal<MyProfile | null>(null);

  // Moved here from the old top-level Profil page (now removed) - every
  // logged-in user's own tours and family roster, not just club members'.
  attendance = signal<AttendanceRow[]>([]);
  attendanceError = signal<string | null>(null);

  family = signal<FamilyMember[]>([]);
  familyError = signal<string | null>(null);

  // Signal-driven, matching the rest of the Klub area's own convention
  // (finance.ts/documents.ts/members.ts) rather than [(ngModel)] - keeps
  // this whole subtree free of a FormsModule dependency.
  usernameDraft = signal('');

  savingNotifications = signal(false);

  // Self-service home address (see userModel.js's address/location
  // fields) - lets a tour's distance/duration be computed from this
  // person's own home instead of the fixed Budapest reference point when
  // no address is on record.
  address = signal<UserAddress>(emptyAddress());
  // Username and address are both just fields on the same user document,
  // so "Személyes adatok" and "Lakcím" share one panel and one Mentés
  // button/save request (see saveProfile) rather than each having its own.
  saving = signal(false);
  // Whether the address just saved actually geocoded - null before any
  // save this session, or when there's no address at all to resolve. Told
  // to the person directly rather than letting them find out later when a
  // tour's distance quietly never changes from Budapest.
  addressResolved = signal<boolean | null>(null);

  ngOnInit() {
    this.load();
    this.loadAttendance();
    this.loadFamily();
    this.push.refresh().catch(() => {});
  }

  // Push notifications on this device (see PushService).
  push = inject(PushService);
  pushBusy = signal(false);

  async togglePush() {
    if (this.pushBusy()) return;
    this.pushBusy.set(true);
    try {
      if (this.push.state() === 'on') {
        await this.push.disable();
        this.notifications.addSuccess('Értesítések kikapcsolva ezen az eszközön.');
      } else {
        await this.push.enable();
        this.notifications.addSuccess('Értesítések bekapcsolva ezen az eszközön.');
      }
    } catch (err: any) {
      this.notifications.addError(err?.error?.message ?? err?.message ?? 'Nem sikerült beállítani az értesítéseket.');
      await this.push.refresh().catch(() => {});
    } finally {
      this.pushBusy.set(false);
    }
  }

  sendTestPush() {
    this.pushBusy.set(true);
    this.push.sendTest().subscribe({
      next: () => {
        this.pushBusy.set(false);
        this.notifications.addSuccess('Próbaértesítés elküldve - pár másodpercen belül meg kell jelennie.');
      },
      error: (err) => {
        this.pushBusy.set(false);
        this.notifications.addError(err?.error?.message ?? 'A próbaértesítés nem sikerült.');
      },
    });
  }

  private loadAttendance() {
    this.userService.getMyAttendance().subscribe({
      next: (res) => this.attendance.set(res.data.tours),
      error: () => this.attendanceError.set('A táboraid betöltése nem sikerült.'),
    });
  }

  private loadFamily() {
    this.userService.getMyFamily().subscribe({
      next: (res) => this.family.set(res.data.members),
      error: () => this.familyError.set('A hozzátartozók betöltése nem sikerült.'),
    });
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

  onPhotoChanged(change: PhotoChange) {
    this.profile.update((p) => (p ? { ...p, ...change } : p));
    // The header's own avatar too, without waiting for a reload.
    this.auth.patchCurrentUser({ photoUpdatedAt: change.photoUpdatedAt });
  }

  saveProfile() {
    const username = this.usernameDraft().trim();
    if (!username) {
      this.notifications.addError('A felhasználónév nem lehet üres.');
      return;
    }

    this.saving.set(true);
    this.userService.updateMe({ username, address: this.address() }).subscribe({
      next: (res) => {
        this.profile.update((p) => (p ? { ...p, username } : p));
        this.addressResolved.set(res.data.addressResolved ?? null);
        this.saving.set(false);
        this.notifications.addSuccess('Profil mentve');
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a mentés során.');
        this.saving.set(false);
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
