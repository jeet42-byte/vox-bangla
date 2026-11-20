"""Procedural score + sound design, so every video ships with royalty-free audio.

The palette mimics the restrained "explainer" sound: soft electric-piano
chords, a sub pulse, a ticking hi-hat that only comes in under data scenes,
and short whooshes / low hits on chapter cards. Everything is generated with
numpy — no samples, no licences to worry about.
Replace with a licensed track any time: put music.wav in the episode folder.
"""
from __future__ import annotations

import numpy as np

SR = 48000


def _env(n, a=0.01, r=0.5):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / max(r, 1e-4))
    return e.astype(np.float32)


def _lp_fast(x, cutoff):
    try:
        from scipy.signal import lfilter  # optional
        a = np.exp(-2 * np.pi * cutoff / SR)
        return lfilter([1 - a], [1, -a], x).astype(np.float32)
    except Exception:
        # FFT brick-ish low-pass fallback
        X = np.fft.rfft(x)
        f = np.fft.rfftfreq(len(x), 1 / SR)
        X *= 1 / (1 + (f / cutoff) ** 4)
        return np.fft.irfft(X, len(x)).astype(np.float32)


def _reverb(x, seconds=2.2, mix=0.28, seed=1):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    ir = rng.standard_normal(n).astype(np.float32) * np.exp(-np.arange(n) / (SR * seconds / 6.5)).astype(np.float32)
    ir = _lp_fast(ir, 5000)
    ir /= np.sqrt((ir ** 2).sum())
    L = len(x) + n
    N = 1 << int(np.ceil(np.log2(L)))
    wet = np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[: len(x)].astype(np.float32)
    return (1 - mix) * x + mix * wet


def note_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def epiano(freq, dur, vel=0.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    tone = (np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * 2 * freq * t) * np.exp(-t * 3)
            + 0.12 * np.sin(2 * np.pi * 3.01 * freq * t) * np.exp(-t * 6))
    trem = 1 + 0.08 * np.sin(2 * np.pi * 4.2 * t)
    return (tone * trem * _env(n, 0.006, 1.6) * vel).astype(np.float32)


def pad(freq, dur, vel=0.2):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * freq * (1 + d) * t + p) for d, p in ((0, 0), (0.004, 1.3), (-0.0035, 2.1)))
    att = np.minimum(1, t / 1.2) * np.minimum(1, (dur - t) / 1.0).clip(0, 1)
    return (x / 3 * att * vel).astype(np.float32)


# minor-ish, hopeful progressions (MIDI root, chord intervals)
PROGS = [
    [(57, (0, 3, 7, 10)), (53, (0, 4, 7, 11)), (48, (0, 4, 7, 14)), (55, (0, 4, 7, 10))],   # Am7 Fmaj7 Cadd9 G7
    [(50, (0, 3, 7, 10)), (55, (0, 4, 7, 9)), (52, (0, 3, 7, 10)), (57, (0, 3, 7, 10))],     # Dm7 G6 Em7 Am7
    [(52, (0, 3, 7, 14)), (48, (0, 4, 7, 11)), (55, (0, 4, 7, 14)), (50, (0, 3, 7, 10))],     # Em9 Cmaj7 Gadd9 Dm7
]


def score(total: float, sections: list[dict], bpm: float = 84, seed: int = 4) -> np.ndarray:
    """sections: [{start, end, mood: 'calm'|'drive'|'dark'|'none', prog: int}]"""
    rng = np.random.default_rng(seed)
    n = int(total * SR) + SR
    out = np.zeros(n, np.float32)
    beat = 60 / bpm
    bar = beat * 4
    for sec in sections:
        mood = sec.get("mood", "calm")
        if mood == "none":
            continue
        prog = PROGS[sec.get("prog", 0) % len(PROGS)]
        t = sec["start"]
        i = 0
        while t < sec["end"] - 0.5:
            root, iv = prog[i % len(prog)]
            if mood == "dark":
                root -= 12 if root > 50 else 0
            seg_end = min(sec["end"], t + bar * 2)
            d = seg_end - t
            a = int(t * SR)
            # pad
            for k in iv[:3]:
                x = pad(note_hz(root + k), d + 1.0, 0.05 if mood != "dark" else 0.07)
                out[a:a + len(x)] += x[: n - a]
            # sub
            if mood in ("drive", "dark"):
                for b in range(int(d / beat)):
                    s0 = a + int(b * beat * SR)
                    x = np.sin(2 * np.pi * note_hz(root - 12) * np.arange(int(beat * SR)) / SR).astype(np.float32) * _env(int(beat * SR), 0.01, 0.35) * 0.10
                    out[s0:s0 + len(x)] += x[: n - s0]
            # arpeggiated e-piano
            if mood != "dark":
                steps = int(d / (beat / 2))
                pat = [0, 2, 1, 3, 2, 1, 3, 2]
                for st in range(steps):
                    if rng.random() < (0.35 if mood == "calm" else 0.6):
                        k = iv[pat[st % len(pat)] % len(iv)] + 12
                        x = epiano(note_hz(root + k), 1.8, 0.05 + 0.03 * rng.random())
                        s0 = a + int(st * beat / 2 * SR)
                        out[s0:s0 + len(x)] += x[: n - s0]
            # ticking hat
            if mood == "drive":
                for st in range(int(d / (beat / 2))):
                    s0 = a + int(st * beat / 2 * SR)
                    m = int(0.05 * SR)
                    x = rng.standard_normal(m).astype(np.float32)
                    x = (x - _lp_fast(x, 6000)) * _env(m, 0.001, 0.015) * (0.03 if st % 2 else 0.018)
                    out[s0:s0 + m] += x[: n - s0]
            t = seg_end
            i += 1
        # fade section edges
        a, b = int(sec["start"] * SR), int(sec["end"] * SR)
        f = int(0.8 * SR)
        out[a:a + f] *= np.linspace(0, 1, min(f, n - a))[: len(out[a:a + f])]
        out[max(0, b - f):b] *= np.linspace(1, 0, len(out[max(0, b - f):b]))
    out = _reverb(out, 2.6, 0.35)
    return out[: int(total * SR)]


def whoosh(dur=0.7, seed=0):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    x = rng.standard_normal(n).astype(np.float32)
    t = np.linspace(0, 1, n)
    env = np.sin(np.pi * t) ** 2 * (t ** 0.6)
    # sweep: blend low-passed versions
    lo, hi = _lp_fast(x, 600), _lp_fast(x, 4000)
    y = (lo * (1 - t) + (hi - _lp_fast(x, 300)) * t) * env
    return (y / (np.abs(y).max() + 1e-6) * 0.22).astype(np.float32)


def hit(dur=1.6):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 55 * np.exp(-t * 1.5) + 38
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.6)
    return (_reverb(x.astype(np.float32), 1.8, 0.3) * 0.32).astype(np.float32)


def tick():
    n = int(0.06 * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * 1850 * t) * np.exp(-t * 90)
    return (x * 0.10).astype(np.float32)


def pop():
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    f = 900 * np.exp(-t * 25) + 300
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 35)
    return (x * 0.09).astype(np.float32)


def sweep_up(dur=1.2):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 200 + 900 * (t / dur) ** 2
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / dur) ** 2 * 0.05
    return _reverb(x.astype(np.float32), 1.2, 0.4)


SFX = {"whoosh": whoosh, "hit": hit, "tick": tick, "pop": pop, "rise": sweep_up}
