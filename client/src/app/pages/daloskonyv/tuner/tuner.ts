import { Component, OnDestroy, computed, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Instrument } from '../chord-shapes';
import { HeardNote, STRINGS, detectPitch, nearestNote } from './pitch';

// Within this many hundredths of a semitone the string is in tune.
const IN_TUNE = 5;
// The last few pitches heard - their middle one is shown, so one stray
// reading doesn't make the needle jump.
const SMOOTH = 5;
// A note stays on the screen this long after the string went quiet.
const LINGER_MS = 1500;

// The tuner: listens through the microphone and tells which note it hears
// and how far it is from true - with the instrument's open strings to aim
// for. The sound never leaves the phone: it is only measured (pitch.ts).
@Component({
  selector: 'app-tuner',
  imports: [MatIconModule],
  templateUrl: './tuner.html',
  styleUrl: './tuner.scss',
})
export class Tuner implements OnDestroy {
  // Whose strings to aim for.
  instrument = input<Instrument>('guitar');

  listening = signal(false);
  // Why it can't listen (no microphone, not allowed) - shown as is.
  error = signal<string | null>(null);
  // The note heard now, or the last one for a moment after.
  note = signal<HeardNote | null>(null);
  // The sound has gone: the note shown is the last one heard.
  faded = signal(false);

  strings = computed(() => STRINGS[this.instrument()]);

  // Which string that note is nearest to - the one being tuned.
  activeString = computed(() => {
    const note = this.note();
    if (!note) return -1;
    let nearest = 0;
    this.strings().forEach((s, i) => {
      if (Math.abs(s.midi - note.midi) < Math.abs(this.strings()[nearest].midi - note.midi)) {
        nearest = i;
      }
    });
    // A note far from every string (more than two semitones) isn't one.
    return Math.abs(this.strings()[nearest].midi - note.midi) <= 2 ? nearest : -1;
  });

  // How far from the string being tuned, in hundredths of a semitone - a
  // whole semitone off counts too (the nearest note's own cents wouldn't
  // tell a string one note flat from one in tune).
  offset = computed(() => {
    const note = this.note();
    if (!note) return 0;
    const target = this.strings()[this.activeString()];
    return target ? (note.midi - target.midi) * 100 + note.cents : note.cents;
  });

  inTune = computed(() => !!this.note() && Math.abs(this.offset()) <= IN_TUNE);

  // The needle: 0 % at the left end (50 cents flat or more), 100 % at the
  // right (as sharp).
  needle = computed(() => 50 + Math.max(-50, Math.min(50, this.offset())));

  advice = computed(() => {
    if (!this.note()) return 'Pengess meg egy húrt…';
    if (this.inTune()) return 'Tiszta!';
    return this.offset() < 0 ? 'Mély – húzd feljebb' : 'Magas – engedd lejjebb';
  });

  private stream: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer: Float32Array<ArrayBuffer> | null = null;
  private frame = 0;
  private recent: number[] = [];
  private lastHeard = 0;

  async start() {
    this.error.set(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      this.error.set('Ez a böngésző nem enged hozzáférni a mikrofonhoz.');
      return;
    }
    try {
      // The phone's own "improvements" off: they would bend a held note.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      this.error.set(
        'A hangoló nem éri el a mikrofont. Engedélyezd a böngészőben, majd próbáld újra.',
      );
      return;
    }
    this.audio = new AudioContext();
    this.analyser = this.audio.createAnalyser();
    this.analyser.fftSize = 4096;
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.audio.createMediaStreamSource(this.stream).connect(this.analyser);
    this.recent = [];
    this.listening.set(true);
    this.frame = requestAnimationFrame(this.listen);
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.audio?.close().catch(() => {});
    this.stream = null;
    this.audio = null;
    this.analyser = null;
    this.listening.set(false);
    this.note.set(null);
  }

  ngOnDestroy() {
    this.stop();
  }

  private listen = (now: number) => {
    if (!this.analyser || !this.buffer || !this.audio) return;
    this.analyser.getFloatTimeDomainData(this.buffer);
    const pitch = detectPitch(this.buffer, this.audio.sampleRate);
    if (pitch) {
      this.recent.push(pitch);
      if (this.recent.length > SMOOTH) this.recent.shift();
      const sorted = [...this.recent].sort((a, b) => a - b);
      this.note.set(nearestNote(sorted[Math.floor(sorted.length / 2)]));
      this.faded.set(false);
      this.lastHeard = now;
    } else if (this.note()) {
      this.recent = [];
      this.faded.set(true);
      if (now - this.lastHeard > LINGER_MS) this.note.set(null);
    }
    this.frame = requestAnimationFrame(this.listen);
  };
}
