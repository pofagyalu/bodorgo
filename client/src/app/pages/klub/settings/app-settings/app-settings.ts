import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { BirthdaySettings, SettingsService, YearlyReportInfo } from '../../../../services/settings';
import { NotificationsService } from '../../../../notifications/notifications.service';
import {
  BIRTHDAY_EFFECTS,
  BirthdayEffect,
  BirthdayService,
} from '../../../../shared/birthday/birthday.service';
import { AuthService } from '../../../../auth/auth.service';

import { Loading } from '../../../../shared/loading/loading';
// Klub → Beállítások → Értesítések: what the app sends by itself - the
// yearly report, the birthday and rank greetings. One of the settings page's tabs
// (settings.ts shows them; every tab stays in the DOM, only hidden).
@Component({
  selector: 'app-app-settings',
  imports: [Loading, FormsModule, MatIconModule],
  templateUrl: './app-settings.html',
  styleUrl: './app-settings.scss',
})
export class AppSettingsTab implements OnInit {
  private settingsService = inject(SettingsService);
  private notifications = inject(NotificationsService);
  private auth = inject(AuthService);

  ngOnInit() {
    this.loadYearlyReport();
    this.loadBirthday();
    this.loadRank();
  }

  // --- Éves jelentés: the club's year on one page, e-mailed on 1 January ---

  yearlyReport = signal<YearlyReportInfo | null>(null);
  readonly yearlyReportPdfUrl = this.settingsService.yearlyReportPdfUrl();
  sendingYearlyTest = signal(false);

  private loadYearlyReport() {
    this.settingsService.getYearlyReport().subscribe({
      next: (res) => this.yearlyReport.set(res.data),
      error: () => {},
    });
  }

  sendTestYearlyReport() {
    if (this.sendingYearlyTest()) return;
    this.sendingYearlyTest.set(true);
    this.settingsService.testYearlyReport().subscribe({
      next: (res) => {
        this.sendingYearlyTest.set(false);
        this.notifications.addSuccess(`Próba e-mail elküldve: ${res.data.sentTo}`);
      },
      error: (err) => {
        this.sendingYearlyTest.set(false);
        this.notifications.addError(err?.error?.message ?? 'A próba e-mail nem ment el.');
      },
    });
  }

  // --- Születésnap: the birthday greeting (shared/birthday) ---

  private birthday = inject(BirthdayService);
  readonly birthdayEffects = BIRTHDAY_EFFECTS;

  birthdaySaved = signal<BirthdaySettings | null>(null);
  bdEnabled = signal(true);
  bdEffect = signal<BirthdayEffect>('confetti');
  bdMessage = signal('');
  savingBirthday = signal(false);

  birthdayDirty = computed(() => {
    const b = this.birthdaySaved();
    return (
      !!b &&
      (b.enabled !== this.bdEnabled() ||
        b.effect !== this.bdEffect() ||
        b.message !== this.bdMessage().trim())
    );
  });

  private loadBirthday() {
    this.settingsService.getBirthdaySettings().subscribe({
      next: (res) => this.applyBirthday(res.data),
      error: () => {},
    });
  }

  private applyBirthday(b: BirthdaySettings) {
    this.birthdaySaved.set(b);
    this.bdEnabled.set(b.enabled);
    this.bdEffect.set(b.effect);
    this.bdMessage.set(b.message);
  }

  resetBirthday() {
    const b = this.birthdaySaved();
    if (b) this.applyBirthday(b);
  }

  // Plays it on my own screen now, as set in the form (saved or not) - with
  // my own given name in {név} (the last part of a Hungarian name).
  previewBirthday() {
    const myName = (this.auth.user()?.name ?? '').trim().split(/\s+/).at(-1) ?? '';
    const text = (this.bdMessage().trim() || 'Boldog születésnapot, {név}! 🎂').replaceAll(
      '{név}',
      myName,
    );
    void this.birthday.play(this.bdEffect(), text);
  }

  saveBirthday() {
    if (this.savingBirthday()) return;
    this.savingBirthday.set(true);
    this.settingsService
      .updateBirthdaySettings({
        enabled: this.bdEnabled(),
        effect: this.bdEffect(),
        message: this.bdMessage().trim(),
      })
      .subscribe({
        next: (res) => {
          this.applyBirthday(res.data);
          this.savingBirthday.set(false);
          this.notifications.addSuccess('Születésnap beállítás mentve.');
        },
        error: (err) => {
          this.savingBirthday.set(false);
          this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
        },
      });
  }

  // --- Rangok ünneplése: a newly reached rank (shared/birthday) ---

  rankSaved = signal<BirthdaySettings | null>(null);
  rkEnabled = signal(true);
  rkEffect = signal<BirthdayEffect>('fireworks');
  rkMessage = signal('');
  savingRank = signal(false);

  rankDirty = computed(() => {
    const r = this.rankSaved();
    return (
      !!r &&
      (r.enabled !== this.rkEnabled() ||
        r.effect !== this.rkEffect() ||
        r.message !== this.rkMessage().trim())
    );
  });

  private loadRank() {
    this.settingsService.getRankSettings().subscribe({
      next: (res) => this.applyRank(res.data),
      error: () => {},
    });
  }

  private applyRank(r: BirthdaySettings) {
    this.rankSaved.set(r);
    this.rkEnabled.set(r.enabled);
    this.rkEffect.set(r.effect);
    this.rkMessage.set(r.message);
  }

  resetRank() {
    const r = this.rankSaved();
    if (r) this.applyRank(r);
  }

  // Plays it on my own screen now, as set in the form - as if I had just
  // reached Bronz with 10 tours.
  previewRank() {
    const myName = (this.auth.user()?.name ?? '').trim().split(/\s+/).at(-1) ?? '';
    const text = (this.rkMessage().trim() || 'Kedves {név}! Túléltél {szám} bódorgót!')
      .replaceAll('{név}', myName)
      .replaceAll('{szám}', '10')
      .replaceAll('{rang}', 'Bronz');
    void this.birthday.play(this.rkEffect(), text, 'rank');
  }

  saveRank() {
    if (this.savingRank()) return;
    this.savingRank.set(true);
    this.settingsService
      .updateRankSettings({
        enabled: this.rkEnabled(),
        effect: this.rkEffect(),
        message: this.rkMessage().trim(),
      })
      .subscribe({
        next: (res) => {
          this.applyRank(res.data);
          this.savingRank.set(false);
          this.notifications.addSuccess('Rangok ünneplése mentve.');
        },
        error: (err) => {
          this.savingRank.set(false);
          this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
        },
      });
  }
}
