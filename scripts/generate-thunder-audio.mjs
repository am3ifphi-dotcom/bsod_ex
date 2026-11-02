/**
 * Thunder asset baker.
 *
 * The runtime used to fake thunder by pitch-shifting a generic swoosh, which reads as a
 * "whoosh" rather than a strike. These four assets are authored offline as real, long-form
 * recordings (layered noise bodies, tearing cracks, rolling tails, canyon reflections) and
 * shipped as ordinary decoded audio, so the browser only has to play them back.
 *
 * Run: node scripts/generate-thunder-audio.mjs
 * Output: public/audio/thunder_close.wav, thunder_mid.wav, thunder_far.wav, thunder_roll.wav
 *
 * Pure Node: no dependencies, deterministic (fixed seeds) so re-running yields identical files.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 32000;
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'audio');

/** Mulberry32 — tiny deterministic PRNG. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One-pole lowpass. cutoff in Hz. */
function lowpass(signal, cutoff, sr = SR) {
  const a = Math.exp((-2 * Math.PI * cutoff) / sr);
  let y = 0;
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    y = signal[i] * (1 - a) + y * a;
    out[i] = y;
  }
  return out;
}

/** One-pole highpass (removes DC / mud). */
function highpass(signal, cutoff, sr = SR) {
  const a = Math.exp((-2 * Math.PI * cutoff) / sr);
  let prevIn = 0;
  let prevOut = 0;
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    const y = a * (prevOut + signal[i] - prevIn);
    prevIn = signal[i];
    prevOut = y;
    out[i] = y;
  }
  return out;
}

/** Cheap resonant-ish bandpass: lowpass minus lowpass. */
function bandpass(signal, lowHz, highHz) {
  const lo = lowpass(signal, highHz);
  const hi = lowpass(signal, lowHz);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = lo[i] - hi[i];
  return out;
}

function whiteNoise(n, rng) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** Integrated white noise gives the deep "brown" body thunder actually has. */
function brownNoise(n, rng, leak = 0.996) {
  const out = new Float32Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) {
    v = v * leak + (rng() * 2 - 1) * (1 - leak) * 6.0;
    out[i] = v;
  }
  return out;
}

function addInto(target, src, gain, offsetSamples = 0) {
  const start = Math.max(0, Math.floor(offsetSamples));
  for (let i = 0; i < src.length; i++) {
    const j = start + i;
    if (j >= target.length) break;
    target[j] += src[i] * gain;
  }
}

/** Normalize peak to `peak`, then soft-clip the last few % for a natural limiter feel. */
function normalize(signal, peak = 0.92) {
  let max = 0;
  for (let i = 0; i < signal.length; i++) max = Math.max(max, Math.abs(signal[i]));
  if (max < 1e-6) return signal;
  const g = peak / max;
  for (let i = 0; i < signal.length; i++) {
    const x = signal[i] * g;
    signal[i] = Math.tanh(x * 1.06) * 0.985;
  }
  return signal;
}

/** Click-free edges. */
function declick(signal, fadeInSec = 0.004, fadeOutSec = 0.18) {
  const fi = Math.max(1, Math.floor(fadeInSec * SR));
  const fo = Math.max(1, Math.floor(fadeOutSec * SR));
  for (let i = 0; i < fi && i < signal.length; i++) signal[i] *= i / fi;
  for (let i = 0; i < fo && i < signal.length; i++) {
    signal[signal.length - 1 - i] *= i / fo;
  }
  return signal;
}

/**
 * Core thunder model.
 *  distance 0 = overhead strike (sharp, bright, immediate), 1 = far horizon (dull, rolling, late).
 */
function bakeThunder({ seconds, seed, distance, subGain, reflections, targetRmsValue }) {
  const n = Math.floor(seconds * SR);
  const rng = makeRng(seed);
  const out = new Float32Array(n);

  const brightness = 1 - distance * 0.86; // far strikes lose their highs to the air
  const bodyAttack = 0.008 + distance * 0.55;
  const bodyDecay = 1.4 + distance * 3.4;

  // --- 1. Initial tearing crack (close strikes only).
  if (distance < 0.72) {
    const crackLen = Math.floor((0.16 + distance * 0.3) * SR);
    const raw = whiteNoise(crackLen, rng);
    const crack = bandpass(raw, 380 * brightness + 90, 5200 * brightness + 900);
    for (let i = 0; i < crackLen; i++) {
      const t = i / SR;
      const env = Math.exp(-t * (42 - distance * 26)) * (0.55 + 0.45 * Math.sin(t * 900));
      crack[i] *= env;
    }
    addInto(out, crack, 0.62 * (1 - distance) + 0.14, 0);
  }

  // --- 2. Broad body: several detuned noise "columns" so it never sounds like one noise sweep.
  const bodies = 4;
  for (let b = 0; b < bodies; b++) {
    const raw = brownNoise(n, rng);
    const centre = (140 + b * 190) * (0.55 + brightness * 0.7);
    const body = bandpass(raw, centre, Math.min(6200, centre * (3.2 + brightness * 2.4)));
    const attack = bodyAttack * (0.7 + b * 0.22);
    const decay = bodyDecay * (0.72 + b * 0.16);
    const jitter = 0.6 + rng() * 0.8;
    const aN = Math.max(1, Math.floor(attack * SR));
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      // Attack then a long exponential roll, with slow amplitude undulation (the "rolling" quality).
      const env = (t < attack ? t / attack : Math.exp(-(t - attack) / decay)) * jitter;
      const roll = 0.62 + 0.38 * Math.sin(t * (1.1 + b * 0.37) + b * 2.1) * Math.sin(t * 0.41 + b);
      body[i] *= env * (0.55 + 0.45 * roll);
    }
    // Fade the very start of the first column so it meets the crack smoothly.
    if (b === 0) for (let i = 0; i < aN && i < n; i++) body[i] *= i / aN;
    addInto(out, body, 0.52 / (b + 1), Math.floor((b * 0.035 + rng() * 0.05) * SR));
  }

  // --- 3. Sub rumble: the part you feel. Always present, longer for distant rolls.
  {
    const raw = brownNoise(n, rng, 0.9985);
    const sub = lowpass(raw, 70 + (1 - distance) * 90);
    const dur = seconds * (0.72 + distance * 0.25);
    // Overhead strikes slam in almost instantly; distant rolls swell in.
    const subAttack = 0.02 + distance * 0.34;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = Math.min(1, t / subAttack) * Math.exp(-t / dur * 1.9);
      const swell = 0.7 + 0.3 * Math.sin(t * 0.7 + 1.2);
      sub[i] *= env * swell;
    }
    addInto(out, sub, subGain, 0);
  }

  // --- 4. (removed) electrical tick rain.
  // Sparse high-frequency ticks sounded like frying bacon and made the tail read as an electrical
  // fault rather than thunder. A strike should be a body plus a roll: nothing sparkles.

  // --- 5. Canyon / terrain reflections: discrete delayed, darkened copies of the body.
  if (reflections > 0) {
    const taps = [0.07, 0.14, 0.23, 0.38, 0.62];
    for (let i = 0; i < taps.length; i++) {
      const delay = taps[i] * (0.8 + distance * 1.6);
      const raw = brownNoise(n, rng);
      const echo = lowpass(raw, 520 / (1 + i * 0.55));
      for (let j = 0; j < n; j++) {
        const t = j / SR;
        echo[j] *= Math.exp(-t / (1.1 + distance * 2.6)) * Math.min(1, t / 0.05);
      }
      addInto(out, echo, (reflections * 0.30) / (i + 1.7), Math.floor(delay * SR));
    }
  }

  // --- 5b. Tail shaping: the back half loses everything above ~700 Hz, so the roll closes on a
  // deep, smooth rumble instead of grit.
  {
    const tailStart = Math.floor(n * 0.30);
    const rumble = lowpass(out, 620);
    for (let i = tailStart; i < n; i++) {
      const k = Math.min(1, (i - tailStart) / Math.max(1, n - tailStart) * 1.6);
      out[i] = out[i] * (1 - k) + rumble[i] * k;
    }
  }

  // --- 6. Distant air absorption: the whole tail loses top end with distance.
  let shaped = out;
  if (distance > 0.25) {
    shaped = lowpass(out, 9000 * (1 - distance) + 380);
    // Blend so close attacks keep their bite.
    const mix = Math.min(1, (distance - 0.25) * 1.6);
    for (let i = 0; i < n; i++) shaped[i] = out[i] * (1 - mix) + shaped[i] * mix;
  }
  shaped = highpass(shaped, 22);
  normalize(shaped, 0.90);
  // Loudness target: peak normalization alone makes a crack-dominated strike far too quiet,
  // so lift the whole asset until its opening second sits at a cinematic RMS.
  const probe = Math.min(shaped.length, Math.floor(1.6 * SR));
  let sum = 0;
  for (let i = 0; i < probe; i++) sum += shaped[i] * shaped[i];
  const rms = Math.sqrt(sum / Math.max(1, probe));
  const targetRms = targetRmsValue;
  if (rms > 1e-5) {
    const lift = targetRms / rms;
    for (let i = 0; i < n; i++) shaped[i] = Math.tanh(shaped[i] * lift * 1.05) * 0.96;
  }
  declick(shaped, 0.004, Math.min(0.25, seconds * 0.12));
  return shaped;
}

function encodeWav16(samples, sr = SR) {
  const n = samples.length;
  const buffer = Buffer.alloc(44 + n * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + n * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sr, 24);
  buffer.writeUInt32LE(sr * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buffer;
}

const PRESETS = [
  {
    file: 'thunder_close.wav',
    targetRmsValue: 0.155,
    seconds: 4.2,
    seed: 0x5eed01,
    distance: 0.08,
    subGain: 0.42,
    reflections: 0.55,
  },
  {
    file: 'thunder_mid.wav',
    targetRmsValue: 0.17,
    seconds: 5.6,
    seed: 0x5eed02,
    distance: 0.46,
    subGain: 0.58,
    reflections: 0.75,
  },
  {
    file: 'thunder_far.wav',
    targetRmsValue: 0.175,
    seconds: 6.8,
    seed: 0x5eed03,
    distance: 0.86,
    subGain: 0.72,
    reflections: 0.9,
  },
  {
    // Glitch-world sky fracture: enormous, slow, almost geological.
    file: 'thunder_roll.wav',
    targetRmsValue: 0.18,
    seconds: 7.6,
    seed: 0x5eed04,
    distance: 0.62,
    subGain: 0.95,
    reflections: 1.15,
  },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const preset of PRESETS) {
  const samples = bakeThunder(preset);
  const wav = encodeWav16(samples);
  const path = resolve(OUT_DIR, preset.file);
  writeFileSync(path, wav);
  console.log(
    `${preset.file.padEnd(18)} ${preset.seconds.toFixed(1)}s  ${(wav.length / 1024).toFixed(0)} KB`
  );
}
console.log('done.');
