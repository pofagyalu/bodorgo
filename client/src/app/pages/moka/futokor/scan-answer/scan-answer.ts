import { Component, OnDestroy, OnInit, computed, inject, input, output } from '@angular/core';
import { FutokorService, ScanAnswer, racePace, raceTime } from '../../../../services/futokor';
import { playCelebration } from '../../../../shared/celebration-effects';

// "T02" → "02-es kártya" (the number printed big on the card) - a user's
// own track's "P3-02" too; "S1" and "P3-S" are START/FINISH cards.
export function cardName(tagId: string | undefined): string {
  if (!tagId) return '';
  const own = tagId.split('-').at(-1)!;
  return own.startsWith('S') ? 'RAJT / CÉL kártya' : `${own.replace(/^\D+/, '')}-es kártya`;
}

type Mood = 'good' | 'bad' | 'neutral' | 'ask' | 'finish';

// How long each kind of answer stays before it closes by itself (a tap
// closes any of them; the finish and the question stay until tapped).
const STAY_MS: Partial<Record<Mood, number>> = { good: 2500, neutral: 2000, bad: 4500 };

// One sound engine for the page: a phone only lets a page make sound after
// a tap, so the START button's tap wakes it up (unlockSound).
let audio: AudioContext | null = null;
export function unlockSound() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    // No sound, then.
  }
}

function beep(frequency: number, startSec: number, lengthSec: number) {
  if (!audio || audio.state !== 'running') return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = frequency;
  gain.gain.value = 0.25;
  osc.connect(gain).connect(audio.destination);
  osc.start(audio.currentTime + startSec);
  osc.stop(audio.currentTime + startSec + lengthSec);
}

// What a scan came to, over the whole screen, to be understood at a glance
// while running: green with a big ✓ (and a high beep), red with the one
// reason (a low double beep), grey for "already have it" - and the finish,
// with the time and the splits.
@Component({
  selector: 'app-scan-answer',
  templateUrl: './scan-answer.html',
  styleUrl: './scan-answer.scss',
})
export class ScanAnswerView implements OnInit, OnDestroy {
  private futokor = inject(FutokorService);

  answer = input.required<ScanAnswer>();
  closed = output<void>();
  // START with checkpoints missing: the runner starts again.
  restart = output<void>();

  readonly time = raceTime;
  readonly pace = racePace;
  private timer?: ReturnType<typeof setTimeout>;

  mood = computed<Mood>(() => {
    switch (this.answer().result) {
      case 'started':
      case 'passed':
        return 'good';
      case 'finished':
        return 'finish';
      case 'duplicate':
      case 'gaveUp':
        return 'neutral';
      case 'incomplete':
        return 'ask';
      default:
        return 'bad';
    }
  });

  title = computed(() => {
    const a = this.answer();
    switch (a.result) {
      case 'started':
        return 'RAJT!';
      case 'passed':
        return a.checkpoint?.label ?? 'Megvan';
      case 'finished':
        return 'CÉL!';
      case 'duplicate':
        return 'Már megvan';
      case 'gaveUp':
        return 'Feladtad';
      case 'incomplete':
        return 'Még nem a cél';
      case 'rejectedOrder':
        return 'Előbb egy másik';
      case 'rejectedSpeed':
        return 'Túl gyors';
      case 'noRun':
        return 'Nincs futásod';
      case 'unknownTag':
        return 'Nem ide tartozik';
      case 'closed':
        return 'Zárva';
      default:
        return 'Nincs pálya';
    }
  });

  // The one line under it.
  detail = computed(() => {
    const a = this.answer();
    const missing = a.missing ? `${a.missing.label} (${cardName(a.missing.tagId)})` : '';
    switch (a.result) {
      case 'passed':
        return a.split
          ? [raceTime(a.split.ms), a.split.paceSecPerKm ? racePace(a.split.paceSecPerKm) : '']
              .filter(Boolean)
              .join(' · ')
          : '';
      case 'incomplete':
        return `Még hiányzik: ${missing}`;
      case 'rejectedOrder':
        return `Előbb: ${missing}`;
      case 'rejectedSpeed':
        return 'Ilyen gyorsan senki sem fut – ez a leolvasás nem számít.';
      case 'noRun':
        return 'Előbb a RAJT / CÉL kártyát olvasd be.';
      case 'unknownTag':
        return 'Ez a kártya nem része a mai pályának.';
      case 'closed':
        return 'A pálya most nincs nyitva.';
      case 'noCourse':
        return 'Nincs pálya a telefonon – nyisd meg a Móka → Futókörök → Futás oldalt, amíg van net.';
      case 'gaveUp':
        return 'Ez a futás nem számít. Jöhet egy új!';
      default:
        return '';
    }
  });

  // After a start or a checkpoint: where to next.
  nextUp = computed(() => {
    const result = this.answer().result;
    if (result !== 'started' && result !== 'passed') return '';
    const next = this.futokor.next();
    return next ? `Következő: ${next.label} · ${cardName(next.tagId)}` : 'Irány a CÉL!';
  });

  // The finished run's splits, each named by where it leads.
  splits = computed(() => {
    const course = this.futokor.course();
    const run = this.answer().run;
    if (this.answer().result !== 'finished' || !run || !course) return [];
    const label = (id: string) => course.checkpoints.find((c) => c.id === id)?.label ?? id;
    return run.splits.map((s, i) => ({
      to: i === run.splits.length - 1 ? 'CÉL' : label(s.toCheckpointId),
      time: raceTime(s.ms),
      pace: s.paceSecPerKm ? racePace(s.paceSecPerKm) : '',
    }));
  });

  ngOnInit() {
    const mood = this.mood();
    if (mood === 'good' || mood === 'finish') {
      navigator.vibrate?.(mood === 'finish' ? [120, 80, 120, 80, 300] : 150);
      beep(880, 0, 0.15);
      if (mood === 'finish') {
        beep(1175, 0.18, 0.3);
        void playCelebration('confetti', 4000);
      }
    } else if (mood === 'bad' || mood === 'ask') {
      navigator.vibrate?.([200, 100, 200]);
      beep(220, 0, 0.2);
      beep(220, 0.3, 0.2);
    }
    const stay = STAY_MS[mood];
    if (stay) this.timer = setTimeout(() => this.closed.emit(), stay);
  }

  // A tap anywhere closes it - except the question, which wants an answer.
  tap() {
    if (this.mood() !== 'ask') this.closed.emit();
  }

  ngOnDestroy() {
    clearTimeout(this.timer);
  }
}
