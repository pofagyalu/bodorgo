import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { OidcSettings, SettingsService } from '../../../../services/settings';

// Klub → Beállítások → OIDC szolgáltató: where everybody logs in. The role
// manager's alone (the server refuses anyone else too) - the settings page
// shows this tab to no one else. A wrong value here locks everyone out,
// hence the warning on top and the question before each save.
@Component({
  selector: 'app-oidc-settings',
  imports: [FormsModule, MatIconModule],
  templateUrl: './oidc-settings.html',
  styleUrl: './oidc-settings.scss',
})
export class OidcSettingsTab implements OnInit {
  private settingsService = inject(SettingsService);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);

  oidc = signal<OidcSettings | null>(null);
  // The form. The two secrets start empty every time: the server never
  // sends them, and an empty one keeps what's in use.
  oidcServerUrl = signal('');
  oidcProviderSlug = signal('');
  oidcClientId = signal('');
  oidcClientSecret = signal('');
  oidcPostLogout = signal('');
  oidcApiToken = signal('');
  oidcRemoveApiToken = signal(false);
  oidcInvitationFlow = signal('');
  savingOidc = signal(false);

  oidcDirty = computed(() => {
    const o = this.oidc();
    return (
      !!o &&
      (o.serverUrl !== this.oidcServerUrl().trim() ||
        o.providerSlug !== this.oidcProviderSlug().trim() ||
        o.clientId !== this.oidcClientId().trim() ||
        o.postLogoutRedirectUri !== this.oidcPostLogout().trim() ||
        o.invitationFlow !== this.oidcInvitationFlow().trim() ||
        !!this.oidcClientSecret().trim() ||
        !!this.oidcApiToken().trim() ||
        this.oidcRemoveApiToken())
    );
  });

  // Still only in the server's .env: saving (even unchanged) moves them here.
  oidcNotSavedYet = computed(() => {
    const o = this.oidc();
    return !!o && o.source === 'env' && !o.unreadable;
  });

  // Information only, for setting a provider up: what to list among its
  // Redirect URIs (from the server), each with what it is for.
  redirectUris = computed(() =>
    (this.oidc()?.redirectUris ?? []).map((uri) => ({
      uri,
      note: !uri.endsWith('/auth/callback')
        ? 'kilépés után ide érkezik (Logout URI)'
        : uri.startsWith('http://localhost')
          ? 'belépés után ide érkezik – a saját gépeden futó szerver'
          : 'belépés után ide érkezik – az éles szerver',
    })),
  );

  // --- The providers: Authentik (always) and any others next to it ---

  // Whose settings are open under the list: 'authentik', another
  // provider's id, or 'new' (one being added).
  oidcOpen = signal('authentik');
  providerRows = computed(() => [
    { id: 'authentik', name: 'Authentik' },
    ...(this.oidc()?.providers ?? []),
  ]);
  openedProvider = computed(
    () => this.oidc()?.providers.find((p) => p.id === this.oidcOpen()) ?? null,
  );
  // The open one's form (the secret starts empty every time, as above).
  pName = signal('');
  pIssuerUrl = signal('');
  pClientId = signal('');
  pClientSecret = signal('');
  pPostLogout = signal('');
  pVerifiedOnly = signal(true);
  savingProvider = signal(false);
  activatingOidc = signal(false);

  providerDirty = computed(() => {
    const p = this.openedProvider();
    if (!p) return !!this.pName().trim() || !!this.pIssuerUrl().trim() || !!this.pClientId().trim();
    return (
      p.name !== this.pName().trim() ||
      p.issuerUrl !== this.pIssuerUrl().trim() ||
      p.clientId !== this.pClientId().trim() ||
      p.postLogoutRedirectUri !== this.pPostLogout().trim() ||
      p.requireVerifiedEmail !== this.pVerifiedOnly() ||
      !!this.pClientSecret().trim()
    );
  });

  // Opens a provider's settings (again: what was typed into them is gone).
  openProvider(id: string) {
    this.oidcOpen.set(id);
    const p = this.openedProvider();
    this.pName.set(p?.name ?? '');
    this.pIssuerUrl.set(p?.issuerUrl ?? '');
    this.pClientId.set(p?.clientId ?? '');
    this.pClientSecret.set('');
    this.pPostLogout.set(p?.postLogoutRedirectUri ?? '');
    this.pVerifiedOnly.set(p?.requireVerifiedEmail ?? true);
  }

  async saveProvider() {
    if (this.savingProvider()) return;
    const saved = this.openedProvider();
    const ok = await this.confirm.ask({
      message: saved ? `Biztosan mented: ${saved.name}?` : 'Biztosan felveszed az új szolgáltatót?',
      detail:
        'A szerver előbb megnézi, hogy a szolgáltató válaszol-e az Issuer URL-en, de a Client ID-t és a secretet nem tudja ellenőrizni.',
      confirmText: 'Mentés',
    });
    if (!ok) return;
    this.savingProvider.set(true);
    const input = {
      name: this.pName().trim(),
      issuerUrl: this.pIssuerUrl().trim(),
      clientId: this.pClientId().trim(),
      clientSecret: this.pClientSecret().trim(),
      postLogoutRedirectUri: this.pPostLogout().trim(),
      requireVerifiedEmail: this.pVerifiedOnly(),
    };
    const request = saved
      ? this.settingsService.updateOidcProvider(saved.id, input)
      : this.settingsService.addOidcProvider(input);
    request.subscribe({
      next: (res) => {
        this.applyOidc(res.data);
        this.openProvider(saved?.id ?? (res.data as { created?: string }).created ?? 'authentik');
        this.savingProvider.set(false);
        this.notifications.addSuccess(`${input.name} mentve.`);
      },
      error: (err) => {
        this.savingProvider.set(false);
        this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
      },
    });
  }

  async deleteProvider(id: string) {
    const provider = this.oidc()?.providers.find((p) => p.id === id);
    if (!provider || this.savingProvider()) return;
    const ok = await this.confirm.ask({
      message: `Biztosan törlöd: ${provider.name}?`,
      detail: 'A beállításai és a mentett secretje elvesznek.',
    });
    if (!ok) return;
    this.savingProvider.set(true);
    this.settingsService.deleteOidcProvider(id).subscribe({
      next: (res) => {
        this.applyOidc(res.data);
        this.openProvider('authentik');
        this.savingProvider.set(false);
        this.notifications.addSuccess(`${provider.name} törölve.`);
      },
      error: (err) => {
        this.savingProvider.set(false);
        this.notifications.addError(err?.error?.message ?? 'A törlés nem sikerült.');
      },
    });
  }

  // The radio buttons: from now on everybody logs in through this one.
  async activateProvider(id: string) {
    const o = this.oidc();
    const row = this.providerRows().find((p) => p.id === id);
    if (!o || !row || o.active === id || this.activatingOidc()) return;
    const ok = await this.confirm.ask({
      title: 'VESZÉLYES ZÓNA!!!',
      message: `Biztosan ezentúl mindenki ezen keresztül lépjen be: ${row.name}?`,
      detail:
        'Ha a beállításai hibásak, senki nem tud belépni – te sem. Aki most be van lépve, az marad; a következő belépés már itt történik.',
      confirmText: 'Legyen ez az aktív',
    });
    if (!ok) return;
    this.activatingOidc.set(true);
    this.settingsService.setActiveOidcProvider(id).subscribe({
      next: (res) => {
        this.oidc.set(res.data);
        this.activatingOidc.set(false);
        this.notifications.addSuccess(`Az aktív szolgáltató: ${row.name}.`);
      },
      error: (err) => {
        this.activatingOidc.set(false);
        this.notifications.addError(err?.error?.message ?? 'A váltás nem sikerült.');
      },
    });
  }

  ngOnInit() {
    this.settingsService.getOidcSettings().subscribe({
      next: (res) => this.applyOidc(res.data),
      error: () => {},
    });
  }

  private applyOidc(o: OidcSettings) {
    this.oidc.set(o);
    this.oidcServerUrl.set(o.serverUrl);
    this.oidcProviderSlug.set(o.providerSlug);
    this.oidcClientId.set(o.clientId);
    this.oidcClientSecret.set('');
    this.oidcPostLogout.set(o.postLogoutRedirectUri);
    this.oidcApiToken.set('');
    this.oidcRemoveApiToken.set(false);
    this.oidcInvitationFlow.set(o.invitationFlow);
  }

  resetOidc() {
    const o = this.oidc();
    if (o) this.applyOidc(o);
  }

  async saveOidc() {
    if (this.savingOidc()) return;
    const ok = await this.confirm.ask({
      message: 'Biztosan mented az OIDC szolgáltató beállításait?',
      detail:
        'Hibás értékkel senki nem tud belépni – te sem. A szerver előbb megnézi, hogy a szolgáltató válaszol-e az új címen, de a Client ID-t és a secretet nem tudja ellenőrizni.',
      confirmText: 'Mentés',
    });
    if (!ok) return;
    this.savingOidc.set(true);
    this.settingsService
      .updateOidcSettings({
        serverUrl: this.oidcServerUrl().trim(),
        providerSlug: this.oidcProviderSlug().trim(),
        clientId: this.oidcClientId().trim(),
        clientSecret: this.oidcClientSecret().trim(),
        postLogoutRedirectUri: this.oidcPostLogout().trim(),
        apiToken: this.oidcApiToken().trim(),
        removeApiToken: this.oidcRemoveApiToken(),
        invitationFlow: this.oidcInvitationFlow().trim(),
      })
      .subscribe({
        next: (res) => {
          this.applyOidc(res.data);
          this.savingOidc.set(false);
          this.notifications.addSuccess('OIDC szolgáltató mentve.');
        },
        error: (err) => {
          this.savingOidc.set(false);
          this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
        },
      });
  }
}
