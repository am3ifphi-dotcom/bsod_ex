#!/usr/bin/env python3
"""
Import real field-recorded thunder into public/audio.

The game used to ship procedurally baked thunder (scripts/generate-thunder-audio.mjs).
Those bakes always sounded synthetic: a filtered noise burst with a fake tail. This
script instead takes genuine recordings, trims the dead air, tames the sizzle band and
normalises them, so what the browser plays is a real thunderclap with real physics.

Sources
-------
1. ImmersiveThunder by netcatgirl — https://github.com/netcatgirl/ImmersiveThunder
   The mod ships ten field recordings (close / medium / far). Code and resources are
   MIT licensed: https://github.com/netcatgirl/ImmersiveThunder/blob/1.21.6/LICENSE
   Download: https://codeload.github.com/netcatgirl/ImmersiveThunder/tar.gz/refs/heads/1.21.6
   Clips live in common/src/main/resources/assets/immersivethunder/sounds/*.ogg

2. Stargate Sample Pack — https://github.com/stargatedaw/stargate-sample-pack
   CC0 1.0 Universal, explicitly royalty-free / attribution-free.
   stargate-sample-pack/fugue-state-audio/found-sounds/thunder.wav (16.5 s deep roll)

Usage
-----
    pip install soundfile numpy
    python3 scripts/import-thunder-audio.py \
        --immersive /path/to/ImmersiveThunder/common/src/main/resources/assets/immersivethunder/sounds \
        --stargate /path/to/stargate-sample-pack/fugue-state-audio/found-sounds/thunder.wav \
        --out public/audio

Every output is mono 16-bit WAV at the source sample rate (44.1 or 48 kHz). WebAudio
resamples on decode, and avoiding an offline resample here keeps the transients intact.
"""

from __future__ import annotations

import argparse
import os
import wave

import numpy as np
import soundfile as sf

# id -> (source file key, max seconds, low-pass Hz)
# The low-pass is deliberately gentler than what mains hum or Vorbis sizzle needs: it only
# removes the >10 kHz band, which is where "バチバチ" electrical crackle lives. The body and
# the long rolling tail stay untouched — the playback chain adds distance filtering on top.
SPEC = [
    ('thunder_close_1', ('immersive', 'thunder_close_1.ogg'), 16.0, 11000),
    ('thunder_close_2', ('immersive', 'thunder_close_2.ogg'), 13.0, 11000),
    ('thunder_close_3', ('immersive', 'thunder_close_3.ogg'), 14.5, 10500),
    ('thunder_mid_1', ('immersive', 'thunder_medium_1.ogg'), 8.5, 8000),
    ('thunder_mid_2', ('immersive', 'thunder_medium_2.ogg'), 13.0, 7500),
    ('thunder_far_1', ('immersive', 'thunder_far_1.ogg'), 14.0, 5200),
    ('thunder_far_2', ('immersive', 'thunder_far_3.ogg'), 9.5, 4800),
    ('thunder_roll', ('stargate', 'thunder.wav'), 15.0, 6500),
]

ONSET_DB = -46.0     # first sample louder than this counts as the start of the strike
TAIL_DB = -50.0      # everything quieter than this after the last peak is trimmed
PRE_ROLL = 0.035     # keep a sliver of air before the attack
TAIL_PAD = 0.55      # keep the natural decay running into silence
FADE_IN = 0.006
FADE_OUT_FRAC = 0.12  # fade applied to the final 12 % of the kept region
PEAK = 0.89
ATTACK_FRAC = 0.38   # strike starts where the smoothed envelope first reaches 38 % of its peak
ATTACK_PRE = 0.22    # ...minus this much air, so the crack is not chopped off
SUBSONIC_HZ = 26.0   # rumble below this is inaudible and only eats headroom


def load_mono(path: str) -> tuple[np.ndarray, int]:
    data, sr = sf.read(path, always_2d=True)
    return data.mean(axis=1).astype(np.float64), sr


def band_limit(x: np.ndarray, sr: int, cutoff: float) -> np.ndarray:
    """Windowed-sinc low-pass. Linear phase, no resonance, no ringing tail to speak of."""
    if cutoff >= sr * 0.45:
        return x
    n = 257
    t = np.arange(n) - (n - 1) / 2.0
    fc = cutoff / sr
    h = 2.0 * fc * np.sinc(2.0 * fc * t) * np.hamming(n)
    h /= h.sum()
    # Pad so the convolution keeps the true length and the strike stays at its original time.
    pad = n // 2
    y = np.convolve(np.pad(x, pad, mode='edge'), h, mode='valid')
    return y[: len(x)]


def subsonic(x: np.ndarray, sr: int, freq: float) -> np.ndarray:
    """Two-pole high-pass so the recording carries no DC or inaudible rumble."""
    w0 = 2.0 * np.pi * freq / sr
    alpha = np.sin(w0) / (2.0 * 0.707)
    cosw = np.cos(w0)
    b = [(1 + cosw) / 2, -(1 + cosw), (1 + cosw) / 2]
    a = [1 + alpha, -2 * cosw, 1 - alpha]
    b = [v / a[0] for v in b]
    a = [1.0, a[1] / a[0], a[2] / a[0]]
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        out = b[0] * v + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
        x2, x1 = x1, v
        y2, y1 = y1, out
        y[i] = out
    return y


def align_attack(x: np.ndarray, sr: int) -> np.ndarray:
    """
    Field recordings often open with seconds of room tone before the strike. Cut to the
    attack so the clap lands on the same frame as the lightning flash, with a hair of air
    in front of it so the transient is never clipped by the browser's start.
    """
    win = max(1, int(0.05 * sr))
    env = np.sqrt(np.convolve(x * x, np.ones(win) / win, mode='same') + 1e-20)
    peak = env.max() or 1.0
    hot = np.nonzero(env > peak * ATTACK_FRAC)[0]
    if not len(hot):
        return x
    start = int(hot[0] - ATTACK_PRE * sr)
    if start <= 0.3 * sr:  # nothing worth cutting
        return x
    return x[start:]


def trim(x: np.ndarray, sr: int, max_sec: float) -> np.ndarray:
    peak = float(np.abs(x).max()) or 1.0
    thr_start = peak * (10 ** (ONSET_DB / 20.0))
    thr_end = peak * (10 ** (TAIL_DB / 20.0))

    above = np.nonzero(np.abs(x) > thr_start)[0]
    start = max(0, int(above[0] - PRE_ROLL * sr)) if len(above) else 0
    # Walk back from the end to the last audible sample, ignoring the noise floor.
    floor_idx = np.nonzero(np.abs(x) > thr_end)[0]
    end = int(min(len(x), (floor_idx[-1] if len(floor_idx) else len(x) - 1) + TAIL_PAD * sr))
    y = x[start:end]

    cap = int(max_sec * sr)
    if len(y) > cap:
        y = y[:cap]
    return y


def shape(x: np.ndarray, sr: int) -> np.ndarray:
    y = x.copy()
    # Remove DC drift the recorders left behind; it eats headroom and thumps on start.
    y -= np.median(y[: max(64, len(y) // 200)])
    y -= y.mean()

    fi = max(1, int(FADE_IN * sr))
    y[:fi] *= np.linspace(0.0, 1.0, fi) ** 2

    fo = max(1, int(len(y) * FADE_OUT_FRAC))
    y[-fo:] *= (0.5 + 0.5 * np.cos(np.linspace(0.0, np.pi, fo))) ** 1.4

    y *= PEAK / (float(np.abs(y).max()) or 1.0)
    return np.clip(y, -1.0, 1.0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--immersive', required=True, help='ImmersiveThunder sounds/ directory')
    ap.add_argument('--stargate', required=True, help='Stargate thunder.wav path')
    ap.add_argument('--out', default='public/audio')
    args = ap.parse_args()

    roots = {'immersive': args.immersive, 'stargate': args.stargate}
    os.makedirs(args.out, exist_ok=True)

    total = 0
    for file_id, (root, name), max_sec, cutoff in SPEC:
        src = roots[root] if root == 'stargate' else os.path.join(roots[root], name)
        x, sr = load_mono(src)
        x = align_attack(subsonic(band_limit(x, sr, cutoff), sr, SUBSONIC_HZ), sr)
        y = trim(x, sr, max_sec)
        y = shape(y, sr)
        dst = os.path.join(args.out, file_id + '.wav')
        sf.write(dst, y, sr, subtype='PCM_16')
        size = os.path.getsize(dst)
        total += size
        rms = 20 * np.log10(np.sqrt((y ** 2).mean()) + 1e-12)
        print(f'{file_id:16s} {len(y) / sr:5.2f}s @ {sr} Hz  peak {np.abs(y).max():.2f}  '
              f'rms {rms:6.1f} dBFS  {size / 1024:6.0f} KB  <- {os.path.basename(src)}')
    print(f'total {total / 1024 / 1024:.2f} MB')


if __name__ == '__main__':
    main()
