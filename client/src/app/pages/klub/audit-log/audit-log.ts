import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../auth/auth.service';
import { TabOption, TabStrip } from '../../../components/tab-strip/tab-strip';
import { LogFiles } from './log-files/log-files';
import { AuditAction, AuditEntry, SettingsService } from '../../../services/settings';

import { Loading } from '../../../shared/loading/loading';
// What each kind of entry is called on its label.
const ACTION_LABELS: Record<AuditAction, string> = {
  'role-change': 'Szerepkör',
  'email-change': 'E-mail-cím',
  'cash-advance': 'Készpénzes előleg',
  'cash-membership': 'Készpénzes tagdíj',
  'cash-undo': 'Visszavonás',
  withdrawal: 'Kiutalás',
  'logout-everywhere': 'Kijelentkeztetés',
  'barion-settings': 'Barion-számla',
  settings: 'Beállítás',
};

type AuditTab = 'events' | 'files';

// Klub → Napló (admins): who did what and when, of everything that moves
// money, rights or the club's settings (server utils/auditLog.js, and the
// club settings' own history) - only to read. Newest first, fifty at a time.
// The role manager has a second tab: Naplófájlok, the server's own log
// files (log-files) - in the address as ?lap=fajlok.
@Component({
  selector: 'app-audit-log',
  imports: [Loading, DatePipe, TabStrip, LogFiles],
  templateUrl: './audit-log.html',
  styleUrl: './audit-log.scss',
})
export class AuditLog implements OnInit {
  private settingsService = inject(SettingsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);

  // --- The tabs: Események for every admin, Naplófájlok for the role
  // manager alone ---

  canSeeFiles = computed(() => !!this.auth.user()?.canManageRoles);
  tabs = computed<(TabOption & { value: AuditTab })[]>(() => [
    { value: 'events', label: 'Események' },
    ...(this.canSeeFiles() ? [{ value: 'files' as const, label: 'Naplófájlok' }] : []),
  ]);
  activeTab = signal<AuditTab>(
    this.route.snapshot.queryParamMap.get('lap') === 'fajlok' ? 'files' : 'events',
  );
  // Naplófájlok is built the first time it is opened (it asks to
  // re-identify), then kept.
  filesOpened = signal(this.activeTab() === 'files');
  showFiles = computed(() => this.canSeeFiles() && this.activeTab() === 'files');

  selectTab(tab: AuditTab) {
    this.activeTab.set(tab);
    if (tab === 'files') this.filesOpened.set(true);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { lap: tab === 'files' ? 'fajlok' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

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
