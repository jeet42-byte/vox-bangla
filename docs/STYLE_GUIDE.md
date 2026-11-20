# স্টাইল গাইড: বাংলা ভিজ্যুয়াল এক্সপ্লেইনার

This guide breaks down how the big English-language "explainer journalism" channels build their videos (Vox is the reference point). It then turns that into rules for a Bangla channel with its **own identity**.

> **Rule zero:** copy the *grammar*, never the *assets*. Don't use another channel's name, logo, music, footage, fonts or on-screen branding. Do use the storytelling structure and visual techniques: anyone may use those. This keeps the channel safe from copyright claims and impersonation strikes, and it gives the channel its own face.

Our identity: **ব্যাখ্যা** (Byakkha, "explained"). Colors come from the Bangladesh flag (red `#E2382B`, green `#00694B`) on warm newsprint paper `#F1ECE2`, plus a yellow highlighter `#FFD21F`.

---

## 1. Story architecture (the part that matters most)

Every episode answers **one question**. Write the question in a single Bangla sentence before writing anything else.

| Beat | Time (8–10 min video) | What happens | Ep01 example |
|---|---|---|---|
| **Cold open / hook** | 0:00–0:40 | A concrete, physical, personal image. "Look at the label on your shirt." Never start with history or definitions. | The "MADE IN BANGLADESH" tag |
| **The surprising fact** | 0:40–1:10 | One number that makes the hook matter. | 2nd largest exporter; 81% of exports |
| **The tension** | 1:10–1:30 | Why the fact is strange. "50 years ago, there were almost none." | |
| **The promise** | 1:30–1:45 | Name the 2–3 ingredients the video will explain. "A quota. A Korean company. And 130 people." | |
| **Title card** | ~1:45 | Only now the title appears. | |
| **Chapters 1–3: mechanism** | middle | *How* it works, one idea per chapter, each with a diagram or map. | Quota wall → 130 trainees → back-to-back L/C |
| **The complication** | ~70% | The cost or the counter-argument. Explainers earn trust by not being cheerleaders. | Tazreen, Rana Plaza, wages |
| **The stakes now** | ~85% | Why this matters *this year*. | LDC graduation, Nov 2026 → 2029 |
| **Callback ending** | last 30 s | Return to the opening image with new meaning. | The tag again: "not just a name — a story" |

### Script rules
- **One idea per sentence. One sentence per visual beat.** If a sentence needs two visuals, split it.
- Write *spoken* Bangla (চলিত ভাষা), not textbook Bangla. Read every line aloud.
- Numbers on screen as digits (৮১%), numbers in narration as words ("একাশি শতাংশ"). The TTS normalizer converts automatically, but a human narrator should read the words.
- Never say "এই ভিডিওতে আমরা দেখব..." ("in this video we will see"). Show it.
- Every claim needs a source in `episode.json` (`source` / `cite`) **and** in the description.
- Tough subjects such as deaths, disasters or violence get the `memorial` treatment: dark screen, no music bed (`mood: dark`), no highlighter, no jokes.

---

## 2. Visual grammar

| Element | Explainer convention | Our engine scene |
|---|---|---|
| Paper background | Off-white textured paper, film grain, soft vignette. Nothing is ever pure white or flat. | Global (`paper.jpg`, `grain.png`) |
| Kinetic type | Bold sans words rising in one by one, synced to narration, with the key phrase **highlighted with a yellow marker sweep** | `kinetic` + `==text==` |
| Underline / strike | Red underline for emphasis; red strike for a "wrong" prediction | `__text__`, `~~text~~` |
| Maps | Flat, muted land; one country in accent color; smooth camera zoom from world to region; arrows that *grow* from source to destination | `map` |
| Charts | Built live: axes first, then the line draws itself, then annotations pop in | `line`, `bars` |
| Unit grids / pictograms | "81 out of 100" shown as 100 squares; people as person icons | `grid`, `people` |
| Document cards | Paper card, tape on corners, serif type, phrase highlighted (stands in for a newspaper clipping or report page) | `doc` |
| Diagrams | Boxes with hard drop-shadows, arrows drawn sequentially | `flow` |
| Chapter cards | Big red numeral, rule, chapter title | `chapter` |
| Camera | Nothing is static: a slow 2–4% push-in on every shot | automatic |
| Pacing | A new visual event every 2–4 seconds. Cuts on sentence boundaries. | automatic from narration timing |

### Typography
- **Anek Bangla 800**: headlines, kinetic type, numbers
- **Hind Siliguri 500–600**: labels, captions, body
- **Noto Serif Bengali**: document cards and quotes (the "printed matter" voice)
- Bangla digits everywhere on screen (০-৯); the engine converts automatically.

### Color usage
- Red = the subject / the important thing (Bangladesh on a map, the highlighted bar)
- Green = positive outcome, Bangladesh in "opportunity" moments
- Blue = other actors (buyers, Europe/US)
- Yellow = highlighter only, never a fill color
- Dark scenes (`#121314`) only for tragedy and solemn moments

---

## 3. Sound
- Calm, minimal score: soft keys plus pads. It "drives" (pulse and hats) during data and mechanism sections and drops to "dark" drones for tragedies.
- The music always ducks under the voice (the engine side-chains it automatically).
- Whoosh into chapter cards, a low hit on the title card, small ticks on numbers.
- Master to **−14 LUFS** (YouTube). The engine does this.

---

## 4. Reels / Shorts (9:16)
- **The first 1.5 seconds decide everything.** Open on the most surprising visual or number, never on a logo.
- A yellow headline bar sits at the top for the whole reel (`head`): it is the reel's promise.
- Big burned-in captions, 3–4 words at a time, with the current word in yellow (most people watch muted).
- 30–75 seconds. One idea. End with "পুরো গল্প চ্যানেলে" ("full story on the channel").
- Each long video yields 2–3 reels: one for the core mechanism, one for the most emotional section and one for the most surprising number.

## 5. Thumbnails
- One object, max 3–4 Bangla words, one highlighted word.
- High contrast; readable at phone size (test at 320 px wide).
- No clickbait the video doesn't pay off.
