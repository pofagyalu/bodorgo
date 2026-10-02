import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { FutokorService, ScanAnswer, raceTime } from '../../../services/futokor';
import { CourseMap } from './course-map/course-map';
import { QrScanner, canScanInApp } from './qr-scanner/qr-scanner';
import { ScanAnswerView, cardName } from './scan-answer/scan-answer';
import { ScanFlow } from './scan-flow/scan-flow';

// Móka → Futókörök → Futás: the running race's own page on a runner's phone.
// The course (kept on the phone - it works without a signal too), the run
// that's on with its clock and the card to find next, and the camera to
// read the cards. Nothing else: my own runs are on Futókörök's opening page
// (futokor-landing), everyone's times under Eredmények - a link leads to
// this course's.
@Component({
  selector: 'app-futokor-home',
  imports: [RouterLink, DatePipe, MatIconModule, CourseMap, QrScanner, ScanFlow, ScanAnswerView],
  templateUrl: './futokor-home.html',
  styleUrl: './futokor-home.scss',
})
export class FutokorHome implements OnDestroy {
  futokor = inject(FutokorService);
  private confirm = inject(ConfirmService);

  readonly canScan = canScanInApp();
  readonly cardName = cardName;

  loaded = signal(false);
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
  // There's something to draw: the loop, or at least where the cards are.
  hasMap = computed(() => {
    const c = this.course();
    return !!c && ((c.track?.length ?? 0) > 1 || c.checkpoints.some((p) => p.lat != null));
  });

  constructor() {
    void this.refresh();
  }

  async refresh() {
    await this.futokor.refresh();
    this.loaded.set(true);
  }

  // Another of the open courses onto the screen.
  pick(courseId: string) {
    this.futokor.select(courseId);
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
      void this.futokor.sync();
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
