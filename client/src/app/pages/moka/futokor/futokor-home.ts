import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { FutokorService, ScanAnswer, raceTime } from '../../../services/futokor';
import { CourseMap, MapRunner } from './course-map/course-map';
import { QrScanner, canScanInApp } from './qr-scanner/qr-scanner';
import { ScanAnswerView, cardName } from './scan-answer/scan-answer';
import { ScanFlow } from './scan-flow/scan-flow';
import { NfcCards } from './nfc/nfc-cards';

// Móka → Futókörök → Futás: the running race's own page on a runner's phone.
// The course (kept on the phone - it works without a signal too), the run
// that's on with its clock and the card to find next, and the camera to
// read the cards - or, on a phone that can, a touch on a card's NFC sticker
// (the page listens while it's open; QR or NFC, card by card, as the runner
// likes). Nothing else: my own runs are on Futókörök's opening page
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
  // The cards' NFC stickers: the app listens for them (nfc/nfc-cards.ts),
  // and while this page is open they come here.
  nfc = inject(NfcCards);

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

  // Élő követés, in a line: what the others see of me.
  liveText = computed(() => {
    if (!this.futokor.live()) return 'Élő követés kikapcsolva – koppints, ha látszanál a térképen';
    if (this.futokor.liveProblem()) return 'Élő követés: nincs engedély a helymeghatározáshoz';
    return this.futokor.myPosition()
      ? 'Élő követés: a többiek látnak a térképen'
      : 'Élő követés: keresem, hol vagy…';
  });
  // Me on the map, while I'm followed.
  me = computed<MapRunner[]>(() => {
    const at = this.futokor.myPosition();
    return at ? [{ name: 'Te', lat: at.lat, lng: at.lng, me: true }] : [];
  });

  constructor() {
    void this.refresh();
    this.nfc.onCard = (token) => this.onCard(token);
  }

  async refresh() {
    await this.futokor.refresh();
    this.loaded.set(true);
  }

  // Another of the open courses onto the screen.
  pick(courseId: string) {
    this.futokor.select(courseId);
  }

  // The camera has read a card - or the phone was touched to one.
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
    this.nfc.onCard = null;
    clearInterval(this.ticker);
  }
}
