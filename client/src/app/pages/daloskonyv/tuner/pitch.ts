// Hearing a note: the pitch of a sound from the microphone, and which
// note - and how far from it - that pitch is. For the tuner (tuner.ts).

// The pitch (Hz) of a short piece of sound, or null when there is no clear
// note in it (silence, noise, a chord). By autocorrelation: the sound is
// compared with itself moved along - where it matches best is one period.
export function detectPitch(samples: Float32Array, sampleRate: number): number | null {
  const size = samples.length;
  // Too quiet to be a plucked string.
  let energy = 0;
  for (let i = 0; i < size; i += 1) energy += samples[i] * samples[i];
  if (Math.sqrt(energy / size) < 0.008) return null;

  // Between 60 Hz (below a guitar's low E, 82 Hz) and 1200 Hz (above a
  // ukulele's highest notes).
  const minLag = Math.floor(sampleRate / 1200);
  const maxLag = Math.min(Math.floor(sampleRate / 60), Math.floor(size / 2));

  // How alike the sound is to itself moved by each lag: 1 the same, 0 not.
  const likeness = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let match = 0;
    let power = 0;
    for (let i = 0; i < size - lag; i += 1) {
      match += samples[i] * samples[i + lag];
      power += samples[i] * samples[i] + samples[i + lag] * samples[i + lag];
    }
    likeness[lag] = power ? (2 * match) / power : 0;
  }

  // The first clear peak - not the highest of all, which may be a whole
  // multiple of the period (an octave too low).
  let best = -1;
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    const isPeak = likeness[lag] > likeness[lag - 1] && likeness[lag] >= likeness[lag + 1];
    if (isPeak && likeness[lag] > 0.9) {
      best = lag;
      break;
    }
  }
  if (best < 0) return null;

  // Between the samples: the top of the curve through the peak's neighbours.
  const [a, b, c] = [likeness[best - 1], likeness[best], likeness[best + 1]];
  const shift = a - 2 * b + c ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  return sampleRate / (best + shift);
}

// The twelve notes, the Hungarian way (H, and B for B♭).
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];

export interface HeardNote {
  // "E", "A", "H"…
  name: string;
  // Which octave (A4 = 440 Hz).
  octave: number;
  // Its number among all notes (A4 = 69) - to tell one string from another.
  midi: number;
  // How far the sound is from that note: -50…+50 hundredths of a semitone
  // (minus: flat, too low).
  cents: number;
}

export function nearestNote(frequency: number): HeardNote {
  const exact = 69 + 12 * Math.log2(frequency / 440);
  const midi = Math.round(exact);
  return {
    name: NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    midi,
    cents: Math.round((exact - midi) * 100),
  };
}

// The open strings, from the lowest-sounding side of the neck: their
// names and their notes' numbers.
export const STRINGS = {
  guitar: [
    { name: 'E', midi: 40 },
    { name: 'A', midi: 45 },
    { name: 'D', midi: 50 },
    { name: 'G', midi: 55 },
    { name: 'H', midi: 59 },
    { name: 'E', midi: 64 },
  ],
  ukulele: [
    { name: 'G', midi: 67 },
    { name: 'C', midi: 60 },
    { name: 'E', midi: 64 },
    { name: 'A', midi: 69 },
  ],
} as const;
