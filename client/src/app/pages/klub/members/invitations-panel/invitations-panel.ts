import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '../../../../../environments/environment';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';

// Felhasználók → Meghívók (admins): everyone added with an e-mail who has
// never logged in gets their own Authentik invitation link by e-mail - one
// by one (a test, a resend) or in the two batches: club members first,
// everyone else a few days later (server invitationController.js).

export interface InvitationPerson {
  _id: string;
  name: string;
  email: string;
  role: 'admin' | 'member' | 'guest';
  status: 'none' | 'sent' | 'expired' | 'joined';
  sentAt: string | null;
  expiresAt: string | null;
  sentByName: string | null;
}

const ROLE_NAMES = { admin: 'Admin', member: 'Klubtag', guest: 'Vendég' };

@Component({
  selector: 'app-invitations-panel',
  imports: [DatePipe, MatIconModule],
  templateUrl: './invitations-panel.html',
  styleUrl: './invitations-panel.scss',
})
export class InvitationsPanel implements OnInit {
  private http = inject(HttpClient);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);
  private apiUrl = `${environment.apiBaseUrl}/users`;

  readonly roleNames = ROLE_NAMES;
  loading = signal(true);
  enabled = signal(true);
  days = signal(30);
  people = signal<InvitationPerson[]>([]);
  busy = signal<string | null>(null); // a person's id, 'members' or 'others'

  // Not invited yet, per batch.
  private waiting = (p: InvitationPerson) => p.status === 'none';
  membersWaiting = computed(
    () => this.people().filter((p) => this.waiting(p) && p.role !== 'guest').length,
  );
  othersWaiting = computed(
    () => this.people().filter((p) => this.waiting(p) && p.role === 'guest').length,
  );
  counts = computed(() => {
    const c = { none: 0, sent: 0, expired: 0, joined: 0 };
    for (const p of this.people()) c[p.status]++;
    return c;
  });

  ngOnInit() {
    this.load();
  }

  private load() {
    this.http
      .get<{
        data: { enabled: boolean; days: number; people: InvitationPerson[] };
      }>(`${this.apiUrl}/invitations`)
      .subscribe({
        next: (res) => {
          this.enabled.set(res.data.enabled);
          this.days.set(res.data.days);
          this.people.set(res.data.people);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.notifications.addError('A meghívók betöltése nem sikerült.');
        },
      });
  }

  async sendBatch(group: 'members' | 'others') {
    const count = group === 'members' ? this.membersWaiting() : this.othersWaiting();
    const ok = await this.confirm.ask({
      title: group === 'members' ? 'Klubtagok meghívása' : 'A többiek meghívása',
      message: `${count} ember kap most meghívó e-mailt a saját linkjével.`,
      detail: `A linkek ${this.days()} napig érvényesek. Akit már meghívtál, most nem kap újat.`,
      confirmText: 'Küldés',
      danger: false,
    });
    if (ok) this.send({ group }, group);
  }

  async sendOne(p: InvitationPerson) {
    const again = p.status !== 'none';
    const ok = await this.confirm.ask({
      title: again ? 'Új meghívó' : 'Meghívás',
      message: `${p.name} (${p.email}) meghívó e-mailt kap.`,
      detail: again ? 'Az előző linkje ezzel érvényét veszti.' : undefined,
      confirmText: 'Küldés',
      danger: false,
    });
    if (ok) this.send({ userIds: [p._id] }, p._id);
  }

  private send(body: object, busyKey: string) {
    this.busy.set(busyKey);
    this.http
      .post<{
        data: { sent: string[]; failed: { name: string; message: string }[] };
      }>(`${this.apiUrl}/invitations`, body)
      .subscribe({
        next: (res) => {
          this.busy.set(null);
          const { sent, failed } = res.data;
          if (sent.length) this.notifications.addSuccess(`Meghívó elküldve: ${sent.length} ember.`);
          if (!sent.length && !failed.length) this.notifications.addSuccess('Nincs kinek küldeni.');
          for (const f of failed) this.notifications.addError(`${f.name}: ${f.message}`);
          this.load();
        },
        error: (err) => {
          this.busy.set(null);
          this.notifications.addError(err?.error?.message ?? 'A küldés nem sikerült.');
        },
      });
  }

  async revoke(p: InvitationPerson) {
    const ok = await this.confirm.ask({
      message: `Visszavonod ${p.name} meghívóját?`,
      detail: 'A linkje azonnal érvényét veszti. Később újat küldhetsz.',
      confirmText: 'Visszavonás',
    });
    if (!ok) return;
    this.busy.set(p._id);
    this.http.delete(`${this.apiUrl}/${p._id}/invitation`).subscribe({
      next: () => {
        this.busy.set(null);
        this.notifications.addSuccess('Meghívó visszavonva.');
        this.load();
      },
      error: (err) => {
        this.busy.set(null);
        this.notifications.addError(err?.error?.message ?? 'A visszavonás nem sikerült.');
      },
    });
  }
}
