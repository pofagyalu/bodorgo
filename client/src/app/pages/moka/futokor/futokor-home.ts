import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Avatar } from '../../../components/avatar/avatar';
import { AuthService } from '../../../auth/auth.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { Podium, PodiumWinner } from '../../../shared/podium/podium';
import {
  FutokorRunner,
  FutokorService,
  ScanAnswer,
  racePace,
  raceTime,
} from '../../../services/futokor';
import { QrScanner, canScanInApp } from './qr-scanner/qr-scanner';
import { ScanAnswerView, cardName } from './scan-answer/scan-answer';
import { ScanFlow } from './scan-flow/scan-flow';

const STATUS_TEXT: Record<string, string> = {
  running: 'fut',
  finished: 'célba ért',
  gave_up: 'feladta',
  abandoned: 'újrakezdte',
  expired: 'lejárt',
};

// Móka → Futókörök: the running race's own page on a runner's phone.
// The course (kept on the phone - it works without a signal too), the run
// that's on with its clock and the card to find next, the camera to read
// the cards, my runs, and everyone's best times.
@Component({
  selector: 'app-futokor-home',
  imports: [
    RouterLink,
    DatePipe,
    MatIconModule,
    Avatar,
    Podium,
    QrScanner,
    ScanFlow,
    ScanAnswerView,
  ],
  templateUrl: './futokor-home.html',
  styleUrl: './futokor-home.scss',
})
export class FutokorHome implements OnDestroy {
  futokor = inject(FutokorService);
  private auth = inject(AuthService);
  private confirm = inject(ConfirmService);

  readonly isAdmin = this.auth.user()?.role === 'admin';
  readonly myId = this.auth.user()?.id;
  readonly canScan = canScanInApp();
  readonly time = raceTime;
  readonly pace = racePace;
  readonly cardName = cardName;

  loaded = signal(false);
  runners = signal<FutokorRunner[]>([]);
  scanning = signal(false);
  // A card the in-app camera has just read.
  scanned = signal<string | null>(null);
  // Giving up has its answer too.
  answer = signal<ScanAnswer | null>(null);

  // The clock of the run that's on: ticks every second.
  private now = signal(Date.now());
  private ticker = setInterval(() => {
    this.now.set(Date.now());
    this.futokor.expireIfDue();
  }, 1000);

  course = this.futokor.course;
  running = computed(() => this.futokor.run()?.status === 'running');
  elapsed = computed(() => raceTime(this.now() - (this.futokor.run()?.startedAt ?? this.now())));

  // Open now, not yet, or over.
  state = computed(() => {
    const c = this.course();
    if (!c) return null;
    const now = this.now();
    if (now < Date.parse(c.opensAt)) return 'soon';
    return now > Date.parse(c.closesAt) ? 'over' : 'open';
  });
  stops = computed(() => (this.course()?.checkpoints.length ?? 1) - 1);

  // My runs, the latest first.
  myRuns = computed(() =>
    [...this.futokor.serverRuns()]
      .reverse()
      .map((r) => ({ ...r, statusText: STATUS_TEXT[r.status] ?? r.status })),
  );

  winners = computed<PodiumWinner[]>(() =>
    this.runners()
      .slice(0, 3)
      .map((r, i) => ({
        place: (i + 1) as 1 | 2 | 3,
        userId: r.userId,
        name: r.name,
        photoVersion: r.photoUpdatedAt,
      })),
  );

  constructor() {
    void this.refresh();
  }

  async refresh() {
    await this.futokor.refresh();
    this.loaded.set(true);
    this.loadLeaderboard();
  }

  private loadLeaderboard() {
    const course = this.course();
    if (!course) return;
    this.futokor
      .getLeaderboard(course._id)
      .subscribe({ next: (runners) => this.runners.set(runners), error: () => {} });
  }

  // The camera has read a card.
  onCard(token: string) {
    if (!this.scanned()) this.scanned.set(token);
  }

  // The answer is off the screen: on with the run (the camera stays on
  // while there's a run to scan for).
  onScanDone() {
    this.scanned.set(null);
    if (!this.running()) {
      this.scanning.set(false);
      // A finish may have changed the list (once it's uploaded).
      void this.futokor.sync().then(() => this.loadLeaderboard());
    }
  }

  async giveUp() {
    const ok = await this.confirm.ask({
      title: 'Feladod?',
      message: 'Ez a futás nem fog számítani. Utána bármikor indulhatsz újra.',
      confirmText: 'Feladom',
    });
    if (ok) this.answer.set(this.futokor.giveUp());
  }

  ngOnDestroy() {
    clearInterval(this.ticker);
  }
}
