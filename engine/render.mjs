// Frame-accurate renderer: drives player.html with Playwright and pipes
// screenshots into ffmpeg. Splits the timeline across N parallel workers.
//
//   node engine/render.mjs <timed-episode.json> <out.mp4> [--fps 30] [--workers 4] [--from s] [--to s] [--still t:out.png]
import { createRequire } from "module";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require("/opt/node22/lib/node_modules/playwright"); }

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const [epPath, outPath] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const ep = JSON.parse(fs.readFileSync(epPath, "utf8"));
const fps = Number(opt("fps", ep.fps || 30));
const workers = Number(opt("workers", 4));
const stills = args.filter((a, i) => args[i - 1] === "--still");

const playerUrl = pathToFileURL(path.join(here, "player", "player.html")).href;

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: ep.width, height: ep.height }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("[page]", e.message));
  await page.goto(playerUrl);
  await page.evaluate(async (e) => { window.ENGINE.LOAD(e); await document.fonts.ready; }, ep);
  // warm fonts: render one frame per scene so every glyph is loaded
  await page.evaluate(async (e) => { for (const s of e.scenes) window.ENGINE.SEEK(s.start + Math.min(1.5, s.dur / 2)); await document.fonts.ready; }, ep);
  return page;
}

async function renderRange(browser, f0, f1, segPath, idx) {
  const page = await openPage(browser);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", opt("preset", "medium"), "-crf", opt("crf", "17"), "-pix_fmt", "yuv420p", "-r", String(fps), segPath], { stdio: ["pipe", "inherit", "inherit"] });
  const t0 = Date.now();
  for (let f = f0; f < f1; f++) {
    await page.evaluate(([t, fr]) => window.ENGINE.SEEK(t, fr), [f / fps, f]);
    const buf = await page.screenshot({ type: "jpeg", quality: 94 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if ((f - f0) % 300 === 0) console.log(`  [w${idx}] ${f - f0}/${f1 - f0} frames (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on("close", (c) => (c === 0 ? r() : j(new Error("ffmpeg exit " + c)))));
  await page.close();
}

const browser = await playwright.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  if (stills.length) {
    const page = await openPage(browser);
    for (const st of stills) {
      const [t, out] = st.split(":");
      await page.evaluate(([tt]) => window.ENGINE.SEEK(tt, 1), [Number(t)]);
      await page.screenshot({ path: out, type: out.endsWith(".png") ? "png" : "jpeg" });
      console.log("still", t, "->", out);
    }
  } else {
    const total = ep.scenes.reduce((m, s) => Math.max(m, s.start + s.dur), 0);
    const from = Number(opt("from", 0)), to = Math.min(total, Number(opt("to", total)));
    const F0 = Math.round(from * fps), F1 = Math.round(to * fps);
    const n = Math.max(1, Math.min(workers, Math.ceil((F1 - F0) / 60)));
    const chunk = Math.ceil((F1 - F0) / n);
    const tmp = outPath + ".parts";
    fs.mkdirSync(tmp, { recursive: true });
    console.log(`render ${F1 - F0} frames @${fps}fps, ${ep.width}x${ep.height}, ${n} workers`);
    const segs = [];
    const jobs = [];
    for (let i = 0; i < n; i++) {
      const a = F0 + i * chunk, b = Math.min(F1, a + chunk);
      if (a >= b) break;
      const seg = path.join(tmp, `seg${String(i).padStart(3, "0")}.mp4`);
      segs.push(seg);
      jobs.push(renderRange(browser, a, b, seg, i));
    }
    await Promise.all(jobs);
    const list = path.join(tmp, "list.txt");
    fs.writeFileSync(list, segs.map((s) => `file '${path.resolve(s)}'`).join("\n"));
    await new Promise((r, j) => spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", outPath], { stdio: "inherit" })
      .on("close", (c) => (c === 0 ? r() : j(new Error("concat failed")))));
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("video ->", outPath);
  }
} finally {
  await browser.close();
}
