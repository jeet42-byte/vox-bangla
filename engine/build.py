"""Build an episode: narration → timing → audio mix → video → reels → thumbnail.

    python3 engine/build.py episodes/ep01-garments                 # everything
    python3 engine/build.py episodes/ep01-garments --only long     # 16:9 YouTube video
    python3 engine/build.py episodes/ep01-garments --only reels    # 9:16 Reels / Shorts
    python3 engine/build.py episodes/ep01-garments --only thumb    # thumbnails
    python3 engine/build.py episodes/ep01-garments --preview       # fast half-res draft
    python3 engine/build.py episodes/ep01-garments --stills        # one PNG per scene for review

Outputs land in build/<episode-id>/.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import music  # noqa: E402
import tts  # noqa: E402

SR = music.SR
LEAD = 0.30   # voice starts this long after a scene cuts in
TAIL = 0.45   # breathing room after the last word


# ------------------------------------------------------------------ io utils
def read_wav(p: Path) -> np.ndarray:
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(out, np.float32).copy()


def write_wav(p: Path, x: np.ndarray, sr: int = SR):
    x = np.clip(x, -1, 1)
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    with wave.open(str(p), "wb") as w:
        w.setnchannels(x.shape[1]); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((x * 32767).astype("<i2").tobytes())


def resample(x: np.ndarray, sr_in: int, sr_out: int = SR) -> np.ndarray:
    if sr_in == sr_out:
        return x
    n = int(len(x) * sr_out / sr_in)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def ensure_textures():
    if not (ROOT / "assets/textures/paper.jpg").exists():
        import textures
        textures.main()


def ensure_world_js():
    out = HERE / "player" / "world.js"
    if not out.exists():
        topo = (ROOT / "assets/geo/countries-50m.json").read_text()
        out.write_text("window.__TOPO=" + topo + ";")


# ---------------------------------------------------------------- narration
def narrate(ep: dict, ep_dir: Path, bdir: Path):
    """Return {scene_id: (samples@48k, [(sentence, t0, t1)])}."""
    vo_dir = bdir / "vo"; vo_dir.mkdir(parents=True, exist_ok=True)
    human = ep_dir / "vo"
    narrator = None
    out = {}
    v = ep.get("voice", {})
    neural = neural_dir = None
    if v.get("engine") == "neural":
        neural_dir = ep_dir / "vo-neural" / v.get("name", "bn-BD-PradeepNeural")
        mf = neural_dir / "manifest.json"
        if not mf.exists():
            raise SystemExit(f"{mf} not found: run engine/neural_voice.py on a computer with internet and upload the vo-neural folder")
        neural = json.loads(mf.read_text())
        print(f"  voice: {neural['voice']} (neural)")
    for sc in ep["scenes"]:
        say = sc.get("say", "").strip()
        if not say:
            continue
        hv = human / f"{sc['id']}.wav"
        if hv.exists():                          # human narration wins
            x = read_wav(hv)
            x = tts.trim(x, SR)
            dur = len(x) / SR
            sents = tts.sentences(say)
            tot = sum(len(s) for s in sents) or 1
            marks, c = [], 0.0
            for s_ in sents:
                d = dur * len(s_) / tot; marks.append((s_, c, c + d)); c += d
            out[sc["id"]] = (x, marks)
            continue
        if neural is not None:                   # Microsoft bn-BD neural voice
            items = neural["scenes"].get(sc["id"])
            if not items:
                raise SystemExit(f"neural narration missing for {sc['id']}: re-run engine/neural_voice.py (the script changed)")
            parts, marks, c = [], [], 0.0
            gap = np.zeros(int(v.get("gap", 0.30) * SR), np.float32)
            for i, it in enumerate(items):
                x = tts.trim(read_wav(neural_dir / it["file"]), SR, 0.02)
                marks.append((it["text"], c, c + len(x) / SR))
                parts.append(x); c += len(x) / SR
                if i < len(items) - 1:
                    parts.append(gap); c += len(gap) / SR
            y = np.concatenate(parts)
            out[sc["id"]] = (y / (np.abs(y).max() + 1e-6) * 0.89, marks)
            continue
        if narrator is None:
            v = ep.get("voice", {})
            narrator = tts.Narrator(speed=v.get("speed", 1.0), gap=v.get("gap", 0.34))
        key = hashlib.md5((narrator.tag + say).encode()).hexdigest()[:16]
        cache = vo_dir / f"{sc['id']}-{key}.npz"
        if cache.exists():
            z = np.load(cache, allow_pickle=True)
            out[sc["id"]] = (z["x"], [tuple(m) for m in z["marks"].tolist()])
            continue
        y, sr, marks = narrator.say(say)
        y = resample(y, sr, SR)
        y = y / (np.abs(y).max() + 1e-6) * 0.89
        np.savez(cache, x=y, marks=np.array(marks, dtype=object))
        out[sc["id"]] = (y, marks)
        print(f"  vo {sc['id']}: {len(y)/SR:.1f}s")
    return out


def timeline(scenes: list[dict], vo: dict) -> list[dict]:
    t = 0.0
    out = []
    for sc in scenes:
        x = vo.get(sc["id"])
        lead = sc.get("lead", LEAD)
        dur = (lead + len(x[0]) / SR + sc.get("pad", TAIL)) if x else 0
        dur = max(dur, sc.get("minDur", 2.2 if x else 3.0))
        if sc.get("dur"):
            dur = sc["dur"]
        o = {k: v for k, v in sc.items() if k not in ("say",)}
        o.update(start=round(t, 4), dur=round(dur, 4), lead=lead)
        out.append(o)
        t += dur
    return out


# ------------------------------------------------------------------- audio
def mix(timed: list[dict], vo: dict, ep: dict, ep_dir: Path) -> np.ndarray:
    total = timed[-1]["start"] + timed[-1]["dur"]
    n = int(total * SR) + SR
    voice = np.zeros(n, np.float32)
    sfx = np.zeros(n, np.float32)
    for sc in timed:
        if sc["id"] in vo:
            x = vo[sc["id"]][0]
            a = int((sc["start"] + sc["lead"]) * SR)
            voice[a:a + len(x)] += x[: n - a]
        kinds = sc.get("sfx")
        if kinds is None:
            kinds = {"chapter": ["whoosh", "hit"], "title": ["rise", "hit"], "map": ["whoosh"], "bignum": ["tick"], "memorial": ["hit"], "grid": ["tick"], "end": ["rise"]}.get(sc["type"], [])
        for k in kinds:
            x = music.SFX[k]()
            a = int(max(0, sc["start"] - (0.45 if k in ("whoosh",) else 0.0) - (1.0 if k == "rise" else 0)) * SR)
            sfx[a:a + len(x)] += x[: n - a]
    # score
    lic = ep_dir / "music.wav"
    if lic.exists():
        bed = read_wav(lic)
        bed = np.tile(bed, int(np.ceil(n / len(bed))))[:n] * 0.5
    else:
        secs, cur = [], None
        for sc in timed:
            mood = sc.get("mood") or ("dark" if sc["type"] == "memorial" else None)
            if mood is None:
                mood = cur["mood"] if cur else "calm"
            if sc["type"] == "chapter" or cur is None or mood != cur["mood"]:
                if cur:
                    cur["end"] = sc["start"]
                cur = {"start": sc["start"], "mood": mood, "prog": len(secs)}
                secs.append(cur)
        cur["end"] = total
        bed = music.score(total, secs, bpm=ep.get("bpm", 84))
        bed = np.pad(bed, (0, max(0, n - len(bed))))[:n]
    # sidechain duck the bed under the voice
    env = np.abs(voice)
    k = int(0.25 * SR)
    cs = np.concatenate([[0.0], np.cumsum(env, dtype=np.float64)])
    lo = np.clip(np.arange(len(env)) - k // 2, 0, len(env)); hi = np.clip(np.arange(len(env)) + k // 2, 0, len(env))
    env = ((cs[hi] - cs[lo]) / k).astype(np.float32)
    duck = 1 - 0.62 * np.clip(env / 0.08, 0, 1)
    out = voice * 1.0 + bed * duck * ep.get("musicGain", 0.9) + sfx
    return out[: int(total * SR)]


def loudnorm(src: Path, dst: Path, target=-14):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-af", f"loudnorm=I={target}:TP=-1.0:LRA=11", "-ar", str(SR), str(dst)], check=True)


# ---------------------------------------------------------------- captions
def caption_chunks(timed: list[dict], vo: dict, max_words=6) -> list[dict]:
    caps = []
    for sc in timed:
        if sc["id"] not in vo:
            continue
        for sent, t0, t1 in vo[sc["id"]][1]:
            clean = re.sub(r"==|__|\*\*|~~|\[\[|\]\]", "", sent)
            words = clean.split()
            groups = [words[i:i + max_words] for i in range(0, len(words), max_words)]
            if len(groups) > 1 and len(groups[-1]) <= 2:
                last = groups.pop()
                groups[-1] += last
            tot = sum(len(" ".join(g)) for g in groups) or 1
            c = t0
            for g in groups:
                d = (t1 - t0) * len(" ".join(g)) / tot
                base = sc["start"] + sc["lead"]
                caps.append({"start": round(base + c, 3), "end": round(base + c + d, 3), "text": " ".join(g)})
                c += d
    return caps


def srt(caps: list[dict]) -> str:
    def ts(x):
        h, r = divmod(x, 3600); m, s = divmod(r, 60)
        return f"{int(h):02}:{int(m):02}:{int(s):02},{int((s % 1) * 1000):03}"
    return "\n".join(f"{i}\n{ts(c['start'])} --> {ts(c['end'])}\n{c['text']}\n" for i, c in enumerate(caps, 1))


# ------------------------------------------------------------------- video
def render(timed_json: Path, out: Path, workers: int, extra=()):
    subprocess.run(["node", str(HERE / "render.mjs"), str(timed_json), str(out), "--workers", str(workers), *extra], check=True)


def mux(video: Path, audio: Path, out: Path):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-i", str(audio), "-c:v", "copy", "-c:a", "aac", "-b:a", "256k",
                    "-movflags", "+faststart", "-shortest", str(out)], check=True)


def chapters_text(timed):
    lines = []
    for sc in timed:
        if sc["type"] in ("chapter", "title") or sc.get("chapterMark"):
            m, s = divmod(int(sc["start"]), 60)
            title = sc.get("chapterMark") or sc.get("data", {}).get("title", "")
            lines.append(f"{m:02}:{s:02} {re.sub(r'==|__|\*\*', '', title)}")
    if lines and not lines[0].startswith("00:00"):
        lines.insert(0, "00:00 শুরু")
    return "\n".join(lines)


# --------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("episode")
    ap.add_argument("--only", choices=["long", "reels", "thumb", "audio"])
    ap.add_argument("--preview", action="store_true", help="half resolution, fast x264 preset")
    ap.add_argument("--stills", action="store_true", help="render a PNG per scene for review")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--fps", type=int)
    a = ap.parse_args()

    ep_dir = Path(a.episode).resolve()
    ep = json.loads((ep_dir / "episode.json").read_text())
    bdir = ROOT / "build" / ep["id"]; bdir.mkdir(parents=True, exist_ok=True)
    ensure_textures(); ensure_world_js()
    scale = 0.5 if a.preview else 1.0
    fps = a.fps or ep.get("fps", 30)
    extra = ["--preset", "veryfast", "--crf", "22"] if a.preview else []
    brand = ep.get("brand", {"name": "ব্যাখ্যা"})

    print("• narration")
    vo = narrate(ep, ep_dir, bdir)
    scenes = ep["scenes"]
    byid = {s["id"]: s for s in scenes}

    if a.only in (None, "long", "audio") or a.stills:
        timed = timeline(scenes, vo)
        total = timed[-1]["start"] + timed[-1]["dur"]
        print(f"• long-form timeline: {total/60:.1f} min, {len(timed)} scenes")
        W, H = int(1920 * scale), int(1080 * scale)
        tj = bdir / "timed-long.json"
        tj.write_text(json.dumps({"width": W, "height": H, "fps": fps, "brand": brand, "scenes": timed}, ensure_ascii=False))
        caps = caption_chunks(timed, vo, max_words=9)
        (bdir / f"{ep['id']}.bn.srt").write_text(srt(caps))
        (bdir / "chapters.txt").write_text(chapters_text(timed))
        if a.stills:
            sd = bdir / "stills"; sd.mkdir(exist_ok=True)
            ex = []
            for sc in timed:
                ex += ["--still", f"{sc['start'] + sc['dur'] * 0.8:.3f}:{sd / (sc['id'] + '.png')}"]
            render(tj, bdir / "unused.mp4", 1, ex)
            return
        if a.only in (None, "long", "audio"):
            print("• audio mix")
            raw = bdir / "mix-raw.wav"
            write_wav(raw, mix(timed, vo, ep, ep_dir))
            loudnorm(raw, bdir / "mix.wav")
            if a.only != "audio":
                print("• render 16:9")
                silent = bdir / "long-silent.mp4"
                render(tj, silent, a.workers, extra)
                final = bdir / f"{ep['id']}{'-preview' if a.preview else ''}.mp4"
                mux(silent, bdir / "mix.wav", final)
                silent.unlink(missing_ok=True)
                print("✓", final)

    if a.only in (None, "reels"):
        for reel in ep.get("reels", []):
            rs = [dict(byid[i]) for i in reel["scenes"]]
            for r in rs:
                r["minDur"] = min(r.get("minDur", 2.0), 2.0)
            if reel.get("outro", True):
                rs.append({"id": f"{reel['id']}-outro", "type": "end", "dur": 2.6, "sfx": [],
                           "data": {"text": reel.get("outroText", "পুরো গল্পটা দেখুন ==চ্যানেলে=="), "cta": brand.get("handle", "")}})
            timed = timeline(rs, vo)
            caps = caption_chunks(timed, vo, max_words=4)
            W, H = int(1080 * scale), int(1920 * scale)
            tj = bdir / f"timed-{reel['id']}.json"
            tj.write_text(json.dumps({"width": W, "height": H, "fps": fps, "brand": brand, "scenes": timed, "captions": caps, "reelHead": reel.get("head", "")}, ensure_ascii=False))
            print(f"• reel {reel['id']}: {timed[-1]['start'] + timed[-1]['dur']:.0f}s")
            raw = bdir / f"{reel['id']}-raw.wav"
            write_wav(raw, mix(timed, vo, {**ep, "musicGain": 1.0}, ep_dir))
            loudnorm(raw, bdir / f"{reel['id']}.wav")
            silent = bdir / f"{reel['id']}-silent.mp4"
            render(tj, silent, a.workers, extra)
            final = bdir / f"{ep['id']}-{reel['id']}{'-preview' if a.preview else ''}.mp4"
            mux(silent, bdir / f"{reel['id']}.wav", final)
            silent.unlink(missing_ok=True)
            (bdir / f"{reel['id']}.srt").write_text(srt(caps))
            print("✓", final)

    if a.only in (None, "thumb"):
        for i, th in enumerate(ep.get("thumbnails", [])):
            for fmt_, (W, H) in (("16x9", (1280, 720)), ("9x16", (1080, 1920))):
                tj = bdir / f"timed-thumb{i}-{fmt_}.json"
                tj.write_text(json.dumps({"width": W, "height": H, "fps": fps, "brand": brand,
                                          "scenes": [{"id": "thumb", "type": th.get("type", "thumb"), "start": 0, "dur": 10, "transition": "cut", "data": th}]}, ensure_ascii=False))
                out = bdir / f"thumbnail-{i + 1}-{fmt_}.png"
                render(tj, bdir / "unused.mp4", 1, ["--still", f"9.9:{out}"])
                print("✓", out)


if __name__ == "__main__":
    main()
