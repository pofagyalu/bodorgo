import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import {
  BuildVersion,
  CLIENT_BUILD,
  CLIENT_VERSION,
  VersionService,
} from '../../../../services/version';

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
    name: 'Új szavazás',
    when: 'Egy admin új szavazást indít a Voks oldalon, és bejelöli az „E-mail értesítés küldése” jelölőnégyzetet.',
    who: 'Az általa kiválasztott klubtagok (alapból mindenki).',
    note: 'Csak akinek van e-mail címe, és nem kapcsolta ki az e-maileket - akkor is, ha még nem lépett be. A felfüggesztett tagok nem kapják.',
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
    when: 'A Klub lap Tagdíj emlékeztető kártyáján beállított napokon.',
    who: 'Minden klubtag, aki még nem fizette be az idei tagdíjat - akkor is, ha még nem lépett be, és akkor is, ha a Profilom oldalon kikapcsolta az e-maileket (ez kötelező). Az adminok összesítőt kapnak róla.',
    settings: 'membershipReminder',
  },
  {
    name: 'Éves jelentés',
    when: 'Január 1-jén reggel 9 után, az előző évről (évente egyszer).',
    who: 'Minden klubtag, PDF melléklettel (próbaküldés: csak az admin).',
    note: 'Csak akinek van e-mail címe, és nem kapcsolta ki az e-maileket. A felfüggesztett tagok nem kapják.',
  },
  {
    name: 'Érzékeny művelet',
    when: 'Valaki szerepkört ad vagy módosít, kiutalást indít a számlára, vagy megváltoztatja egy Barion-számla vagy a bejelentkezés (OIDC szolgáltató) beállításait.',
    who: 'Az adminok.',
    note: 'Ezek és a készpénzes befizetések a Klub → Napló oldalon is megvannak; mindegyikhez 10 percen belüli azonosítás kell.',
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

// Klub → Beállítások → Infó: every e-mail and push the app sends (a list to read), and which versions are running. One of the settings page's tabs
// (settings.ts shows them; every tab stays in the DOM, only hidden).
@Component({
  selector: 'app-info-settings',
  imports: [MatIconModule, DatePipe],
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
