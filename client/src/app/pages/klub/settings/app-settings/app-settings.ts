import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import {
  BirthdaySettings,
  MembershipReminder,
  SettingsService,
} from '../../../../services/settings';
import { NotificationsService } from '../../../../notifications/notifications.service';
import {
  BIRTHDAY_EFFECTS,
  BirthdayEffect,
  BirthdayService,
} from '../../../../shared/birthday/birthday.service';
import { AuthService } from '../../../../auth/auth.service';

const MONTHS = [
  'január',
  'február',
  'március',
  'április',
  'május',
  'június',
  'július',
  'augusztus',
  'szeptember',
  'október',
  'november',
  'december',
];

// Klub → Beállítások → Értesítések: what the app sends by itself - the fee
// reminder, the birthday and rank greetings. One of the settings page's tabs
// (settings.ts shows them; every tab stays in the DOM, only hidden).
@Component({
  selector: 'app-app-settings',
  imports: [FormsModule, MatIconModule],
  templateUrl: './app-settings.html',
  styleUrl: './app-settings.scss',
})
export class AppSettingsTab implements OnInit {
  private settingsService = inject(SettingsService);
  private notifications = inject(NotificationsService);
  private auth = inject(AuthService);

  ngOnInit() {
    this.loadReminder();
    this.loadBirthday();
    this.loadRank();
  }

  // --- Tagdíj emlékeztető: the one notification that is set here ---

  readonly months = MONTHS;

  reminderLoading = signal(true);
  reminder = signal<MembershipReminder | null>(null);
  reminderRecipients = signal<string[]>([]);
  // The form (saved with Mentés).
  reminderEnabled = signal(false);
  reminderMonth = signal(3);
  reminderDay = signal(1);
  reminderFrequency = signal<'monthly' | 'quarterly'>('quarterly');
  savingReminder = signal(false);
  sendingTest = signal(false);

  reminderDirty = computed(() => {
    const r = this.reminder();
    return (
      !!r &&
      (r.enabled !== this.reminderEnabled() ||
        r.startMonth !== Number(this.reminderMonth()) ||
        r.startDay !== Number(this.reminderDay()) ||
        r.frequency !== this.reminderFrequency())
    );
  });

  // This year's rounds for what's in the form right now - so the effect
  // of a change shows before saving ("1 March quarterly: Mar, Jun, Sep, Dec").
  previewDates = computed(() => {
    const step = this.reminderFrequency() === 'monthly' ? 1 : 3;
    const day = Number(this.reminderDay());
    const dates: string[] = [];
    for (let m = Number(this.reminderMonth()); m <= 12; m += step) {
      dates.push(`${MONTHS[m - 1]} ${day}.`);
    }
    return dates;
  });

  private loadReminder() {
    this.settingsService.getMembershipReminder().subscribe({
      next: (res) => {
        this.applyReminder(res.data.reminder);
        this.reminderRecipients.set(res.data.recipients);
        this.reminderLoading.set(false);
      },
      error: () => this.reminderLoading.set(false),
    });
  }

  private applyReminder(r: MembershipReminder) {
    this.reminder.set(r);
    this.reminderEnabled.set(r.enabled);
    this.reminderMonth.set(r.startMonth);
    this.reminderDay.set(r.startDay);
    this.reminderFrequency.set(r.frequency);
  }

  resetReminder() {
    const r = this.reminder();
    if (r) this.applyReminder(r);
  }

  saveReminder() {
    if (this.savingReminder()) return;
    this.savingReminder.set(true);
    this.settingsService
      .updateMembershipReminder({
        enabled: this.reminderEnabled(),
        startMonth: Number(this.reminderMonth()),
        startDay: Number(this.reminderDay()),
        frequency: this.reminderFrequency(),
      })
      .subscribe({
        next: (res) => {
          this.applyReminder(res.data.reminder);
          this.savingReminder.set(false);
          this.notifications.addSuccess('Tagdíj emlékeztető mentve.');
        },
        error: (err) => {
          this.savingReminder.set(false);
          this.notifications.addError(err?.error?.message ?? 'A mentés nem sikerült.');
        },
      });
  }

  sendTestReminder() {
    if (this.sendingTest()) return;
    this.sendingTest.set(true);
    this.settingsService.testMembershipReminder().subscribe({
      next: (res) => {
        this.sendingTest.set(false);
        this.notifications.addSuccess(`Próba e-mail elküldve: ${res.data.sentTo}`);
      },
      error: (err) => {
        this.sendingTest.set(false);
        this.notifications.addError(err?.error?.message ?? 'A próba e-mail nem ment el.');
      },
    });
  }

  // "2027-06-01" -> "június 1."
  roundLabel(date: string): string {
    const [, m, d] = date.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}.`;
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
