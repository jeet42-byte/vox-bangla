"""Bangla narration: text normalisation + offline neural TTS (sherpa-onnx VITS).

The TTS voice is a *scratch / draft* narrator. For the published channel the
best result is a human narrator: record the script (see docs/WORKFLOW.md) and
drop WAV files into episodes/<ep>/vo/<scene-id>.wav — build.py will use those
instead of the synthetic voice automatically.
"""
from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL = ROOT / "models" / "vits-coqui-bn-custom_female"
SR = 22050

# ------------------------------------------------------------------ numbers
_ONES = ("শূন্য এক দুই তিন চার পাঁচ ছয় সাত আট নয় দশ এগারো বারো তেরো চৌদ্দ পনেরো ষোলো সতেরো আঠারো উনিশ "
         "বিশ একুশ বাইশ তেইশ চব্বিশ পঁচিশ ছাব্বিশ সাতাশ আটাশ ঊনত্রিশ ত্রিশ একত্রিশ বত্রিশ তেত্রিশ চৌত্রিশ "
         "পঁয়ত্রিশ ছত্রিশ সাঁইত্রিশ আটত্রিশ ঊনচল্লিশ চল্লিশ একচল্লিশ বিয়াল্লিশ তেতাল্লিশ চুয়াল্লিশ পঁয়তাল্লিশ "
         "ছেচল্লিশ সাতচল্লিশ আটচল্লিশ ঊনপঞ্চাশ পঞ্চাশ একান্ন বায়ান্ন তিপ্পান্ন চুয়ান্ন পঞ্চান্ন ছাপ্পান্ন সাতান্ন "
         "আটান্ন ঊনষাট ষাট একষট্টি বাষট্টি তেষট্টি চৌষট্টি পঁয়ষট্টি ছেষট্টি সাতষট্টি আটষট্টি ঊনসত্তর সত্তর একাত্তর "
         "বাহাত্তর তিয়াত্তর চুয়াত্তর পঁচাত্তর ছিয়াত্তর সাতাত্তর আটাত্তর ঊনআশি আশি একাশি বিরাশি তিরাশি চুরাশি "
         "পঁচাশি ছিয়াশি সাতাশি অষ্টাশি ঊননব্বই নব্বই একানব্বই বিরানব্বই তিরানব্বই চুরানব্বই পঁচানব্বই ছিয়ানব্বই "
         "সাতানব্বই আটানব্বই নিরানব্বই").split()
assert len(_ONES) == 100

BN_DIGITS = "০১২৩৪৫৬৭৮৯"
_TO_ASCII = str.maketrans(BN_DIGITS, "0123456789")


def int_words(n: int) -> str:
    if n < 100:
        return _ONES[n]
    parts = []
    for unit, name in ((10_000_000, "কোটি"), (100_000, "লাখ"), (1000, "হাজার"), (100, "শো")):
        if n >= unit:
            q, n = divmod(n, unit)
            if unit == 100:
                parts.append(("এক" if q == 1 else int_words(q)) + "শো")
            else:
                parts.append(f"{int_words(q)} {name}")
    if n:
        parts.append(_ONES[n])
    return " ".join(parts)


def year_words(y: int) -> str:
    if 1100 <= y <= 1999:
        hi, lo = divmod(y, 100)
        return f"{_ONES[hi]}শো" + (f" {_ONES[lo]}" if lo else "")
    return int_words(y)


def number_words(tok: str, next_word: str = "") -> str:
    tok = tok.translate(_TO_ASCII).replace(",", "")
    if "." in tok:
        a, b = tok.split(".", 1)
        return f"{int_words(int(a or 0))} দশমিক " + " ".join(_ONES[int(c)] for c in b)
    n = int(tok)
    if len(tok) == 4 and 1100 <= n <= 2099 and next_word.startswith(("সাল", "সালে", "সালের", "-এ", "এর", "থেকে", "পর্যন্ত")):
        return year_words(n)
    return int_words(n)


_NUM = re.compile(r"[0-9০-৯][0-9০-৯,]*(?:\.[0-9০-৯]+)?")


def normalize(text: str) -> str:
    """Make arbitrary Bangla text speakable by the character-level TTS model."""
    t = text
    t = re.sub(r"==|__|\*\*|~~|\[\[|\]\]", "", t)          # strip on-screen markup
    t = t.replace("%", " শতাংশ").replace("৳", "টাকা ")
    out, pos = [], 0
    for m in _NUM.finditer(t):
        out.append(t[pos:m.start()])
        nxt = t[m.end():m.end() + 6].strip()
        out.append(number_words(m.group(0).rstrip(","), nxt))
        pos = m.end()
    out.append(t[pos:])
    t = "".join(out)
    t = re.sub(r"[:;()\[\]\"“”]", ",", t)
    t = re.sub(r"\s*—\s*", ", ", t)
    t = re.sub(r"[A-Za-z]+", "", t)                           # model has no Latin glyphs
    t = re.sub(r"\s+", " ", t).strip()
    return t


def sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[।?!])\s+", text.strip())
    return [p for p in (x.strip() for x in parts) if p]


# --------------------------------------------------------------------- TTS
class Narrator:
    def __init__(self, model_dir: str | os.PathLike | None = None, speed: float = 1.0, gap: float = 0.32):
        import sherpa_onnx  # imported lazily so the rest of the engine works without it

        d = Path(model_dir or os.environ.get("VOXBN_TTS_MODEL", DEFAULT_MODEL))
        if not (d / "model.onnx").exists():
            raise SystemExit(f"TTS model not found in {d}. Run scripts/setup.sh first.")
        cfg = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=str(d / "model.onnx"), tokens=str(d / "tokens.txt")),
                num_threads=max(1, (os.cpu_count() or 2)),
            )
        )
        self.tts = sherpa_onnx.OfflineTts(cfg)
        self.speed, self.gap = speed, gap
        self.sr = self.tts.sample_rate
        self.tag = hashlib.md5(f"{d.name}|{speed}|{gap}".encode()).hexdigest()[:8]

    def say(self, text: str):
        """Returns (samples float32, sample_rate, [(sentence, start, end), ...])."""
        chunks, marks, cur = [], [], 0.0
        gap = np.zeros(int(self.gap * self.sr), np.float32)
        for sent in sentences(text):
            spoken = normalize(sent)
            if not spoken:
                continue
            a = self.tts.generate(spoken, sid=0, speed=self.speed)
            x = trim(np.asarray(a.samples, np.float32), self.sr)
            marks.append((sent, cur, cur + len(x) / self.sr))
            chunks += [x, gap]
            cur += (len(x) + len(gap)) / self.sr
        if not chunks:
            return np.zeros(1, np.float32), self.sr, []
        y = np.concatenate(chunks[:-1])
        return y, self.sr, marks


def trim(x: np.ndarray, sr: int, thresh: float = 0.01) -> np.ndarray:
    """Trim leading/trailing silence, keep 40 ms of air."""
    env = np.abs(x)
    idx = np.where(env > thresh * max(1e-6, env.max()))[0]
    if not len(idx):
        return x
    pad = int(0.04 * sr)
    return x[max(0, idx[0] - pad): idx[-1] + pad]


if __name__ == "__main__":
    import sys

    for line in sys.argv[1:] or ["১৯৭৮ সালে ১৩০ জন কর্মী দক্ষিণ কোরিয়ায় গেলেন। রপ্তানির ৮১.৫% আসে পোশাক থেকে।"]:
        print(normalize(line))
