# Production workflow: from idea to upload

## 0. One-time setup
```bash
bash scripts/setup.sh        # python deps, Bangla TTS model, textures
```
You also need Node 18+ with Playwright/Chromium and ffmpeg (`apt install ffmpeg`, `npm i -g playwright && npx playwright install chromium`).

## 1. Research (1 day)
1. Pick a topic from `docs/TOPICS.md` and write the **one-sentence question**.
2. Collect 8–15 facts. For each, note the source **and** check it against a second source. Write them in `episodes/<id>/SOURCES.md`.
3. Find the hook image (a physical, everyday thing) and the single most surprising number.

## 2. Script (1 day)
Create `episodes/<id>/episode.json` (copy Ep01 as a template). Each scene has:
- `say`: the narration for that beat (Bangla, spoken style, 1–3 sentences)
- `type` + `data`: the visual (see the scene reference below)
- optional: `mood` (`calm` / `drive` / `dark`) to steer the music, `transition` (`fade` / `cut` / `push`), `sfx`, `minDur`, `dur`

Then review the visuals without rendering video:
```bash
python3 engine/build.py episodes/<id> --stills     # one PNG per scene in build/<id>/stills
```

## 3. Voice
**Draft:** the built-in offline Bangla TTS voice is used automatically.
**Final (recommended):** record a human narrator. Quality narration is the single biggest quality jump you can make.
- Run `--stills` once, then open `build/<id>/timed-long.json` to see each scene's text.
- Record each scene as its own file, `episodes/<id>/vo/<scene-id>.wav` (for example `vo/s01.wav`). Any phone in a quiet room with a blanket over your head works; a USB mic is better.
- Re-run the build. Recorded scenes replace TTS automatically, and the timing re-flows to match your pace.

## 4. Render
```bash
python3 engine/build.py episodes/<id> --preview          # fast 540p check, ~3x faster
python3 engine/build.py episodes/<id>                    # final: 1080p video + reels + thumbnails
python3 engine/build.py episodes/<id> --only reels        # just the reels
```
Outputs in `build/<id>/`:
| File | Use |
|---|---|
| `<id>.mp4` | YouTube long-form (1920×1080, 30 fps, −14 LUFS) |
| `<id>-reel*.mp4` | Reels / Shorts (1080×1920, burned-in captions) |
| `<id>.bn.srt` | Upload as Bangla subtitles on YouTube |
| `chapters.txt` | Paste into the YouTube description |
| `thumbnail-*-16x9.png` | YouTube thumbnail (1280×720) |
| `thumbnail-*-9x16.png` | Reel cover |

## 5. Upload checklist (YouTube: @AhnafAkif-h2k)
- [ ] Title from `episodes/<id>/youtube.md` (Bangla title, with an English keyword after the "|" for search)
- [ ] Description: summary, chapters (from `chapters.txt`), sources list, hashtags
- [ ] Thumbnail: try both versions as an A/B "Test & Compare" in YouTube Studio
- [ ] Subtitles: upload `<id>.bn.srt` as Bengali
- [ ] Language: Bengali; category: Education
- [ ] End screen: subscribe + the previous episode
- [ ] Publish the long video first. Post Reels/Shorts over the next 3–5 days, each pointing to the full video (YouTube Shorts → "Related video" link).

### Cadence that works for explainer channels
- 1 long video every 2 weeks (quality beats frequency)
- 2–3 reels per long video, posted between long videos
- Always keep one script ahead.

## Scene reference
| `type` | Purpose | Key `data` fields |
|---|---|---|
| `kinetic` | Words rising in, highlighter sweeps | `lines[]`, `at[]` (fractions of the scene or seconds), `size` xl/l/m/s, `align`, `kicker`, `dark` |
| `tag` | Clothing-label hero shot | `l1`, `l2`, `l3`, `caption`, `captionAt` |
| `bignum` | Count-up number | `value`, `decimals`, `prefix`, `suffix`, `label`, `kicker`, `color` |
| `grid` | 10×10 share grid | `value` (0–100), `label`, `rest`, `color` |
| `people` | Person pictogram | `total`, `perRow`, `title`, `groups[{count,color,label,at}]` |
| `map` | Animated map | `camera[{at,center,span,len}]`, `rotate`, `fills{iso:color}`, `labels[]`, `arrows[]`, `pulses[]` |
| `line` | Self-drawing line chart | `points[[x,y]]`, `xTicks`, `yTicks`, `annotations[]`, `drawAt`, `drawLen` |
| `bars` | Growing bar chart | `bars[{label,value,hi}]`, `unit` |
| `timeline` | Dated events | `events[{year,text,at,hi}]` |
| `flow` | Process diagram | `nodes[{id,label,sub,x,y,px,py,style}]`, `edges[{from,to}]` |
| `doc` | Document / report card | `kicker`, `title`, `body`, `cite`, `rotate` |
| `chapter` | Chapter card | `num`, `title` |
| `title` | Episode title card | `title`, `sub` |
| `memorial` | Solemn count (dark) | `date`, `value`, `label` |
| `end` | End card | `text`, `cta` |
| `thumb` | Thumbnail layout | `lines[]`, `l1..l3`, `badge`, `bg` |

Inline markup inside any text: `==highlight==`, `__red underline__`, `**red text**`, `~~strike~~`, `[[green text]]`.
Map country codes are ISO 3166 numeric (`"050"` Bangladesh, `"356"` India, `"156"` China, `"840"` USA…).
