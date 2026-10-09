import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TabOption, TabStrip } from '../../../components/tab-strip/tab-strip';
import { AuthService } from '../../../auth/auth.service';
import { OidcSettingsTab } from './oidc-settings/oidc-settings';
import { ClubSettingsTab } from './club-settings/club-settings';
import { AppSettingsTab } from './app-settings/app-settings';
import { InfoSettingsTab } from './info-settings/info-settings';

// The page's tabs: the club and its money, what the app does by itself,
// the info cards (Értesítések, Szoftver verziók) - and, for the role
// manager alone, the OIDC provider people log in through.
type SettingsTab = 'club' | 'app' | 'info' | 'oidc';

// Each tab's name in the address (?lap=...).
export const TAB_KEYS: Record<SettingsTab, string> = {
  club: 'klub',
  app: 'ertesitesek',
  info: 'info',
  oidc: 'oidc',
};
const TAB_BY_KEY: Record<string, SettingsTab> = Object.fromEntries(
  Object.entries(TAB_KEYS).map(([tab, key]) => [key, tab as SettingsTab]),
);

// Klub → Beállítások (admin-only): club-wide settings. For now the yearly
// membership fee, as a table of amounts by the year each takes effect - a
// raise from a year on leaves older, still unpaid years at their old fee.
// A year somebody already paid for can't get a different fee (the server
// refuses it too).

@Component({
  selector: 'app-klub-settings',
  imports: [TabStrip, ClubSettingsTab, AppSettingsTab, InfoSettingsTab, OidcSettingsTab],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class KlubSettings {
  // --- The tabs ---

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);
  // OIDC szolgáltató: the role manager's alone (the server refuses anyone
  // else too).
  canManageOidc = computed(() => !!this.auth.user()?.canManageRoles);
  tabs = computed<(TabOption & { value: SettingsTab })[]>(() => [
    { value: 'club', label: 'Klub és fizetés' },
    { value: 'app', label: 'Értesítések' },
    { value: 'info', label: 'Infó' },
    ...(this.canManageOidc() ? [{ value: 'oidc' as const, label: 'OIDC szolgáltató' }] : []),
  ]);
  // The open tab - also in the address (?lap=klub / ertesitesek /
  // info / oidc), so a reload stays on it.
  activeTab = signal<SettingsTab>(this.tabFromAddress());

  private tabFromAddress(): SettingsTab {
    const tab = TAB_BY_KEY[this.route.snapshot.queryParamMap.get('lap') ?? ''] ?? 'club';
    return tab === 'oidc' && !this.canManageOidc() ? 'club' : tab;
  }

  selectTab(tab: SettingsTab) {
    this.activeTab.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { lap: TAB_KEYS[tab] },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
