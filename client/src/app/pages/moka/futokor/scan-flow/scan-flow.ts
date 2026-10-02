import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FutokorService, ScanAnswer, tagOfToken } from '../../../../services/futokor';
import { ScanAnswerView, unlockSound } from '../scan-answer/scan-answer';

// How long after a finish the same card again is still "the same scan"
// rather than a new start (the rules' own window is the course's; this is
// only for whether to ask "shall we start?").
const JUST_FINISHED_MS = 30 * 1000;

// A card was read (its link opened, or its QR code scanned in the app):
// what happens with it, from here to the answer on the screen.
// - The START card with no run on: who runs, first. Whoever is logged in
//   on the phone is asked "Indulhat?" - one tap, and the clock starts at
//   that tap (it also lets the phone make sound). On a phone nobody is
//   logged in on (or a lent one: "Nem te vagy?") the runner types their
//   futókód once; the cards after that need nothing but the scan.
// - Anything else: straight to the answer (scan-answer).
// - START with checkpoints missing: the answer asks - go on, or again.
@Component({
  selector: 'app-scan-flow',
  imports: [ScanAnswerView],
  templateUrl: './scan-flow.html',
  styleUrl: './scan-flow.scss',
})
export class ScanFlow implements OnInit {
  futokor = inject(FutokorService);

  // The end of the card's link: "T05.k3J9xQ...".
  token = input.required<string>();
  done = output<void>();

  // 'who': asking for a futókód; 'go': "Indulhat?"; null: the answer.
  step = signal<'who' | 'go' | null>(null);
  answer = signal<ScanAnswer | null>(null);

  code = signal('');
  checking = signal(false);
  codeError = signal('');

  ngOnInit() {
    // With no run on, the card says which course this is about.
    this.futokor.prepare(this.token());
    if (!this.isFreshStart()) this.answer.set(this.futokor.scan(this.token()));
    else this.step.set(this.futokor.runner() ? 'go' : 'who');
  }

  // The START card, with no run to finish or to go on with.
  private isFreshStart(): boolean {
    const course = this.futokor.course();
    const run = this.futokor.run();
    const now = Date.now();
    if (!course || now < Date.parse(course.opensAt) || now > Date.parse(course.closesAt)) {
      return false;
    }
    const tagId = tagOfToken(this.token());
    const start = course.checkpoints.find((c) => c.kind === 'startFinish');
    if (start?.tagId !== tagId || run?.status === 'running') return false;
    return !(run?.status === 'finished' && now - (run.finishedAt ?? 0) <= JUST_FINISHED_MS);
  }

  onCode(value: string) {
    this.code.set(value.replace(/\D/g, '').slice(0, 4));
    this.codeError.set('');
  }

  // The futókód is asked about (when there's a connection): whose it is.
  async useCode() {
    if (this.code().length !== 4 || this.checking()) return;
    this.checking.set(true);
    const name = await this.futokor.runWithCode(this.code());
    this.checking.set(false);
    if (name === 'unknown') {
      this.codeError.set('Nincs ilyen futókód – nézd meg újra, vagy kérdezz meg egy admint.');
      return;
    }
    this.code.set('');
    this.step.set('go');
  }

  // Back to whoever is logged in on this phone.
  asMyself() {
    this.futokor.runAsMyself();
    this.step.set('go');
  }

  start() {
    unlockSound();
    this.step.set(null);
    this.answer.set(this.futokor.scan(this.token()));
  }

  restart() {
    unlockSound();
    this.answer.set(null);
    // A new element for the new answer, so it plays from the start.
    setTimeout(() => this.answer.set(this.futokor.scan(this.token(), 'restart')));
  }
}
