# ব্যাখ্যা: বাংলা ভিজ্যুয়াল এক্সপ্লেইনার

A production engine and episode library for a **Bangla-language explainer-journalism channel**, built in the visual-essay style of channels like Vox: paper-textured motion graphics, highlighter-swept kinetic type, animated maps, self-drawing charts and chaptered narrative. All topics are Bangladeshi or Bangla.

Channel: **YouTube [@AhnafAkif-h2k](https://www.youtube.com/@AhnafAkif-h2k)** · long-form videos (16:9) plus Reels/Shorts (9:16)

> The channel borrows the *storytelling grammar* of explainer journalism, not anyone's branding, footage or music. Everything here (graphics, score, sound design) is generated from code or open-licensed fonts and data. See [`docs/STYLE_GUIDE.md`](docs/STYLE_GUIDE.md).

## Episodes
| # | Title | Status |
|---|---|---|
| 01 | [বাংলাদেশ কীভাবে পৃথিবীর দর্জি হলো](episodes/ep01-garments) (How Bangladesh became the world's tailor) | ✅ script + full render, 3 reels, 2 thumbnails |
| 02 | ঢাকা কেন এত ঘনবসতিপূর্ণ? (Why is Dhaka so dense?) | teased in the Ep01 end card; see [`docs/TOPICS.md`](docs/TOPICS.md) |

## How it works
```
episodes/<id>/episode.json      script: one entry per beat → narration (say) + visual (type, data)
        │
        ├─ engine/tts.py         Bangla text normalization (numbers → words) + offline neural TTS
        │                        (or your own recordings in episodes/<id>/vo/<scene>.wav)
        ├─ engine/build.py       timing from narration → captions/SRT → audio mix (score, SFX, ducking, −14 LUFS)
        ├─ engine/music.py       procedural, royalty-free score + sound design
        ├─ engine/player/        HTML/CSS/JS scene engine: every frame is a pure function of time
        └─ engine/render.mjs     Playwright → ffmpeg, parallel frame-accurate rendering
                │
                ▼
build/<id>/  <id>.mp4 (1080p) · reels (1080×1920) · .srt · chapters.txt · thumbnails
```

## Quick start
```bash
bash scripts/setup.sh
python3 engine/build.py episodes/ep01-garments --stills     # review every scene as a PNG
python3 engine/build.py episodes/ep01-garments --preview    # fast 540p draft
python3 engine/build.py episodes/ep01-garments              # final video + reels + thumbnails
```

## Docs
- [`docs/STYLE_GUIDE.md`](docs/STYLE_GUIDE.md): the reverse-engineered explainer formula (story beats, visual grammar, sound, reels, thumbnails)
- [`docs/WORKFLOW.md`](docs/WORKFLOW.md): research → script → voice → render → upload checklist, plus the scene reference
- [`docs/TOPICS.md`](docs/TOPICS.md): 27 Bangla topic ideas, each framed as question, hook and mechanism

## Credits and licences
- Fonts: Anek Bangla, Hind Siliguri, Noto Serif Bengali (SIL Open Font License) via Fontsource
- Map data: Natural Earth via `world-atlas` (public domain / ISC)
- Draft voice: Coqui VITS Bangla model (`vits-coqui-bn-custom_female`) via sherpa-onnx, downloaded by `scripts/setup.sh`
- d3-geo, topojson-client (ISC)
