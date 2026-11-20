"""Generate natural Bangladeshi neural narration (Microsoft bn-BD voices) per sentence.

Run it on your own computer (it needs normal internet). Output:

    episodes/<ep>/vo-neural/<voice>/<scene>-<nn>-<hash>.mp3
    episodes/<ep>/vo-neural/<voice>/manifest.json   {scene: [{file, text}, ...]}

build.py picks these up automatically when episode.json has
    "voice": {"engine": "neural", "name": "bn-BD-PradeepNeural"}

Usage:
    pip install edge-tts numpy
    python engine/neural_voice.py episodes/ep01-garments
Then upload the episodes/<ep>/vo-neural folder to the repo.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tts import normalize, sentences  # noqa: E402

VOICES = ["bn-BD-PradeepNeural", "bn-BD-NabanitaNeural"]


async def synth(text: str, voice: str, rate: str, pitch: str, out: Path):
    import edge_tts

    for attempt in range(5):
        try:
            await edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).save(str(out))
            if out.stat().st_size > 1000:
                return
        except Exception as e:  # network hiccups: retry with backoff
            print(f"  retry {attempt + 1}: {e}")
        await asyncio.sleep(2 ** attempt)
    raise RuntimeError(f"failed: {text[:40]}")


async def run(ep_dir: Path, voices: list[str], rate: str, pitch: str):
    ep = json.loads((ep_dir / "episode.json").read_text())
    for voice in voices:
        out = ep_dir / "vo-neural" / voice
        out.mkdir(parents=True, exist_ok=True)
        manifest, keep = {}, {"manifest.json"}
        for sc in ep["scenes"]:
            say = sc.get("say", "").strip()
            if not say:
                continue
            items = []
            for i, sent in enumerate(sentences(say)):
                spoken = normalize(sent)
                if not spoken:
                    continue
                key = hashlib.md5(f"{voice}|{rate}|{pitch}|{spoken}".encode()).hexdigest()[:8]
                f = out / f"{sc['id']}-{i:02d}-{key}.mp3"
                if not f.exists():
                    await synth(spoken, voice, rate, pitch, f)
                    print(f"  {voice} {f.name}")
                items.append({"file": f.name, "text": sent})
                keep.add(f.name)
            manifest[sc["id"]] = items
        for stale in out.iterdir():
            if stale.name not in keep:
                stale.unlink()
        (out / "manifest.json").write_text(json.dumps({"voice": voice, "rate": rate, "pitch": pitch, "scenes": manifest}, ensure_ascii=False, indent=1))
        print(f"✓ {ep_dir.name}: {voice}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("episodes", nargs="+")
    ap.add_argument("--voices", default=",".join(VOICES))
    ap.add_argument("--rate", default="+0%")
    ap.add_argument("--pitch", default="+0Hz")
    a = ap.parse_args()
    for e in a.episodes:
        asyncio.run(run(Path(e), a.voices.split(","), a.rate, a.pitch))


if __name__ == "__main__":
    main()
