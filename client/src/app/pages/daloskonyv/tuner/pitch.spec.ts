import { detectPitch, nearestNote } from './pitch';

const RATE = 44100;

// A plucked-string-like sound: the note and two overtones.
const tone = (frequency: number, size = 4096, volume = 0.4) => {
  const samples = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    const t = (2 * Math.PI * frequency * i) / RATE;
    samples[i] = volume * (Math.sin(t) + 0.5 * Math.sin(2 * t) + 0.25 * Math.sin(3 * t));
  }
  return samples;
};

describe('detectPitch', () => {
  it('hears the guitar’s open strings', () => {
    for (const frequency of [82.41, 110, 146.83, 196, 246.94, 329.63]) {
      const heard = detectPitch(tone(frequency), RATE);
      expect(heard).not.toBeNull();
      expect(Math.abs(heard! - frequency)).toBeLessThan(frequency * 0.005);
    }
  });

  it('hears the ukulele’s', () => {
    for (const frequency of [261.63, 329.63, 392, 440]) {
      expect(Math.abs(detectPitch(tone(frequency), RATE)! - frequency)).toBeLessThan(2);
    }
  });

  it('hears nothing in silence or in noise', () => {
    expect(detectPitch(new Float32Array(4096), RATE)).toBeNull();
    expect(detectPitch(tone(110, 4096, 0.001), RATE)).toBeNull();
    let seed = 1;
    const noise = Float32Array.from({ length: 4096 }, () => {
      seed = (seed * 16807) % 2147483647;
      return (seed / 2147483647 - 0.5) * 0.6;
    });
    expect(detectPitch(noise, RATE)).toBeNull();
  });
});

describe('nearestNote', () => {
  it('names the note, the Hungarian way', () => {
    expect(nearestNote(440)).toEqual({ name: 'A', octave: 4, midi: 69, cents: 0 });
    expect(nearestNote(82.41)).toMatchObject({ name: 'E', octave: 2, midi: 40 });
    expect(nearestNote(246.94)).toMatchObject({ name: 'H', octave: 3, midi: 59 });
    expect(nearestNote(233.08)).toMatchObject({ name: 'B', midi: 58 });
  });

  it('says how far the sound is from it', () => {
    // A little low, a little high.
    expect(nearestNote(436).cents).toBeLessThan(-10);
    expect(nearestNote(444).cents).toBeGreaterThan(10);
    expect(Math.abs(nearestNote(110).cents)).toBeLessThanOrEqual(1);
  });
});
