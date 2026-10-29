#!/usr/bin/env python3
"""Synthesises the extra high-quality digital-horror SFX cues used by the glitch engine.

Pure stdlib DSP (no numpy) -> 16-bit WAV -> MP3 via lameenc.
Every cue is designed to be seamless-safe: smooth attacks, exponential decays, zero DC.
"""
from __future__ import annotations

import math
import os
import random
import struct
import wave

import lameenc

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "audio")
random.seed(90210)


# ---------------------------------------------------------------- DSP helpers
class OnePole:
    def __init__(self, cutoff: float) -> None:
        self.set_cutoff(cutoff)
        self.z = 0.0

    def set_cutoff(self, cutoff: float) -> None:
        cutoff = max(10.0, min(SR * 0.45, cutoff))
        self.a = math.exp(-2.0 * math.pi * cutoff / SR)

    def lp(self, x: float) -> float:
        self.z = x + self.a * (self.z - x)
        return self.z

    def hp(self, x: float) -> float:
        return x - self.lp(x)


class SVF:
    """Chamberlin state-variable filter — stable band-pass sweeps."""

    def __init__(self) -> None:
        self.low = 0.0
        self.band = 0.0

    def process(self, x: float, cutoff: float, q: float = 0.9) -> tuple[float, float, float]:
        f = 2.0 * math.sin(math.pi * max(30.0, min(SR * 0.22, cutoff)) / SR)
        self.low += f * self.band
        high = x - self.low - q * self.band
        self.band += f * high
        return self.low, self.band, high


def soft_clip(x: float, drive: float = 1.0) -> float:
    return math.tanh(x * drive)


def env_ad(i: int, n: int, attack: float, decay_pow: float = 2.2) -> float:
    t = i / n
    a = min(1.0, i / max(1.0, attack * n))
    return a * math.pow(max(0.0, 1.0 - t), decay_pow)


def fade_edges(buf: list[float], in_ms: float = 6.0, out_ms: float = 30.0) -> None:
    n = len(buf)
    ni = max(1, int(SR * in_ms / 1000.0))
    no = max(1, int(SR * out_ms / 1000.0))
    for i in range(min(ni, n)):
        buf[i] *= i / ni
    for i in range(min(no, n)):
        buf[n - 1 - i] *= i / no


def normalize(buf: list[float], peak: float = 0.92) -> None:
    m = max(1e-9, max(abs(v) for v in buf))
    g = peak / m
    for i in range(len(buf)):
        buf[i] *= g


def write_mp3(name: str, mono: list[float], bitrate: int = 160) -> None:
    n = len(mono)
    pcm = bytearray()
    for i, s in enumerate(mono):
        # subtle stereo widening: 1.4ms haas-free decorrelation via all-pass-ish delay
        l = s
        r = mono[i - 18] if i >= 18 else s
        for v in (l, r):
            pcm += struct.pack("<h", int(max(-1.0, min(1.0, v)) * 32000))

    enc = lameenc.Encoder()
    enc.set_bit_rate(bitrate)
    enc.set_in_sample_rate(SR)
    enc.set_channels(2)
    enc.set_quality(2)
    data = bytes(enc.encode(bytes(pcm)))
    data += bytes(enc.flush())
    path = os.path.join(OUT, name)
    with open(path, "wb") as fh:
        fh.write(data)
    print(f"  {name:26s} {n / SR:5.2f}s  {len(data) / 1024:6.1f} KB")


# ---------------------------------------------------------------- cues
def cue_glitch_stutter() -> list[float]:
    """Rhythmic digital buffer-repeat stutter with pitch jumps — a classic datamosh tear."""
    dur = 1.45
    n = int(SR * dur)
    buf = [0.0] * n
    bp = SVF()
    rnd = random.Random(7)
    step = int(SR * 0.045)
    held = 0.0
    pitch = 1.0
    for i in range(n):
        t = i / SR
        if i % step == 0:
            pitch = rnd.choice([1.0, 1.0, 1.34, 0.72, 1.51, 0.55])
            held = rnd.uniform(-1.0, 1.0)
        # buzzy square-ish carrier + white noise grain, sample-and-held in 45ms grains
        ph = (i * 141.0 * pitch / SR) % 1.0
        sq = 1.0 if ph < 0.5 else -1.0
        grain = held * 0.55 + sq * 0.34 + rnd.uniform(-1, 1) * 0.3
        cutoff = 900.0 + 5200.0 * (0.5 + 0.5 * math.sin(t * 24.0)) + pitch * 1400.0
        _, band, _ = bp.process(grain, cutoff, 0.42)
        gate = 1.0 if (i % step) < step * 0.82 else 0.12
        e = env_ad(i, n, 0.01, 0.85)
        buf[i] = soft_clip(band * 1.5, 1.4) * e * gate * 0.8
    fade_edges(buf, 4, 45)
    normalize(buf, 0.88)
    return buf


def cue_glitch_slice() -> list[float]:
    """Sharp horizontal scan-tear: metallic comb-filtered rip with a bright seam snap."""
    dur = 1.15
    n = int(SR * dur)
    buf = [0.0] * n
    bp = SVF()
    hp = OnePole(2400.0)
    rnd = random.Random(23)
    comb = [0.0] * 1400
    ci = 0
    for i in range(n):
        t = i / SR
        burst = math.exp(-t * 15.0) + 0.55 * math.exp(-max(0.0, t - 0.22) * 30.0)
        sweep = 5200.0 * math.exp(-t * 4.2) + 380.0
        _, band, _ = bp.process(rnd.uniform(-1, 1), sweep, 0.28)
        # metallic comb: short feedback delay tuned by the sweep
        d = comb[ci]
        w = band * burst + d * 0.62
        comb[ci] = w
        ci = (ci + 1) % 900
        bright = hp.hp(w) * 0.6
        snap = math.exp(-abs(t - 0.02) * 220.0) * 0.9
        e = env_ad(i, n, 0.002, 1.15)
        buf[i] = soft_clip((w * 0.9 + bright + snap * rnd.uniform(-1, 1)) * e, 1.25) * 0.85
    fade_edges(buf, 2, 40)
    normalize(buf, 0.9)
    return buf


def cue_sub_boom() -> list[float]:
    """Seismic sub drop with a dry transient — used for touchdown / world-breaking impacts."""
    dur = 2.4
    n = int(SR * dur)
    buf = [0.0] * n
    lp = OnePole(220.0)
    phase = 0.0
    rnd = random.Random(41)
    for i in range(n):
        t = i / SR
        freq = 26.0 + 92.0 * math.exp(-t * 3.4)
        phase += 2.0 * math.pi * freq / SR
        body = math.sin(phase) * math.exp(-t * 1.35)
        thump = lp.lp(rnd.uniform(-1, 1) * math.exp(-t * 22.0)) * 2.6
        grit = math.sin(phase * 2.02) * math.exp(-t * 4.5) * 0.22
        e = min(1.0, i / (SR * 0.004))
        buf[i] = soft_clip((body + thump + grit) * e, 1.5) * 0.9
    fade_edges(buf, 2, 220)
    normalize(buf, 0.94)
    return buf


def cue_tape_stop() -> list[float]:
    """Analogue tape-stop: the whole world's pitch collapses into a dead thud."""
    dur = 1.7
    n = int(SR * dur)
    buf = [0.0] * n
    lp = OnePole(3200.0)
    phase1 = 0.0
    phase2 = 0.0
    rnd = random.Random(5)
    for i in range(n):
        t = i / SR
        u = min(1.0, t / (dur * 0.82))
        rate = math.pow(1.0 - u, 1.7)
        wobble = 1.0 + 0.012 * math.sin(t * 47.0) * (1.0 - u)
        f1 = (196.0 + 120.0 * rate) * rate * wobble
        f2 = (392.0 + 260.0 * rate) * rate * wobble
        phase1 += 2.0 * math.pi * f1 / SR
        phase2 += 2.0 * math.pi * f2 / SR
        tone = math.sin(phase1) * 0.5 + math.sin(phase2) * 0.24 + math.sin(phase1 * 0.5) * 0.3
        hiss = lp.lp(rnd.uniform(-1, 1)) * (0.10 + 0.22 * (1.0 - u))
        e = math.sin(min(1.0, t / 0.03) * math.pi * 0.5) * (1.0 if u < 0.98 else 0.0)
        tail = math.exp(-max(0.0, t - dur * 0.78) * 9.0)
        buf[i] = soft_clip((tone * 0.65 + hiss) * e, 1.15) * (0.35 + 0.65 * tail) * 0.8
    fade_edges(buf, 8, 120)
    normalize(buf, 0.88)
    return buf


def cue_void_swell() -> list[float]:
    """Reverse-noise riser into a sub pad — the pre-transition breath before the world folds."""
    dur = 3.4
    n = int(SR * dur)
    buf = [0.0] * n
    bp = SVF()
    lp = OnePole(180.0)
    phase = 0.0
    rnd = random.Random(77)
    for i in range(n):
        t = i / SR
        u = t / dur
        swell = math.pow(u, 2.6)
        cutoff = 240.0 + 6300.0 * math.pow(u, 2.1)
        _, band, _ = bp.process(rnd.uniform(-1, 1), cutoff, 0.34)
        sub = math.sin(phase) * (0.3 + 0.7 * math.pow(u, 3.0))
        phase += 2.0 * math.pi * (36.0 + 22.0 * u) / SR
        pad = lp.lp(rnd.uniform(-1, 1)) * 0.5
        chop = 1.0 if math.sin(t * 2.0 * math.pi * (2.0 + 9.0 * u * u)) > -0.25 else 0.35
        e = swell * (0.35 + 0.65 * chop)
        buf[i] = soft_clip((band * 0.85 * e + sub * swell * 0.9 + pad * swell * 0.5), 1.2) * 0.85
    # hard cut at the peak = the moment the world snaps to the next scene
    fade_edges(buf, 40, 6)
    normalize(buf, 0.9)
    return buf


def cue_flesh_pulse() -> list[float]:
    """Wet organic pulse for the mouth: low throb with squelch and reversed suck."""
    dur = 2.2
    n = int(SR * dur)
    buf = [0.0] * n
    lp = OnePole(420.0)
    hp = OnePole(60.0)
    rnd = random.Random(31)
    phase = 0.0
    for i in range(n):
        t = i / SR
        beat = 0.5 + 0.5 * math.sin(t * 2.0 * math.pi * 3.4 - 1.2)
        phase += 2.0 * math.pi * (54.0 + 26.0 * beat) / SR
        throb = math.sin(phase) * math.pow(beat, 2.4)
        squelch = lp.lp(rnd.uniform(-1, 1)) * math.pow(beat, 5.0) * 2.2
        wet = hp.hp(squelch)
        e = env_ad(i, n, 0.06, 1.0)
        buf[i] = soft_clip((throb * 0.8 + wet * 0.9) * e, 1.35) * 0.85
    fade_edges(buf, 25, 120)
    normalize(buf, 0.9)
    return buf


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    print("Synthesising glitch SFX ->", OUT)
    write_mp3("glitch_stutter.mp3", cue_glitch_stutter())
    write_mp3("glitch_slice.mp3", cue_glitch_slice())
    write_mp3("sub_boom.mp3", cue_sub_boom())
    write_mp3("tape_stop.mp3", cue_tape_stop())
    write_mp3("void_swell.mp3", cue_void_swell())
    write_mp3("flesh_pulse.mp3", cue_flesh_pulse())
    print("Done.")


if __name__ == "__main__":
    main()
