import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import {
  BuildVersion,
  CLIENT_BUILD,
  CLIENT_VERSION,
  VersionService,
} from '../../../../services/version';
import { WeatherRules } from './weather-rules/weather-rules';

// Every notification the app sends - listed on the Értesítések card so an
// admin can see what goes to whom, and when. Kept in step with the server
// by hand: each e-mail goes through server/src/utils/resendEmail.js, each
// push through server/src/utils/push.js. "Csak aki" = who's left out.
interface NotificationInfo {
  name: string;
  when: string;
  who: string;
  settings?: 'membershipReminder'; // set on this card
}

const ATTENDEE_RULE =
  'Csak akinek van e-mail címe, már bejelentkezett, és nem kapcsolta ki az e-maileket.';

const EMAILS: (NotificationInfo & { note?: string })[] = [
  {
    name: 'Sikeres jelentkezés',
    when: 'Valaki jelentkezik egy táborra.',
    who: 'Aki jelentkeztetett, és akit jelentkeztettek.',
    note: ATTENDEE_RULE,
  },
  {
    name: 'Lemondás',
    when: 'Valakit levesznek egy táborról.',
    who: 'Akit levettek, és aki őt jelentkeztette.',
    note: ATTENDEE_RULE,
  },
  {
    name: 'Tábori levél',
    when: 'Egy admin kiküldi a tábor oldaláról.',
    who: 'A tábor résztvevői (próbaküldés: csak az admin).',
    note: ATTENDEE_RULE,
  },
  {
    name: 'Programfüzet e-mailben',
    when: 'Egy admin elküldi magának próbaként.',
    who: 'Az admin.',
  },
  {
    name: 'Tábori videó megjött',
    when: 'Az „Új média felfedezése” új tábori videót talál.',
    who: 'A tábor résztvevői.',
    note: ATTENDEE_RULE,
  },
  {
    name: 'Tagdíj befizetve',
    when: 'Sikeres online tagdíjfizetés (számlával).',
    who: 'Aki fizetett.',
  },
  {
    name: 'Előleg befizetve',
    when: 'Sikeres online előlegfizetés (számlával).',
    who: 'Aki fizetett.',
  },
  {
    name: 'Mindenki befizette az előleget',
    when: 'Egy tábor utolsó résztvevője is befizeti az előleget.',
    who: 'Az adminok.',
  },
  {
    name: 'Minden klubtag befizette a tagdíjat',
    when: 'Az év utolsó tagdíja is befizetésre kerül – online fizetésnél azonnal, készpénznél egy órán belül (évente egyszer).',
    who: 'Az adminok.',
    note: 'A felfüggesztett tagok nem számítanak.',
  },
  {
    name: 'Tagdíj emlékeztető',
    when: 'A Tagdíj emlékeztető kártyán beállított napokon.',
    who: 'Aki még nem fizette be az idei tagdíjat, és már bejelentkezett. Az adminok összesítőt kapnak róla.',
    settings: 'membershipReminder',
  },
];

const PUSHES: NotificationInfo[] = [
  {
    name: 'Új Kotyogó-üzenet',
    when: 'Valaki ír a tábor Kotyogójába.',
    who: 'A tábor résztvevői, akik nem nézik épp a Kotyogót. Egy csörgés, utána csendben frissül, amíg meg nem nyitják; megemlítés (@név) mindig csörög; a Kotyogó némítható.',
  },
  {
    name: 'Új szavazás',
    when: 'Valaki szavazást indít a Kotyogóban.',
    who: 'A tábor résztvevői.',
  },
  {
    name: 'Szavazás hamarosan lezárul',
    when: '2 órával a lezárás előtt.',
    who: 'Akik még nem szavaztak.',
  },
  {
    name: 'Összejött!',
    when: 'Egy szavazási lehetőség eléri a kitűzött létszámot.',
    who: 'Akik arra szavaztak.',
  },
];

// Klub → Beállítások → Infó: every e-mail and push the app sends (a list to read), how the tours' weather outlook is worked out (weather-rules), and which versions are running. One of the settings page's tabs
// (settings.ts shows them; every tab stays in the DOM, only hidden).
@Component({
  selector: 'app-info-settings',
  imports: [MatIconModule, DatePipe, WeatherRules],
  templateUrl: './info-settings.html',
  styleUrl: './info-settings.scss',
})
export class InfoSettingsTab implements OnInit {
  readonly emails = EMAILS;
  readonly pushes = PUSHES;

  // --- Verzió: which client and server are running ---

  private versionService = inject(VersionService);
  readonly clientVersion = CLIENT_VERSION;
  readonly clientBuiltAt = CLIENT_BUILD?.builtAt ?? null;
  serverBuild = signal<BuildVersion | null>(null);

  ngOnInit() {
    this.versionService.getServerVersion().subscribe({
      next: (res) => this.serverBuild.set(res.data),
      error: () => {},
    });
  }
}
