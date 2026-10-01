import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { AuthService } from '../../../auth/auth.service';
import { FutokorService, ScanAnswer } from '../../../services/futokor';
import { ScanAnswerView, unlockSound } from '../scan-answer/scan-answer';

// How long after a finish the same card again is still "the same scan"
// rather than a new start (the rules' own window is the course's; this is
// only for whether to ask "shall we start?").
const JUST_FINISHED_MS = 30 * 1000;

// A card was read (its link opened, or its QR code scanned in the app):
// what happens with it, from here to the answer on the screen.
// - The START card with no run on: "Indulhat?" first - one tap, and the
//   clock starts at that tap (it also lets the phone make sound).
// - Anything else: straight to the answer (scan-answer).
// - START with checkpoints missing: the answer asks - go on, or again.
@Component({
  selector: 'app-scan-flow',
  imports: [ScanAnswerView],
  templateUrl: './scan-flow.html',
  styleUrl: './scan-flow.scss',
})
export class ScanFlow implements OnInit {
  private futokor = inject(FutokorService);
  private auth = inject(AuthService);

  // The end of the card's link: "T05.k3J9xQ...".
  token = input.required<string>();
  done = output<void>();

  askStart = signal(false);
  answer = signal<ScanAnswer | null>(null);
  readonly runner = this.auth.user()?.name ?? '';

  ngOnInit() {
    if (this.isFreshStart()) this.askStart.set(true);
    else this.answer.set(this.futokor.scan(this.token()));
  }

  // The START card, with no run to finish or to go on with.
  private isFreshStart(): boolean {
    const course = this.futokor.course();
    const run = this.futokor.run();
    const now = Date.now();
    if (!course || now < Date.parse(course.opensAt) || now > Date.parse(course.closesAt)) {
      return false;
    }
    const tagId = this.token().slice(0, this.token().lastIndexOf('.'));
    const start = course.checkpoints.find((c) => c.kind === 'startFinish');
    if (start?.tagId !== tagId || run?.status === 'running') return false;
    return !(run?.status === 'finished' && now - (run.finishedAt ?? 0) <= JUST_FINISHED_MS);
  }

  start() {
    unlockSound();
    this.askStart.set(false);
    this.answer.set(this.futokor.scan(this.token()));
  }

  restart() {
    unlockSound();
    this.answer.set(null);
    // A new element for the new answer, so it plays from the start.
    setTimeout(() => this.answer.set(this.futokor.scan(this.token(), 'restart')));
  }
}
