import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AuditAction, AuditEntry, SettingsService } from '../../../services/settings';

// What each kind of entry is called on its label.
const ACTION_LABELS: Record<AuditAction, string> = {
  'role-change': 'Szerepkör',
  'cash-advance': 'Készpénzes előleg',
  'cash-membership': 'Készpénzes tagdíj',
  'cash-undo': 'Visszavonás',
  withdrawal: 'Kiutalás',
  'barion-settings': 'Barion-számla',
  settings: 'Beállítás',
};

// Klub → Napló (admins): who did what and when, of everything that moves
// money, rights or the club's settings (server utils/auditLog.js, and the
// club settings' own history) - only to read. Newest first, fifty at a time.
@Component({
  selector: 'app-audit-log',
  imports: [DatePipe],
  templateUrl: './audit-log.html',
  styleUrl: './audit-log.scss',
})
export class AuditLog implements OnInit {
  private settingsService = inject(SettingsService);

  entries = signal<AuditEntry[]>([]);
  hasMore = signal(false);
  loading = signal(true);
  failed = signal(false);

  ngOnInit() {
    this.load();
  }

  label(action: AuditAction): string {
    return ACTION_LABELS[action] ?? action;
  }

  // The first fifty, or the fifty before the last one shown.
  load() {
    const last = this.entries().at(-1);
    this.loading.set(true);
    this.failed.set(false);
    this.settingsService.getAuditLog(last?.at).subscribe({
      next: (res) => {
        this.entries.update((shown) => [...shown, ...res.data.entries]);
        this.hasMore.set(res.data.hasMore);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }
}
