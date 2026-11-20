/* ব্যাখ্যা scene engine.
 * Every scene is a pure function of time: build(root, data, ctx) returns
 * update(t, dur), where t is seconds since the scene started. Nothing is
 * animated with CSS transitions, so any frame can be rendered in any order
 * (this is what lets the renderer split the video across parallel workers).
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------- helpers
  const BN = "০১২৩৪৫৬৭৮৯";
  const bn = (s) => String(s).replace(/[0-9]/g, (d) => BN[d]);
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  const E = {
    linear: (x) => x,
    out: (x) => 1 - Math.pow(1 - x, 3),
    inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    back: (x) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    expo: (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  };
  // progress of t through [a, a+len], eased
  const P = (t, a, len, ease = "out") => E[ease](clamp((t - a) / Math.max(1e-6, len)));
  const fmt = (v, dec = 0, group = true) => {
    let s = Number(v).toFixed(dec);
    if (group) {
      const [i, f] = s.split(".");
      s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
    }
    return bn(s);
  };
  const h = (tag, cls, html) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  };
  const NS = "http://www.w3.org/2000/svg";
  const s = (tag, attrs = {}) => {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  };
  const at = (v, dur, fallback) => (v == null ? fallback : v <= 1.0001 && v >= 0 && !Number.isInteger(v) ? v * dur : v);
  // `at` values: a fraction 0..1 (e.g. 0.35) means "share of the scene",
  // anything else (1, 2.5, 4) means seconds. Integers 0/1 are seconds.
  const T = (v, dur, fb) => (typeof v === "string" && v.endsWith("%") ? (parseFloat(v) / 100) * dur : at(v, dur, fb));

  // Inline markup → spans.  ==highlight==  __red underline__  **red**  ~~strike~~  [[green]]
  function markup(str) {
    const tokens = [];
    const re = /(==(.+?)==|__(.+?)__|\*\*(.+?)\*\*|~~(.+?)~~|\[\[(.+?)\]\])/g;
    let last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) tokens.push({ text: str.slice(last, m.index), cls: "" });
      if (m[2] != null) tokens.push({ text: m[2], cls: "hl" });
      else if (m[3] != null) tokens.push({ text: m[3], cls: "ul" });
      else if (m[4] != null) tokens.push({ text: m[4], cls: "red" });
      else if (m[5] != null) tokens.push({ text: m[5], cls: "strike" });
      else if (m[6] != null) tokens.push({ text: m[6], cls: "green" });
      last = re.lastIndex;
    }
    if (last < str.length) tokens.push({ text: str.slice(last), cls: "" });
    return tokens;
  }

  // Build a line of words; returns {el, words:[span], marks:[{el,kind}]}
  function wordLine(str, cls = "line") {
    const el = h("span", cls);
    const words = [], marks = [];
    for (const tok of markup(str)) {
      const parts = tok.text.split(/(\s+)/).filter((x) => x.length);
      let holder = el;
      if (tok.cls) {
        holder = h("span", tok.cls);
        el.appendChild(holder);
        marks.push({ el: holder, kind: tok.cls });
      }
      for (const p of parts) {
        if (/^\s+$/.test(p)) { holder.appendChild(document.createTextNode(" ")); continue; }
        const w = h("span", "w", p);
        holder.appendChild(w);
        words.push(w);
      }
    }
    return { el, words, marks };
  }

  function animWords(words, t, start, stagger = 0.055, len = 0.42) {
    words.forEach((w, i) => {
      const p = P(t, start + i * stagger, len, "out");
      w.style.opacity = p;
      w.style.transform = `translateY(${(1 - p) * 0.35}em)`;
    });
  }
  function animMarks(marks, t, start, len = 0.55) {
    marks.forEach((m, i) => {
      const p = P(t, start + i * 0.35, len, "inOut");
      if (m.kind === "hl") m.el.style.backgroundSize = `${p * 100}% 78%`;
      else if (m.kind === "ul") m.el.style.backgroundSize = `${p * 100}% .09em`;
      else if (m.kind === "strike") m.el.style.setProperty("--sw", `${p * 104}%`);
    });
  }
  const sourceEl = (root, text) => { if (text) root.appendChild(h("div", "source", "সূত্র: " + text)); };

  // camera drift for flat scenes (slow push-in, Vox-style "alive" stills)
  function drift(cam, t, dur, amt = 0.035, dir = 1) {
    const p = clamp(t / Math.max(dur, 0.1));
    cam.style.transform = `scale(${1 + amt * p}) translate(${dir * p * 0.6}%, 0)`;
  }

  const S = {}; // scene registry

  // ------------------------------------------------------------- kinetic text
  // data: {kicker, lines:[str], at:[t], size:'xl'|'l'|'m'|'s', align:'left'|'center', source, dark}
  S.kinetic = (root, d, ctx) => {
    const cam = h("div", "cam"); root.appendChild(cam);
    const safe = h("div", "safe"); cam.appendChild(safe);
    const box = h("div", `kin display ${d.align || "left"} size-${d.size || "l"}`); safe.appendChild(box);
    let kick = null;
    if (d.kicker) { kick = h("div", "kicker", d.kicker); box.appendChild(kick); }
    const lines = (d.lines || []).map((l) => { const L = wordLine(l); box.appendChild(L.el); return L; });
    if (d.dark) root.classList.add("dark");
    sourceEl(root, d.source);
    return (t, dur) => {
      drift(cam, t, dur, 0.025);
      if (kick) { const p = P(t, 0.05, 0.4); kick.style.opacity = p; }
      lines.forEach((L, i) => {
        const st = T(d.at && d.at[i], dur, 0.15 + i * 0.75);
        animWords(L.words, t, st);
        animMarks(L.marks, t, st + 0.25 + L.words.length * 0.055);
      });
    };
  };

  // ------------------------------------------------------------ clothing tag
  S.tag = (root, d) => {
    const cam = h("div", "cam"); root.appendChild(cam);
    cam.appendChild(h("div", "fabric"));
    const tag = h("div", "tag");
    tag.innerHTML = `<div class="t1">${d.l1 || "MADE IN"}</div><div class="t2">${d.l2 || "BANGLADESH"}</div>` +
      `<div class="t3">${d.l3 || "100% COTTON · RN 00000"}</div><div class="care"><span></span><span></span><span></span></div>`;
    cam.appendChild(tag);
    let chip = null;
    if (d.caption) { chip = h("div", "caption-chip", d.caption); root.appendChild(chip); }
    return (t, dur) => {
      const p = clamp(t / dur);
      cam.style.transform = `scale(${lerp(1.0, 1.22, E.inOut(p))}) rotate(${lerp(-3, -1, p)}deg)`;
      const a = P(t, 0, 0.6);
      tag.style.opacity = a;
      if (chip) { const c = P(t, T(d.captionAt, dur, 1.2), 0.4); chip.style.opacity = c; chip.style.transform = `translateX(-50%) translateY(${(1 - c) * 20}px)`; }
    };
  };

  // -------------------------------------------------------------- big number
  // data: {value, decimals, prefix, suffix, label, kicker, source, color, dark}
  S.bignum = (root, d) => {
    const cam = h("div", "cam"); root.appendChild(cam);
    const safe = h("div", "safe"); cam.appendChild(safe);
    const box = h("div", "bignum"); safe.appendChild(box);
    if (d.dark) root.classList.add("dark");
    let kick = null;
    if (d.kicker) { kick = h("div", "kicker", d.kicker); box.appendChild(kick); kick.style.marginBottom = "calc(var(--u)*2)"; }
    const num = h("div", "num"); box.appendChild(num);
    if (d.color) num.style.color = `var(--${d.color})`;
    const lab = wordLine(d.label || "", "lab display"); box.appendChild(lab.el);
    sourceEl(root, d.source);
    return (t, dur) => {
      drift(cam, t, dur, 0.03);
      const p = P(t, 0.1, d.countLen || 1.4, "expo");
      num.textContent = (d.prefix || "") + fmt((d.from || 0) + (d.value - (d.from || 0)) * p, d.decimals || 0, d.group !== false) + (d.suffix || "");
      num.style.opacity = P(t, 0.05, 0.25);
      if (kick) kick.style.opacity = P(t, 0, 0.3);
      animWords(lab.words, t, 0.7);
      animMarks(lab.marks, t, 1.4);
    };
  };

  // -------------------------------------------------- 10x10 unit grid (share)
  // data: {value (0-100), label, title, color, source}
  S.grid = (root, d, ctx) => {
    const cam = h("div", "cam"); root.appendChild(cam);
    const portrait = ctx.portrait;
    const g = h("div", "grid100"); cam.appendChild(g);
    const sz = portrait ? 74 : 44; // in u
    Object.assign(g.style, portrait
      ? { left: "50%", top: "13%", width: `calc(var(--u)*${sz})`, transform: "translateX(-50%)" }
      : { left: "8%", top: "50%", width: `calc(var(--u)*${sz})`, transform: "translateY(-50%)" });
    const cells = [];
    for (let i = 0; i < 100; i++) { const c = h("i"); g.appendChild(c); cells.push(c); }
    const lg = h("div", "legend"); cam.appendChild(lg);
    Object.assign(lg.style, portrait ? { left: "8%", right: "8%", top: "52%" } : { left: "54%", right: "6%", top: "50%", transform: "translateY(-50%)" });
    const big = h("div", "big", ""); lg.appendChild(big);
    big.style.color = `var(--${d.color || "red"})`;
    const t1 = wordLine(d.label || "", "line"); t1.el.style.cssText = "display:block;font-size:calc(var(--u)*4.6);line-height:1.25;margin-top:calc(var(--u)*1.5)"; lg.appendChild(t1.el);
    let t2 = null;
    if (d.rest) { t2 = wordLine(d.rest, "line"); t2.el.style.cssText = "display:block;font-size:calc(var(--u)*3);color:var(--ink-3);margin-top:calc(var(--u)*2.4);font-weight:600"; lg.appendChild(t2.el); }
    sourceEl(root, d.source);
    const col = getComputedStyle(document.documentElement).getPropertyValue(`--${d.color || "red"}`);
    return (t, dur) => {
      drift(cam, t, dur, 0.02);
      const fillP = P(t, 0.4, 1.8, "inOut");
      const n = Math.round(d.value * fillP);
      cells.forEach((c, i) => {
        const appear = P(t, i * 0.006, 0.25);
        c.style.opacity = appear;
        c.style.background = i < n ? col : "";
        c.style.transform = i < n && i >= n - 3 ? "scale(1.08)" : "";
      });
      big.textContent = fmt(n) + "%";
      big.style.opacity = P(t, 0.3, 0.3);
      animWords(t1.words, t, 0.6);
      animMarks(t1.marks, t, 2.0);
      if (t2) animWords(t2.words, t, T(d.restAt, dur, 2.4));
    };
  };

  // ------------------------------------------------------------ people dots
  // data: {total, perRow, groups:[{count,color,label}], title, source}
  const PERSON = '<svg viewBox="0 0 20 32"><circle cx="10" cy="6" r="5.2"/><path d="M2 31 L2 18 Q2 12 10 12 Q18 12 18 18 L18 31 Z"/></svg>';
  S.people = (root, d, ctx) => {
    const cam = h("div", "cam"); root.appendChild(cam);
    const total = d.total || 50, per = ctx.portrait ? Math.min(d.perRow || 10, 13) : d.perRow || 25;
    const box = h("div", "people"); cam.appendChild(box);
    box.style.gridTemplateColumns = `repeat(${per}, 1fr)`;
    Object.assign(box.style, ctx.portrait ? { left: "50%", width: `calc(var(--u)*${Math.min(84, per * 4.5)})`, transform: "translateX(-50%)", top: "21%" } : { left: "8%", right: "8%", top: "36%" });
    const figs = [];
    for (let i = 0; i < total; i++) { const f = h("div", "", PERSON); f.querySelector("svg").style.fill = "#CFC6B5"; box.appendChild(f); figs.push(f); }
    const title = wordLine(d.title || "", "line display");
    title.el.style.cssText = `position:absolute;left:8%;right:8%;top:${ctx.portrait ? 13 : 12}%;font-size:calc(var(--u)*5.4);line-height:1.2`;
    cam.appendChild(title.el);
    const legend = h("div", "legend");
    Object.assign(legend.style, ctx.portrait ? { left: "8%", top: "61%" } : { left: "8%", bottom: "12%" });
    legend.style.display = "flex"; legend.style.gap = "calc(var(--u)*4)"; legend.style.flexWrap = "wrap";
    cam.appendChild(legend);
    const groups = (d.groups || []).map((g) => {
      const r = h("div", "row", `<span class="sw" style="background:var(--${g.color})"></span><span>${g.label}</span>`);
      legend.appendChild(r);
      return { ...g, el: r };
    });
    sourceEl(root, d.source);
    const col = (c) => getComputedStyle(document.documentElement).getPropertyValue(`--${c}`);
    return (t, dur) => {
      drift(cam, t, dur, 0.02);
      animWords(title.words, t, 0.1);
      animMarks(title.marks, t, 0.9);
      figs.forEach((f, i) => { const p = P(t, 0.3 + i * (1.2 / total), 0.3); f.style.opacity = p; f.style.transform = `translateY(${(1 - p) * 10}px)`; });
      let idx = 0;
      groups.forEach((g, gi) => {
        const st = T(g.at, dur, 1.6 + gi * 1.2);
        const n = Math.round(g.count * P(t, st, 1.0, "inOut"));
        for (let k = 0; k < g.count && idx < total; k++, idx++) figs[idx].querySelector("svg").style.fill = k < n ? col(g.color) : "#CFC6B5";
        g.el.style.opacity = P(t, st, 0.4);
      });
    };
  };

  // --------------------------------------------------------------------- map
  // data: {
  //   camera: [{at, center:[lon,lat], span}],   span = degrees of longitude across the short side
  //   fills: {"050": "red", "*": "dim"},   country ids are ISO-3166 numeric strings
  //   fillAt: {"050": 1.2},
  //   labels: [{at, ll:[lon,lat], text, kind:'country'|'big'|'city'|'tagbox'|'water'}],
  //   arrows: [{at, from:[lon,lat], to:[lon,lat], color, bend, len, width}],
  //   pulses: [{at, ll}]
  // }
  let WORLD = null;
  function world() {
    if (!WORLD) WORLD = topojson.feature(window.__TOPO, window.__TOPO.objects.countries).features.filter((f) => f.id !== "010");
    return WORLD;
  }
  S.map = (root, d, ctx) => {
    const W = ctx.W, H = ctx.H, minD = Math.min(W, H);
    const R = 1000;
    const proj = d3.geoMercator().scale(R).translate([0, 0]).rotate([-(d.rotate || 0), 0]).precision(0.1);
    const path = d3.geoPath(proj);
    const wrap = h("div", "mapwrap"); root.appendChild(wrap);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}` }); wrap.appendChild(svg);
    const g = s("g"); svg.appendChild(g);
    const fills = d.fills || {};
    const defFill = fills["*"] || "land";
    const countryEls = {};
    for (const f of world()) {
      const p = s("path", { d: path(f), class: "land" });
      const c = fills[f.id] || defFill;
      if (c === "dim") p.classList.add("dim");
      countryEls[f.id] = { el: p, color: c };
      g.appendChild(p);
    }
    const over = s("svg", { viewBox: `0 0 ${W} ${H}` });
    over.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    wrap.appendChild(over);
    const labels = (d.labels || []).map((L) => { const el = h("div", `maplabel ${L.kind || "country"}`, L.text); wrap.appendChild(el); return { ...L, el }; });
    const arrows = (d.arrows || []).map((A) => {
      const col = `var(--${A.color || "red"})`;
      const pth = s("path", { fill: "none", stroke: col, "stroke-width": (A.width || 0.55) * minD / 100, "stroke-linecap": "round" });
      const head = s("path", { fill: col });
      over.appendChild(pth); over.appendChild(head);
      return { ...A, pth, head };
    });
    const pulses = (d.pulses || []).map((Pl) => { const c = s("circle", { fill: "none", stroke: `var(--${Pl.color || "red"})`, "stroke-width": 4 }); over.appendChild(c); return { ...Pl, c }; });
    sourceEl(root, d.source);
    const cams = (d.camera || [{ at: 0, center: [90.3, 23.7], span: 30 }]).map((c) => ({ ...c }));
    const css = getComputedStyle(document.documentElement);
    const colorOf = (c) => css.getPropertyValue(`--${c}`).trim() || c;

    function camAt(t, dur) {
      const ts = cams.map((c) => T(c.at, dur, 0));
      if (t <= ts[0] || cams.length === 1) return cams[0];
      for (let i = 1; i < cams.length; i++) {
        const st = ts[i], len = cams[i].len || 1.6;
        if (t < st) return cams[i - 1];
        if (t < st + len) {
          const p = E.inOut((t - st) / len), a = cams[i - 1], b = cams[i];
          // zoom in log space so wide→narrow moves feel even
          return { center: [lerp(a.center[0], b.center[0], p), lerp(a.center[1], b.center[1], p)], span: Math.exp(lerp(Math.log(a.span), Math.log(b.span), p)) };
        }
      }
      return cams[cams.length - 1];
    }
    return (t, dur) => {
      const c = camAt(t, dur);
      const drift = 1 + 0.03 * clamp(t / dur);
      const k = (minD / ((c.span / drift) * Math.PI / 180 * R));
      const pc = proj(c.center);
      g.setAttribute("transform", `translate(${W / 2},${H / 2}) scale(${k}) translate(${-pc[0]},${-pc[1]})`);
      const scr = (ll) => { const p = proj(ll); return [(p[0] - pc[0]) * k + W / 2, (p[1] - pc[1]) * k + H / 2]; };
      for (const id in countryEls) {
        const ce = countryEls[id];
        if (ce.color !== "land" && ce.color !== "dim") {
          const p = P(t, T(d.fillAt && d.fillAt[id], dur, 0.3), 0.6);
          const base = ce.color === "dim" ? colorOf("land-dim") : colorOf("land");
          ce.el.style.fill = p >= 1 ? colorOf(ce.color) : mix(base, colorOf(ce.color), p);
        }
      }
      for (const L of labels) {
        const [x, y] = scr(L.ll);
        const p = P(t, T(L.at, dur, 0.6), 0.45);
        L.el.style.left = x + "px"; L.el.style.top = y + "px";
        L.el.style.opacity = L.until != null && t > T(L.until, dur) ? 1 - P(t, T(L.until, dur), 0.3) : p;
      }
      for (const A of arrows) {
        const a = scr(A.from), b = scr(A.to);
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
        const bend = A.bend == null ? 0.22 : A.bend;
        const cx = (a[0] + b[0]) / 2 - dy * bend, cy = (a[1] + b[1]) / 2 + dx * bend;
        const p = P(t, T(A.at, dur, 0.8), A.len || 1.4, "inOut");
        // partial quadratic bezier (de Casteljau) so the arrow grows from its source
        const q = (u) => [(1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * cx + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * cy + u * u * b[1]];
        if (p <= 0) { A.pth.setAttribute("d", ""); A.head.setAttribute("d", ""); continue; }
        const fade = A.until != null ? 1 - P(t, T(A.until, dur), 0.4) : 1;
        A.pth.style.opacity = fade; A.head.style.opacity = fade;
        const m1 = [lerp(a[0], cx, p), lerp(a[1], cy, p)];
        const e = q(p);
        A.pth.setAttribute("d", `M${a[0]},${a[1]} Q${m1[0]},${m1[1]} ${e[0]},${e[1]}`);
        const e0 = q(Math.max(0, p - 0.02));
        const ang = Math.atan2(e[1] - e0[1], e[0] - e0[0]);
        const hs = (A.width || 0.55) * minD / 100 * 3.2;
        const p1 = [e[0] + Math.cos(ang) * hs * 0.6, e[1] + Math.sin(ang) * hs * 0.6];
        const p2 = [e[0] + Math.cos(ang + 2.5) * hs, e[1] + Math.sin(ang + 2.5) * hs];
        const p3 = [e[0] + Math.cos(ang - 2.5) * hs, e[1] + Math.sin(ang - 2.5) * hs];
        A.head.setAttribute("d", `M${p1}L${p2}L${p3}Z`);
        void L;
      }
      for (const Pl of pulses) {
        const st = T(Pl.at, dur, 0.5);
        const [x, y] = scr(Pl.ll);
        const ph = t < st ? -1 : ((t - st) % 1.6) / 1.6;
        Pl.c.setAttribute("cx", x); Pl.c.setAttribute("cy", y);
        Pl.c.setAttribute("r", ph < 0 ? 0 : 6 + ph * minD * 0.06);
        Pl.c.setAttribute("opacity", ph < 0 ? 0 : 1 - ph);
      }
    };
  };
  function mix(a, b, p) {
    const pa = hex(a), pb = hex(b);
    return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i], p))).join(",")})`;
  }
  function hex(c) { c = c.replace("#", ""); return [0, 2, 4].map((i) => parseInt(c.substr(i, 2), 16)); }

  // ---------------------------------------------------------------- line chart
  // data: {title, sub, points:[[x,y]], xTicks:[x], yTicks:[y], yFmt:{prefix,suffix,dec},
  //        annotations:[{x, text, at, hl}], drawAt, drawLen, source, color}
  S.line = (root, d, ctx) => {
    const W = ctx.W, H = ctx.H, u = ctx.u;
    const cam = h("div", "cam"); root.appendChild(cam);
    const box = h("div", "chart"); cam.appendChild(box);
    const pad = ctx.portrait ? { l: 0.08, r: 0.08, t: 0.09, b: 0.30 } : { l: 0.065, r: 0.065, t: 0.07, b: 0.08 };
    Object.assign(box.style, { left: pad.l * 100 + "%", right: pad.r * 100 + "%", top: pad.t * 100 + "%", bottom: pad.b * 100 + "%" });
    const tt = wordLine(d.title || "", "title"); box.appendChild(tt.el); tt.el.style.display = "block";
    if (d.sub) box.appendChild(h("div", "sub", d.sub));
    const bw = W * (1 - pad.l - pad.r), bh = H * (1 - pad.t - pad.b);
    const top = (ctx.portrait ? 18 : 15) * u, left = 7 * u, bottom = 6 * u, right = 10 * u;
    const pw = bw - left - right, ph = bh - top - bottom;
    const svg = s("svg", { width: bw, height: bh }); svg.style.left = 0; svg.style.top = 0; box.appendChild(svg);
    const xs = d.points.map((p) => p[0]), ys = d.points.map((p) => p[1]);
    const x0 = d.xMin ?? Math.min(...xs), x1 = d.xMax ?? Math.max(...xs);
    const y0 = d.yMin ?? 0, y1 = d.yMax ?? Math.max(...ys) * 1.1;
    const X = (x) => left + ((x - x0) / (x1 - x0)) * pw, Y = (y) => top + ph - ((y - y0) / (y1 - y0)) * ph;
    const yf = d.yFmt || {};
    const fy = (v) => (yf.prefix || "") + fmt(v, yf.dec || 0) + (yf.suffix || "");
    const gAxis = s("g", { class: "axis" }); svg.appendChild(gAxis);
    const gridEls = [];
    for (const yt of d.yTicks || []) {
      const ln = s("line", { x1: left, x2: left + pw, y1: Y(yt), y2: Y(yt), class: "gridline" }); gAxis.appendChild(ln);
      const tx = s("text", { x: left - 1.2 * u, y: Y(yt) + 1.0 * u, "text-anchor": "end", "font-size": 2.6 * u }); tx.textContent = fy(yt); gAxis.appendChild(tx);
      gridEls.push(ln, tx);
    }
    for (const xt of d.xTicks || []) {
      const tx = s("text", { x: X(xt), y: top + ph + 4.4 * u, "text-anchor": "middle", "font-size": 2.6 * u }); tx.textContent = bn(d.xLabel ? d.xLabel(xt) : xt); gAxis.appendChild(tx); gridEls.push(tx);
    }
    const base = s("line", { x1: left, x2: left + pw, y1: Y(y0), y2: Y(y0), class: "baseline" }); svg.appendChild(base);
    const col = `var(--${d.color || "red"})`;
    const area = s("path", { fill: col, opacity: 0.1 }); svg.appendChild(area);
    const line = s("path", { fill: "none", stroke: col, "stroke-width": 0.75 * u, "stroke-linejoin": "round", "stroke-linecap": "round" }); svg.appendChild(line);
    const dot = s("circle", { r: 1.3 * u, fill: col, stroke: "#fff", "stroke-width": 0.4 * u }); svg.appendChild(dot);
    const val = h("div", "annot hlbox"); box.appendChild(val); val.style.fontSize = `calc(var(--u)*3.4)`;
    const anns = (d.annotations || []).map((A) => {
      const el = h("div", "annot" + (A.hl ? " hlbox" : ""), A.text); box.appendChild(el);
      const tick = s("line", { stroke: "var(--ink)", "stroke-width": 2, "stroke-dasharray": "3 4" }); svg.appendChild(tick);
      return { ...A, el, tick };
    });
    sourceEl(root, d.source);
    const pts = d.points;
    function upto(xv) {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        if (pts[i][0] <= xv) out.push(pts[i]);
        else { const a = pts[i - 1]; if (a) { const f = (xv - a[0]) / (pts[i][0] - a[0]); out.push([xv, lerp(a[1], pts[i][1], f)]); } break; }
      }
      return out;
    }
    return (t, dur) => {
      drift(cam, t, dur, 0.015);
      animWords(tt.words, t, 0.05);
      animMarks(tt.marks, t, 0.8);
      gridEls.forEach((e, i) => e.style.opacity = P(t, 0.2 + i * 0.03, 0.3));
      const st = T(d.drawAt, dur, 0.8), len = T(d.drawLen, dur, Math.max(2.5, dur * 0.55));
      const pr = P(t, st, len, d.ease || "inOut");
      const xv = x0 + (x1 - x0) * pr;
      const seg = pr <= 0 ? [] : upto(xv);
      if (seg.length > 1) {
        const dd = seg.map((p, i) => (i ? "L" : "M") + X(p[0]) + "," + Y(p[1])).join("");
        line.setAttribute("d", dd);
        area.setAttribute("d", dd + `L${X(seg[seg.length - 1][0])},${Y(y0)}L${X(seg[0][0])},${Y(y0)}Z`);
        const last = seg[seg.length - 1];
        dot.setAttribute("cx", X(last[0])); dot.setAttribute("cy", Y(last[1])); dot.style.opacity = 1;
        val.textContent = (yf.prefix || "") + fmt(last[1], d.valDec ?? (yf.dec || 0)) + (yf.suffix || ""); val.style.opacity = 1;
        val.style.left = X(last[0]) + 1.6 * u + "px"; val.style.top = Y(last[1]) - 6.4 * u + "px";
      } else { line.setAttribute("d", ""); area.setAttribute("d", ""); dot.style.opacity = 0; val.style.opacity = 0; }
      for (const A of anns) {
        const yv = upto(A.x).slice(-1)[0];
        const show = P(t, T(A.at, dur, st + ((A.x - x0) / (x1 - x0)) * len), 0.35);
        if (!yv) { A.el.style.opacity = 0; continue; }
        const ax = X(A.x), ay = Y(yv[1]);
        const ty = A.y != null ? top + A.y * ph : ay - 14 * u;
        A.tick.setAttribute("x1", ax); A.tick.setAttribute("x2", ax); A.tick.setAttribute("y1", ty + 3 * u); A.tick.setAttribute("y2", ay);
        A.tick.style.opacity = show;
        A.el.style.opacity = show;
        A.el.style.left = ax + "px"; A.el.style.top = ty + "px";
        A.el.style.transform = `translate(${A.anchor === "right" ? "-100%" : A.anchor === "left" ? "0" : "-50%"}, -50%)`;
      }
    };
  };

  // --------------------------------------------------------------- bar chart
  // data: {title, sub, bars:[{label, value, hi}], unit:{prefix,suffix,dec}, source}
  S.bars = (root, d, ctx) => {
    const cam = h("div", "cam"); root.appendChild(cam);
    const safe = h("div", "safe"); cam.appendChild(safe);
    const box = h("div", "chart"); box.style.inset = "0"; safe.appendChild(box);
    const tt = wordLine(d.title || "", "title"); tt.el.style.display = "block"; box.appendChild(tt.el);
    if (d.sub) box.appendChild(h("div", "sub", d.sub));
    const area = h("div", "bars"); Object.assign(area.style, { left: 0, right: "6%", top: ctx.portrait ? "26%" : "24%", bottom: "6%" }); box.appendChild(area);
    const n = d.bars.length, max = d.max || Math.max(...d.bars.map((b) => b.value));
    const U = d.unit || {};
    const rows = d.bars.map((b, i) => {
      const r = h("div", "bar-row" + (b.hi ? " hi" : ""));
      r.style.top = (i / n) * 100 + "%"; r.style.height = 100 / n + "%";
      r.innerHTML = `<div class="bl">${b.label}</div><div class="bt"><div class="bf"></div><div class="bv"></div></div>`;
      if (ctx.portrait) r.querySelector(".bl").style.flexBasis = "34%";
      area.appendChild(r);
      return { b, r, bf: r.querySelector(".bf"), bv: r.querySelector(".bv") };
    });
    sourceEl(root, d.source);
    return (t, dur) => {
      drift(cam, t, dur, 0.015);
      animWords(tt.words, t, 0.05);
      animMarks(tt.marks, t, 0.9);
      rows.forEach((R, i) => {
        const st = T(R.b.at, dur, 0.7 + i * 0.25);
        const p = P(t, st, 1.1, "inOut");
        const w = (R.b.value / max) * 82 * p;
        R.r.style.opacity = P(t, st - 0.2, 0.3);
        R.bf.style.width = w + "%";
        R.bv.style.left = w + "%";
        R.bv.textContent = (U.prefix || "") + fmt(R.b.value * p, U.dec || 0) + (U.suffix || "");
      });
    };
  };

  // ---------------------------------------------------------------- timeline
  // data: {title, events:[{year, text, at, hi}], source}
  S.timeline = (root, d, ctx) => {
    const cam = h("div", "cam"); root.appendChild(cam);
    const safe = h("div", "safe"); cam.appendChild(safe);
    const tt = wordLine(d.title || "", "line display"); tt.el.style.cssText = "position:absolute;left:0;right:0;top:0;font-size:calc(var(--u)*5.4)"; safe.appendChild(tt.el);
    const evs = d.events || [];
    const portrait = ctx.portrait;
    const line = h("div", "tl-line"); safe.appendChild(line);
    if (portrait) Object.assign(line.style, { left: "12%", top: "16%", width: "4px", height: "80%", transformOrigin: "50% 0" });
    else Object.assign(line.style, { left: "4%", right: "4%", top: "56%" });
    const items = evs.map((e, i) => {
      const el = h("div", "tl-ev" + (e.hi ? " hi" : ""), `<div class="dot"></div><div class="yr">${bn(e.year)}</div><div class="tx">${e.text || ""}</div>`);
      if (portrait) {
        Object.assign(el.style, { left: "12%", top: 18 + (i / Math.max(1, evs.length - 1)) * 74 + "%" });
        const yr = el.querySelector(".yr"), tx = el.querySelector(".tx");
        Object.assign(yr.style, { left: "calc(var(--u)*4)", bottom: "auto", top: "calc(var(--u)*-3.4)", transform: "none" });
        Object.assign(tx.style, { left: "calc(var(--u)*4)", top: "calc(var(--u)*2)", transform: "none", textAlign: "left", width: "calc(var(--u)*70)" });
      } else Object.assign(el.style, { left: 4 + (evs.length === 1 ? 46 : (i / (evs.length - 1)) * 92) + "%", top: "56%" });
      safe.appendChild(el);
      return { e, el };
    });
    sourceEl(root, d.source);
    return (t, dur) => {
      drift(cam, t, dur, 0.015);
      animWords(tt.words, t, 0.05); animMarks(tt.marks, t, 0.8);
      const lp = P(t, 0.3, 1.0, "inOut");
      line.style.transform = portrait ? `scaleY(${lp})` : `scaleX(${lp})`;
      items.forEach(({ e, el }, i) => {
        const p = P(t, T(e.at, dur, 0.9 + i * ((dur * 0.7) / Math.max(1, evs.length))), 0.45, "back");
        el.style.opacity = clamp(p * 2);
        el.querySelector(".dot").style.transform = `scale(${p})`;
      });
    };
  };

  // -------------------------------------------------------------- flow diagram
  // data: {title, nodes:[{id,label,sub,x,y,at,style}], edges:[{from,to,label,at}], source}
  //  x,y in % of the safe box (landscape); px/py optional for portrait
  S.flow = (root, d, ctx) => {
    const cam = h("div", "cam"); root.appendChild(cam);
    const safe = h("div", "safe"); cam.appendChild(safe);
    const tt = wordLine(d.title || "", "line display"); tt.el.style.cssText = "position:absolute;left:0;right:0;top:0;font-size:calc(var(--u)*5)"; safe.appendChild(tt.el);
    const svg = s("svg"); svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:visible"; safe.appendChild(svg);
    const pos = (n) => (ctx.portrait && n.px != null ? [n.px, n.py] : [n.x, n.y]);
    const nodes = {};
    (d.nodes || []).forEach((n, i) => {
      const el = h("div", "node" + (n.style ? " " + n.style : ""), `<div class="nl">${n.label}</div>${n.sub ? `<div class="ns">${n.sub}</div>` : ""}`);
      const [x, y] = pos(n);
      el.style.left = x + "%"; el.style.top = y + "%";
      safe.appendChild(el);
      nodes[n.id] = { n, el, i };
    });
    const edges = (d.edges || []).map((e) => {
      const p = s("path", { fill: "none", stroke: "var(--ink)", "stroke-width": 4, "stroke-linecap": "round" });
      const hd = s("path", { fill: "var(--ink)" });
      svg.appendChild(p); svg.appendChild(hd);
      let lb = null;
      if (e.label) { lb = h("div", "elabel", e.label); safe.appendChild(lb); }
      return { ...e, p, hd, lb };
    });
    sourceEl(root, d.source);
    let box = null;
    const rect = (el) => {
      const r = el.getBoundingClientRect(), sr = box;
      return { cx: r.left - sr.left + r.width / 2, cy: r.top - sr.top + r.height / 2, w: r.width, h: r.height };
    };
    return (t, dur) => {
      cam.style.transform = "none";
      box = safe.getBoundingClientRect();
      animWords(tt.words, t, 0.05); animMarks(tt.marks, t, 0.8);
      for (const id in nodes) {
        const N = nodes[id];
        const p = P(t, T(N.n.at, dur, 0.6 + N.i * 0.9), 0.45, "back");
        N.el.style.opacity = clamp(p * 1.5);
        N.el.style.transform = `translate(-50%,-50%) scale(${0.85 + 0.15 * p})`;
      }
      for (const e of edges) {
        const A = nodes[e.from], B = nodes[e.to];
        const st = T(e.at, dur, Math.max(T(A.n.at, dur, 0.6 + A.i * 0.9), T(B.n.at, dur, 0.6 + B.i * 0.9)) - 0.3);
        const p = P(t, st, 0.6, "inOut");
        // unscaled rects (fully visible state) for geometry
        const ra = rect(A.el), rb = rect(B.el);
        const sa = A.el.style.transform, sb = B.el.style.transform;
        const dx = rb.cx - ra.cx, dy = rb.cy - ra.cy;
        const edge = (r, sx, sy) => { // point on rect boundary toward direction
          const tx = Math.abs(sx) > 1e-6 ? (r.w / 2 + 14) / Math.abs(sx) : Infinity;
          const ty = Math.abs(sy) > 1e-6 ? (r.h / 2 + 14) / Math.abs(sy) : Infinity;
          const k = Math.min(tx, ty);
          return [r.cx + sx * k, r.cy + sy * k];
        };
        const Ld = Math.hypot(dx, dy) || 1, ux = dx / Ld, uy = dy / Ld;
        const a = edge(ra, ux, uy), b = edge(rb, -ux, -uy);
        const ex = lerp(a[0], b[0], p), ey = lerp(a[1], b[1], p);
        void sa; void sb;
        if (p <= 0) { e.p.setAttribute("d", ""); e.hd.setAttribute("d", ""); if (e.lb) e.lb.style.opacity = 0; continue; }
        e.p.setAttribute("d", `M${a[0]},${a[1]}L${ex},${ey}`);
        const ang = Math.atan2(uy, ux), hs = 18;
        e.hd.setAttribute("d", `M${ex + ux * 6},${ey + uy * 6}L${ex + Math.cos(ang + 2.6) * hs},${ey + Math.sin(ang + 2.6) * hs}L${ex + Math.cos(ang - 2.6) * hs},${ey + Math.sin(ang - 2.6) * hs}Z`);
        if (e.lb) { e.lb.style.left = (a[0] + b[0]) / 2 + "px"; e.lb.style.top = (a[1] + b[1]) / 2 + "px"; e.lb.style.opacity = P(t, st + 0.4, 0.3); }
      }
    };
  };

  // ----------------------------------------------------------- document card
  // data: {kicker, title, body, source, rotate, cite}
  S.doc = (root, d, ctx) => {
    const cam = h("div", "cam"); root.appendChild(cam);
    const card = h("div", "doc"); cam.appendChild(card);
    if (d.kicker) card.appendChild(h("div", "dk", d.kicker));
    const tt = wordLine(d.title || "", "dt"); tt.el.style.display = "block"; card.appendChild(tt.el);
    const body = d.body ? wordLine(d.body, "db") : null;
    if (body) { body.el.style.display = "block"; card.appendChild(body.el); }
    if (d.cite) card.appendChild(h("div", "ds", d.cite));
    const tape1 = h("div", "tape"), tape2 = h("div", "tape");
    card.appendChild(tape1); card.appendChild(tape2);
    Object.assign(tape1.style, { left: "-4%", top: "-2%", transform: "rotate(-32deg)" });
    Object.assign(tape2.style, { right: "-4%", top: "-2%", transform: "rotate(30deg)" });
    sourceEl(root, d.source);
    const rot = d.rotate == null ? -1.5 : d.rotate;
    return (t, dur) => {
      const p = P(t, 0, 0.6, "out");
      const pd = clamp(t / dur);
      card.style.transform = `translate(-50%, ${-50 + (1 - p) * 8}%) rotate(${rot + (1 - p) * -3}deg) scale(${1 + 0.05 * pd})`;
      card.style.opacity = clamp(p * 1.4);
      for (const w of tt.words) w.style.opacity = 1;
      animMarks(tt.marks, t, T(d.hlAt, dur, 1.0));
      if (body) { body.words.forEach((w) => (w.style.opacity = 1)); animMarks(body.marks, t, T(d.bodyHlAt, dur, 1.6)); }
    };
  };

  // ----------------------------------------------------------------- chapter
  S.chapter = (root, d) => {
    const cam = h("div", "cam"); root.appendChild(cam);
    const box = h("div", "chapter"); cam.appendChild(box);
    const n = h("div", "cn", bn(d.num)); box.appendChild(n);
    const r = h("div", "rule"); box.appendChild(r);
    const tt = wordLine(d.title || "", "ct"); box.appendChild(tt.el);
    return (t, dur) => {
      drift(cam, t, dur, 0.04, 0);
      const p = P(t, 0.05, 0.5, "back");
      n.style.opacity = clamp(p * 2); n.style.transform = `translateY(${(1 - p) * 30}px)`;
      r.style.transform = `scaleX(${P(t, 0.3, 0.6, "inOut")})`;
      animWords(tt.words, t, 0.55, 0.08, 0.5);
    };
  };

  // ------------------------------------------------------------- title card
  S.title = (root, d, ctx) => {
    const cam = h("div", "cam"); root.appendChild(cam);
    const box = h("div", "titlecard"); cam.appendChild(box);
    const b = h("div", "brand", `<b>${ctx.brand.name}</b>`); box.appendChild(b);
    const tt = wordLine(d.title || "", "tt"); box.appendChild(tt.el);
    let sub = null;
    if (d.sub) { sub = wordLine(d.sub, "ts"); box.appendChild(sub.el); sub.el.style.display = "block"; }
    return (t, dur) => {
      drift(cam, t, dur, 0.05, 0);
      b.style.opacity = P(t, 0, 0.4);
      animWords(tt.words, t, 0.25, 0.09, 0.55);
      animMarks(tt.marks, t, 1.1);
      if (sub) animWords(sub.words, t, 1.4);
    };
  };

  // --------------------------------------------------------------- memorial
  S.memorial = (root, d) => {
    root.classList.add("dark");
    const cam = h("div", "cam"); root.appendChild(cam);
    const box = h("div", "memo"); cam.appendChild(box);
    const dt = h("div", "md", d.date ? bn(d.date) : ""); box.appendChild(dt);
    const num = h("div", "mn"); box.appendChild(num);
    const lab = wordLine(d.label || "", "ml"); box.appendChild(lab.el);
    return (t, dur) => {
      drift(cam, t, dur, 0.04, 0);
      dt.style.opacity = P(t, 0.1, 0.8);
      const p = P(t, 0.6, 2.2, "out");
      num.textContent = fmt(Math.round(d.value * p));
      num.style.opacity = P(t, 0.5, 0.6);
      animWords(lab.words, t, 1.8, 0.09, 0.7);
    };
  };

  // ----------------------------------------------------------------- endcard
  S.end = (root, d) => {
    const cam = h("div", "cam"); root.appendChild(cam);
    const box = h("div", "endcard"); cam.appendChild(box);
    const l1 = wordLine(d.text || "", "e1"); box.appendChild(l1.el);
    const cta = h("div", "e2", d.cta || ""); box.appendChild(cta);
    return (t, dur) => {
      drift(cam, t, dur, 0.03, 0);
      animWords(l1.words, t, 0.1, 0.07, 0.5); animMarks(l1.marks, t, 1.0);
      const p = P(t, 1.0, 0.5, "back"); cta.style.opacity = clamp(p * 2); cta.style.transform = `scale(${0.8 + 0.2 * p})`;
    };
  };


  // --------------------------------------------------------------- thumbnail
  // data: {bg:'fabric'|'paper'|'dark', l1,l2,l3 (tag), lines:[str], badge}
  S.thumb = (root, d, ctx) => {
    const cam = h("div", "cam"); root.appendChild(cam);
    if ((d.bg || "fabric") === "fabric") cam.appendChild(h("div", "fabric"));
    if (d.bg === "dark") root.classList.add("dark");
    const tag = h("div", "tag");
    tag.innerHTML = `<div class="t1">${d.l1 || "MADE IN"}</div><div class="t2">${d.l2 || "BANGLADESH"}</div><div class="t3">${d.l3 || ""}</div>`;
    cam.appendChild(tag);
    const txt = h("div", "display");
    const P_ = ctx.portrait;
    Object.assign(txt.style, P_ ? { position: "absolute", left: "7%", right: "7%", top: "8%", fontSize: "calc(var(--u)*13)", lineHeight: "1.08" }
                                : { position: "absolute", left: "52%", right: "4%", top: "50%", transform: "translateY(-50%)", fontSize: "calc(var(--u)*13.5)", lineHeight: "1.05" });
    const lines = (d.lines || []).map((l) => { const L = wordLine(l); L.el.style.display = "block"; txt.appendChild(L.el); return L; });
    txt.style.color = d.bg === "paper" ? "var(--ink)" : "#fff";
    txt.style.textShadow = d.bg === "paper" ? "none" : "0 4px 24px rgba(0,0,0,.35)";
    cam.appendChild(txt);
    Object.assign(tag.style, P_ ? { top: "66%", transform: "translate(-50%,-50%) rotate(-6deg) scale(1.35)" }
                                : { left: "27%", transform: "translate(-50%,-50%) rotate(-7deg) scale(1.25)" });
    let badge = null;
    if (d.badge) { badge = h("div", "caption-chip", d.badge); badge.style.cssText += ";background:var(--red);font-size:calc(var(--u)*5);bottom:auto;" + (P_ ? "top:86%" : "top:9%;left:27%"); cam.appendChild(badge); }
    return () => {
      lines.forEach((L) => { L.words.forEach((w) => (w.style.opacity = 1)); L.marks.forEach((m) => { if (m.kind === "hl") { m.el.style.backgroundSize = "100% 78%"; m.el.style.color = "var(--ink)"; } }); });
    };
  };

  // ======================================================= timeline player
  const state = { scenes: [], caps: [], ctx: null, total: 0 };

  function LOAD(ep) {
    const stage = document.getElementById("stage");
    const W = ep.width, H = ep.height;
    stage.style.width = W + "px"; stage.style.height = H + "px";
    const u = Math.min(W, H) / 100;
    stage.style.setProperty("--u", u + "px");
    const portrait = H > W;
    stage.classList.toggle("portrait", portrait);
    const ctx = { W, H, u, portrait, brand: ep.brand || { name: "ব্যাখ্যা" } };
    state.ctx = ctx;
    const holder = document.getElementById("scenes");
    holder.innerHTML = "";
    state.scenes = ep.scenes.map((sc) => {
      const root = h("div", "scene"); holder.appendChild(root);
      root.classList.add("on");
      const build = S[sc.type];
      if (!build) throw new Error("unknown scene type: " + sc.type);
      const upd = build(root, sc.data || {}, ctx);
      root.classList.remove("on");
      return { ...sc, root, upd };
    });
    state.total = ep.scenes.reduce((m, sc) => Math.max(m, sc.start + sc.dur), 0);
    // reel captions & header
    const caps = document.getElementById("caps");
    caps.innerHTML = "";
    state.caps = (ep.captions || []).map((c) => {
      const el = h("span", "cap");
      const ws = c.text.split(/\s+/).filter(Boolean).map((w) => { const sp = h("span", "cw", w + " "); el.appendChild(sp); return sp; });
      el.style.display = "none"; caps.appendChild(el);
      return { ...c, el, ws };
    });
    document.getElementById("reelhead").innerHTML = ep.reelHead ? `<span>${ep.reelHead}</span>` : "";
    document.getElementById("brandbug").innerHTML = portrait && !ep.scenes.some((x) => x.type === "thumb") ? `<b>${ctx.brand.name}</b> ${ctx.brand.handle || ""}` : "";
    return state.total;
  }

  let prev = null;
  function SEEK(t, frame = 0) {
    let cur = null;
    for (const sc of state.scenes) if (t >= sc.start && t < sc.start + sc.dur) { cur = sc; break; }
    if (!cur) cur = state.scenes[state.scenes.length - 1];
    if (prev && prev !== cur) prev.root.classList.remove("on");
    cur.root.classList.add("on");
    prev = cur;
    const lt = t - cur.start;
    cur.upd(lt, cur.dur);
    // entry transition
    const tr = cur.transition || "fade";
    const p = P(lt, 0, 0.32, "out");
    if (tr === "cut") { cur.root.style.opacity = 1; cur.root.style.transform = ""; }
    else if (tr === "push") { cur.root.style.opacity = 1; cur.root.style.transform = `translateX(${(1 - p) * 100}%)`; }
    else { cur.root.style.opacity = p; cur.root.style.transform = `scale(${1.015 - 0.015 * p})`; }
    // film grain jitter (deterministic from frame number)
    const g = document.getElementById("grain");
    const r1 = (Math.sin(frame * 12.9898) * 43758.5453) % 1, r2 = (Math.sin(frame * 78.233) * 12543.1234) % 1;
    g.style.transform = `translate(${(r1 * 10).toFixed(2)}%, ${(r2 * 10).toFixed(2)}%)`;
    // captions
    for (const c of state.caps) {
      const on = t >= c.start && t < c.end;
      c.el.style.display = on ? "inline" : "none";
      if (on) {
        const k = Math.floor(((t - c.start) / (c.end - c.start)) * c.ws.length);
        c.ws.forEach((w, i) => w.classList.toggle("on", i === k));
      }
    }
  }

  window.ENGINE = { LOAD, SEEK, bn, scenes: S };
})();
