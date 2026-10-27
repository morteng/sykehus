/* T5: a plan and a section as a measured drawing, not a picture of a model: dimension lines, axes, kotes and north. Pure: it makes
   primitives (drawing-png.mjs makes the PNG; a page may make SVG of the same) and the words that say what is drawn.
   One copy of the maths: every length and bearing on a wing or a new part is measureParts' own (T1, which is roof.js's and
   renderkit measure.js's), every roof piece is roof.js's (roofPieces), the ground is fit.js's groundAt. A dimension's text
   is that number, so the drawing and about_part / measure cannot disagree.
     planDrawing(site, { focus, scale? }, wingOf)                    focus: a wing or a new part (id or name)
     sectionDrawing(site, { focus, across?, along?, line?, scale? }, wingOf)   across / along the wing or part, or line [[e, n], [e, n]]
   → { prims, W, H, scale, dims: [{ kind, value, text }], kotes: [kote], say, ... }; throws a sentence for what it cannot draw. */
import { roofOf, roofPieces, measureParts, footRing } from "./roof.js";
import { groundAt, inRing } from "./renderkit/fit.js";
import { dirWord, norm360 } from "./renderkit/dirs.js";

const r2 = v => Math.round(v * 100) / 100 + 0, r1 = v => Math.round(v * 10) / 10 + 0, com = v => String(v).replace(".", ",");
const kote = v => (v < 0 ? "-" : "+") + Math.abs(v).toFixed(2).replace(".", ",");
const INK = [30, 30, 36], DIMC = [0, 84, 150], AXIS = [190, 40, 40], GREY = [120, 120, 128], ORANGE = [235, 110, 20], TEXT_BG = true;
const TONES = [[140, 140, 148], [176, 176, 184], [208, 208, 216]];   // the roof's levels, the highest darkest
const PX_PER_M_1_1 = 3779.5;   // pixels per metre at 1:1 on a 96 dpi screen; at 1:N it is this / N
const NICE = [20, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k], len = a => Math.hypot(a[0], a[1]);
const unit = a => { const L = len(a) || 1; return [a[0] / L, a[1] / L]; };
const textW = (s, size) => String(s).length * 6 * size - size;

function resolveFocus(site, ref, wingOf) {
  const key = String(ref ?? "").trim().toLowerCase();
  const v = key && (site.added || []).find(x => x.kind === "volume" && x.from && x.to && (x.id.toLowerCase() === key || x.name.toLowerCase() === key));
  if (v) return { kind: "part", v };
  const w = key && wingOf(site, ref);
  if (w) return { kind: "wing", w };
  throw new Error(`Fant ikke «${ref ?? ""}»: en fløy eller et nytt bygg (id eller navn: ${(site.added || []).filter(x => x.kind === "volume").map(x => x.id).slice(0, 12).join(", ") || "forslaget har ingen ennå"})`);
}

/* scale: px per metre for what must fit in avail pixels; `scale` is the 1:N asked for. Refuses with the smallest 1:N that fits. */
function fitScale(spanW, spanH, availW, availH, N) {
  const fit = Math.min(availW / Math.max(spanW, 1e-6), availH / Math.max(spanH, 1e-6));
  if (N == null) { const n = PX_PER_M_1_1 / fit, nice = NICE.find(x => x >= n) || Math.ceil(n / 1000) * 1000; return { p: fit, N: nice, said: `ca. 1:${nice}` }; }
  if (!(N >= 10 && N <= 100000)) throw new Error("scale er målestokken som tall, for eksempel 200 for 1:200 (mellom 10 og 100000)");
  const p = PX_PER_M_1_1 / N;
  if (p > fit * 1.0001) { const n = PX_PER_M_1_1 / fit, nice = NICE.find(x => x >= n) || Math.ceil(n / 1000) * 1000; throw new Error(`Det får ikke plass i 1:${N}; det minste målet som passer i bildet er 1:${nice}. Bruk scale: ${nice} eller la scale stå.`); }
  return { p, N, said: `1:${N}` };
}

/* ----- the drawing's furniture ----- */
const T = (prims, p, s, o = {}) => prims.push({ t: "text", p, s, size: o.size || 2, col: o.col || INK, anchor: o.anchor || "l", rot: o.rot || 0, bg: o.bg });
const Ln = (prims, a, b, col = INK, w = 1, dash = null) => prims.push({ t: "line", a, b, col, w, dash });
const Pg = (prims, pts, fill, stroke, w = 1) => prims.push({ t: "poly", pts, fill, stroke, w });

/* an architect's dimension line between two points in pixels, pushed off by `off` px along n (unit, px), ticks at both ends, text in the middle */
function dimLine(prims, dims, A, B, n, off, text, rec) {
  const a = add(A, mul(n, off)), b = add(B, mul(n, off)), e = mul(n, off > 0 ? 5 : -5);
  Ln(prims, A, add(a, e), DIMC, 1); Ln(prims, B, add(b, e), DIMC, 1); Ln(prims, a, b, DIMC, 1.2);
  const d = unit(sub(b, a)), t = [-d[1], d[0]];
  for (const q of [a, b]) Ln(prims, add(q, mul(add(d, t), -5)), add(q, mul(add(d, t), 5)), DIMC, 1.6);
  const mid = mul(add(a, b), 0.5), steep = Math.abs(d[1]) > Math.abs(d[0]) * 1.5, fits = len(sub(b, a)) > textW(text, 1.6) + 10;
  if (steep && !fits) T(prims, [mid[0] + 8, mid[1] + 5], text, { size: 1.6, col: DIMC, bg: TEXT_BG });   // a short vertical dimension: the text beside it, not along it
  else T(prims, steep ? [mid[0] - 4, mid[1]] : [mid[0], mid[1] - 4], text, { size: 1.6, col: DIMC, anchor: "m", rot: steep ? -90 : 0, bg: TEXT_BG });
  dims.push({ ...rec, text });
}

function northArrow(prims, x, y, ang = 0) {   // ang: the screen angle of north, radians clockwise from up
  const rot = ([u, v]) => [x + u * Math.cos(ang) - v * Math.sin(ang), y + u * Math.sin(ang) + v * Math.cos(ang)];
  Pg(prims, [rot([0, -26]), rot([11, 16]), rot([0, 8]), rot([-11, 16])], INK, INK, 1);
  T(prims, rot([0, -32]), "N", { size: 2, anchor: "m" });
}
function scaleBar(prims, x, y, p, W) {
  const m = [5, 10, 20, 50, 100].find(v => v * p >= 90) || 100, L = m * p;
  for (let i = 0; i < 4; i++) Pg(prims, [[x + i * L / 4, y], [x + (i + 1) * L / 4, y], [x + (i + 1) * L / 4, y + 6], [x + i * L / 4, y + 6]], i % 2 ? [255, 255, 255] : INK, INK, 1);
  T(prims, [x, y - 4], "0", { size: 1.6 }); T(prims, [x + L, y - 4], `${m} m`, { size: 1.6, anchor: "m" });
}
const frameBox = (prims, W, H) => Pg(prims, [[1, 1], [W - 1, 1], [W - 1, H - 1], [1, H - 1]], null, GREY, 1.5);

/* the longest side first: the rectangle's corners c0..c3 → { u, v (unit, the long and the short side), L, Wd, o (origin c0) } */
function frameOfRect(c) {
  const a = sub(c[1], c[0]), b = sub(c[3], c[0]);
  return len(a) >= len(b) ? { o: c[0], u: unit(a), v: unit(b), L: len(a), Wd: len(b) } : { o: c[0], u: unit(b), v: unit(a), L: len(b), Wd: len(a) };
}

/* =============================== plan =============================== */
export function planDrawing(site, o, wingOf, { W = 1280, H = 800 } = {}) {
  const f = resolveFocus(site, o.focus, wingOf), prims = [], dims = [];
  const wingId = f.kind === "wing" ? f.w.id : f.v.on || null, R = wingId ? roofOf(site, wingId) : null;
  const m = measureParts(site, f.kind === "wing" ? f.w.id : f.v.id, undefined, wingOf), A = m.a;   // length, width, axis: T1's numbers
  const parts = (site.added || []).filter(x => x.kind === "volume" && x.from && x.to && (f.kind === "part" ? x.id === f.v.id : x.on === wingId));
  const pts = f.kind === "wing" ? [...(R?.outline || A.corners), ...parts.flatMap(footRing)] : footRing(f.v);
  let lo = [Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1]))], hi = [Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))];
  if (f.kind === "part") { const g = Math.max(12, 0.6 * Math.max(hi[0] - lo[0], hi[1] - lo[1])); lo = [lo[0] - g, lo[1] - g]; hi = [hi[0] + g, hi[1] + g]; }
  const mx = 100, my = 90;
  /* at [east, north]: a zoom on that point (a corner of the roof edge) at the scale asked (default 1:200), with no demand that the whole thing fits */
  const at = o.at == null ? null : (Array.isArray(o.at) && o.at.length >= 2 && o.at.slice(0, 2).every(Number.isFinite) ? o.at.slice(0, 2) : (() => { throw new Error("at er et punkt [øst, nord] i meter: midten av tegningen"); })());
  const sc = at ? (n => { if (!(n >= 10 && n <= 100000)) throw new Error("scale er målestokken som tall, for eksempel 200 for 1:200 (mellom 10 og 100000)"); return { p: PX_PER_M_1_1 / n, N: n, said: `1:${n}` }; })(o.scale ?? 200) : fitScale(hi[0] - lo[0], hi[1] - lo[1], W - 2 * mx, H - 2 * my, o.scale), p = sc.p;
  const cx = at ? at[0] : (lo[0] + hi[0]) / 2, cy = at ? at[1] : (lo[1] + hi[1]) / 2, X = q => [W / 2 + (q[0] - cx) * p, H / 2 - (q[1] - cy) * p];
  const inView = ring => ring.some(q => { const s = X(q); return s[0] > -W && s[0] < 2 * W && s[1] > -H && s[1] < 2 * H; });
  /* what stands round it, light; then the focus wing's roof, lowest level first, each level in its tone */
  for (const b of site.buildings) if (b.wing !== wingId && b.ring?.length > 2 && inView(b.ring)) Pg(prims, b.ring.map(X), [232, 232, 236], [175, 175, 182], 1);
  const levels = R ? R.levels.map(l => l.kote) : [];
  if (wingId) for (const k of roofPieces(site, wingId).sort((a, b) => a.top - b.top)) Pg(prims, k.p.map(X), TONES[Math.min(TONES.length - 1, Math.max(0, levels.indexOf(k.top)))], null);
  if (R) Pg(prims, R.outline.map(X), null, INK, 2.2);
  /* each level's own edge, in a colour of its own with its kote (A: the one merged outline hid which edge is at which kote) */
  const EDGE_COL = [[120, 50, 170], [20, 110, 190], [30, 140, 80]], edgeKotes = [];
  if (R) for (const lv of R.edges || []) { const col = EDGE_COL[Math.min(EDGE_COL.length - 1, Math.max(0, levels.indexOf(lv.kote)))]; let said = false;
    for (const g of lv.rings) { const ring = g.ring.map(X); if (!inView(g.ring)) continue; Pg(prims, ring, null, col, 1.8);
      if (!said) { const k = ring.find(q => q[0] > 30 && q[0] < W - 30 && q[1] > 30 && q[1] < H - 30); if (k) { T(prims, [k[0] + 6, k[1] - 6], kote(lv.kote), { size: 1.5, col, bg: true }); said = true; } } }
    edgeKotes.push(lv.kote); }
  for (const v of parts) { const ring = footRing(v).map(X); Pg(prims, ring, [255, 205, 150], ORANGE, 2.4);
    const c = mul(ring.reduce(add, [0, 0]), 0.25); T(prims, [c[0], c[1] - 4], v.name, { size: 1.6, anchor: "m", bg: true }); T(prims, [c[0], c[1] + 14], `${kote(v.top_kote)}`, { size: 1.6, anchor: "m", col: ORANGE, bg: true }); }
  /* kotes of the roof levels: one label at the largest block of each */
  const kotes = [];
  if (R && f.kind === "wing") for (const kt of levels) { const bl = R.blocks.filter(b => b.kote === kt).sort((a, b) => b.length_m * b.width_m - a.length_m * a.width_m)[0] || R.levels.find(l => l.kote === kt)?.bounding_rect;
    if (!bl) continue; const c = mul(bl.corners.map(X).reduce(add, [0, 0]), 0.25); T(prims, c, kote(kt), { size: 1.6, anchor: "m", bg: true }); kotes.push(kt); }
  /* axis and the dimensions, from measureParts' numbers (A) */
  const cs = A.corners, fr = frameOfRect(cs), cp = cs.map(X), cen = mul(cp.reduce(add, [0, 0]), 0.25);
  const mid0 = add(fr.o, mul(fr.v, fr.Wd / 2)), a0 = X(add(mid0, mul(fr.u, -0.05 * fr.L))), a1 = X(add(mid0, mul(fr.u, 1.05 * fr.L)));
  Ln(prims, a0, a1, AXIS, 1.2, [14, 4, 2, 4]); T(prims, [a0[0] - 6, a0[1] + 22], `AKSE ${com(A.axis_bearing_deg)}°`, { size: 1.6, col: AXIS, bg: true, anchor: "m" });
  const side = (P, Q, valueM, kind) => { const d = sub(Q, P), n0 = unit([-d[1], d[0]]), n = (n0[0] * (cen[0] - (P[0] + Q[0]) / 2) + n0[1] * (cen[1] - (P[1] + Q[1]) / 2)) > 0 ? mul(n0, -1) : n0;
    dimLine(prims, dims, P, Q, n, 30, `${com(valueM)} m`, { kind, value: valueM }); };
  const [c0, c1, c2, c3] = cp, longFirst = len(sub(cs[1], cs[0])) >= len(sub(cs[3], cs[0]));
  side(c0, c1, longFirst ? A.length_m : A.width_m, longFirst ? "length" : "width"); side(c1, c2, longFirst ? A.width_m : A.length_m, longFirst ? "width" : "length");
  northArrow(prims, W - 50, 60, 0); scaleBar(prims, 40, H - 40, p, W); frameBox(prims, W, H);
  const title = `PLAN ${(f.kind === "wing" ? f.w.name : f.v.name).toUpperCase()}   ${sc.said.toUpperCase()}   NORD OPP`;
  T(prims, [40, 36], title, { size: 2 });
  const say = `Plan over ${f.kind === "wing" ? f.w.name : f.v.name} i ${sc.said}, nord opp${at ? `, sentrert på [${com(r1(at[0]))}, ${com(r1(at[1]))}]` : ""}, med mål, akse og kote. ${m.say}`
    + (edgeKotes.length ? ` Hvert taknivås kant er tegnet i egen farge med kote (${edgeKotes.map(com).join(", ")}); den svarte linja er hele takets ytterkant.` : "") + (f.kind === "wing" && levels.length ? ` Taket ligger på kote ${levels.map(com).join(", ")} (høyeste først).` : "")
    + (f.kind === "wing" && parts.length ? ` Nytt på taket eller ved siden: ${parts.map(v => `${v.name} (topp kote ${com(v.top_kote)})`).join(", ")}.` : "");
  return { prims, W, H, scale: sc.N, dims, kotes, say, numbers: A };
}

/* =============================== section =============================== */
/* the t (0..1) where the segment A→B is inside a ring: exact intervals, any polygon */
function inside(ring, A, B) {
  const d = sub(B, A), ts = [0, 1];
  for (let i = 0; i < ring.length; i++) {
    const P = ring[i], Q = ring[(i + 1) % ring.length], e = sub(Q, P), den = d[0] * e[1] - d[1] * e[0]; if (Math.abs(den) < 1e-12) continue;
    const w = sub(P, A), t = (w[0] * e[1] - w[1] * e[0]) / den, s = (w[0] * d[1] - w[1] * d[0]) / den; if (t > 0 && t < 1 && s >= 0 && s <= 1) ts.push(t);
  }
  ts.sort((a, b) => a - b); const out = [];
  for (let i = 0; i + 1 < ts.length; i++) if (ts[i + 1] - ts[i] > 1e-7 && inRing(add(A, mul(d, (ts[i] + ts[i + 1]) / 2)), ring)) out.push([ts[i], ts[i + 1]]);
  return out;
}
/* intervals { t0, t1, top, base } → runs of one top: where the highest of them changes */
function runsOf(ivs) {
  const cut = [...new Set(ivs.flatMap(i => [i.t0, i.t1]))].sort((a, b) => a - b), out = [];
  for (let i = 0; i + 1 < cut.length; i++) {
    const t = (cut[i] + cut[i + 1]) / 2, on = ivs.filter(x => x.t0 <= t && x.t1 >= t); if (!on.length) continue;
    const top = Math.max(...on.map(x => x.top)), base = Math.min(...on.map(x => x.base)), last = out.at(-1);
    if (last && Math.abs(last.t1 - cut[i]) < 1e-7 && last.top === top && last.base === base) last.t1 = cut[i + 1]; else out.push({ t0: cut[i], t1: cut[i + 1], top, base });
  }
  return out;
}

export function sectionDrawing(site, o, wingOf, { W = 1280, H = 800 } = {}) {
  const f = resolveFocus(site, o.focus, wingOf), prims = [], dims = [];
  const wingId = f.kind === "wing" ? f.w.id : f.v.on || null, wing = wingId ? (site.wings || []).find(w => w.id === wingId) : null, R = wingId ? roofOf(site, wingId) : null;
  const baseOf = new Map(site.buildings.map(b => [b.id, b.base]));
  const pcs = [...new Set(site.buildings.map(b => b.wing))].flatMap(wg => roofPieces(site, wg).map(k => ({ ...k, own: wg === wingId && wingId != null })));
  const vols = (site.added || []).filter(x => x.kind === "volume" && x.from && x.to && x.top_kote != null && x.base_kote != null);
  const ivsOf = (A, B) => {
    const d = len(sub(B, A)), out = { own: [], other: [], parts: [] };
    for (const k of pcs) { const base = baseOf.get(k.building); for (const [t0, t1] of inside(k.p, A, B)) (k.own ? out.own : out.other).push({ t0, t1, top: k.top, base: base ?? (groundAt(site, add(A, mul(sub(B, A), (t0 + t1) / 2))) - 0) }); }
    for (const v of vols) for (const [t0, t1] of inside(footRing(v), A, B)) out.parts.push({ t0, t1, top: v.top_kote, base: v.base_kote, v });
    return { ...out, d };
  };
  /* the cut: across or along the wing or part through its middle, or a line given; none asked: the one of those that goes through most of the roof's levels */
  const A0 = measureParts(site, f.kind === "wing" ? f.w.id : f.v.id, undefined, wingOf).a, fr = frameOfRect(f.kind === "wing" && R ? R.bounding_rect.corners : A0.corners);   // the whole roof's rectangle, not only its biggest level
  const mk = (kind, g) => kind === "across" ? { kind, A: add(fr.o, add(mul(fr.u, g * fr.L), mul(fr.v, -3))), B: add(fr.o, add(mul(fr.u, g * fr.L), mul(fr.v, fr.Wd + 3))) }
    : { kind, A: add(fr.o, add(mul(fr.v, g * fr.Wd), mul(fr.u, -3))), B: add(fr.o, add(mul(fr.v, g * fr.Wd), mul(fr.u, fr.L + 3))) };
  let cut;
  if (o.line != null) {
    const l = o.line; if (!Array.isArray(l) || l.length !== 2 || !l.every(q => Array.isArray(q) && q.length >= 2 && q.slice(0, 2).every(Number.isFinite))) throw new Error("line er to punkter [[øst, nord], [øst, nord]] i meter: snittlinjen fra venstre til høyre");
    if (len(sub(l[1], l[0])) < 3) throw new Error("line er for kort: snittlinjen må være minst 3 m lang");
    cut = { kind: "line", A: l[0].slice(0, 2), B: l[1].slice(0, 2) };
  } else if (o.across && o.along) throw new Error("Velg across eller along, ikke begge (eller line for en egen snittlinje)");
  else if (o.across || o.along) cut = mk(o.across ? "across" : "along", 0.5);
  else {
    const cands = [mk("across", 0.5), mk("along", 0.5), ...[0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85].flatMap(g => [mk("across", g), mk("along", g)])];
    const score = c => { const i = ivsOf(c.A, c.B); return new Set(runsOf(i.own).filter(r => (r.t1 - r.t0) * i.d >= 0.5).map(r => r.top)).size; };
    cut = cands.map(c => ({ c, s: score(c) })).reduce((best, x) => x.s > best.s ? x : best).c;
  }
  if (f.kind === "part" && cut.kind !== "line") { const half = (cut.kind === "across" ? fr.Wd / 2 : fr.L / 2) + 12, m0 = mul(add(cut.A, cut.B), 0.5), dd = unit(sub(cut.B, cut.A)); cut = { ...cut, A: add(m0, mul(dd, -half)), B: add(m0, mul(dd, half)) }; }
  const { A, B } = cut, Ld = len(sub(B, A)), u = unit(sub(B, A)), face = [-u[1], u[0]];   // the viewer looks along `face`: A is on the left
  const iv = ivsOf(A, B), own = runsOf(iv.own), others = runsOf(iv.other);
  const ground = []; const N = Math.max(40, Math.min(400, Math.ceil(Ld / 0.75)));
  for (let i = 0; i <= N; i++) ground.push([i / N * Ld, r2(groundAt(site, add(A, mul(u, i / N * Ld))))]);
  const allTop = [...own, ...others, ...iv.parts].map(r => r.top), allBase = [...own, ...others, ...iv.parts].map(r => r.base);
  const zlo = Math.min(...ground.map(g => g[1]), ...allBase) - 3, zhi = Math.max(...allTop, ...ground.map(g => g[1])) + 5;
  const mL = 200, mR = 270, mT = 70, mB = 120, sc = fitScale(Ld, zhi - zlo, W - mL - mR, H - mT - mB, o.scale), p = sc.p;
  const x0 = mL + (W - mL - mR - Ld * p) / 2, zbot = H - mB, px = (t, z) => [x0 + t * p, zbot - (z - zlo) * p], tx = t => x0 + t * Ld * p;
  /* the ground, hatched below */
  Pg(prims, [...ground.map(g => px(g[0], g[1])), px(Ld, zlo), px(0, zlo)], [226, 214, 196], null);
  Ln(prims, px(0, zlo), px(Ld, zlo), GREY, 1);
  for (let i = 1; i < ground.length - 1; i += 3) { const a = px(ground[i][0], ground[i][1]); Ln(prims, [a[0], a[1] + 4], [a[0] - 7, Math.min(a[1] + 14, zbot)], [180, 160, 130], 1); }
  for (const r of others) Pg(prims, [px(r.t0 * Ld, r.base), px(r.t1 * Ld, r.base), px(r.t1 * Ld, r.top), px(r.t0 * Ld, r.top)], [225, 225, 230], [160, 160, 168], 1.2);
  for (const r of own) Pg(prims, [px(r.t0 * Ld, r.base), px(r.t1 * Ld, r.base), px(r.t1 * Ld, r.top), px(r.t0 * Ld, r.top)], [176, 176, 186], INK, 1.8);
  for (let i = 1; i < ground.length; i++) Ln(prims, px(ground[i - 1][0], ground[i - 1][1]), px(ground[i][0], ground[i][1]), [120, 90, 50], 2.2);
  for (const r of iv.parts) { const q = [px(r.t0 * Ld, r.base), px(r.t1 * Ld, r.base), px(r.t1 * Ld, r.top), px(r.t0 * Ld, r.top)]; Pg(prims, q, [255, 205, 150], ORANGE, 2.2);
    T(prims, [(q[0][0] + q[1][0]) / 2, q[3][1] + 16], r.v.name, { size: 1.6, anchor: "m", bg: true }); }
  /* the wing's storeys on the left, light, dashed across the wing */
  const span = own.length ? [Math.min(...own.map(r => r.t0)), Math.max(...own.map(r => r.t1))] : null;
  if (wing?.levels?.length && span) { let lastY = Infinity;
    for (const l of wing.levels.filter(l => l.kote != null && l.kote > zlo && l.kote < zhi).sort((a, b) => b.kote - a.kote)) { const y = px(0, l.kote)[1]; if (Math.abs(lastY - y) < 15) continue; lastY = y;
      Ln(prims, [tx(span[0]), y], [tx(span[1]), y], [110, 150, 200], 1, [6, 5]); T(prims, [mL - 18, y + 5], `${l.name} ${kote(l.kote)}`, { size: 1.5, anchor: "r", col: [70, 110, 170] }); } }
  /* the centre axis of the wing (where the cut meets the long axis of the biggest level) */
  const cn = R ? R.levels.slice().sort((a, b) => b.area_m2 - a.area_m2)[0].bounding_rect.corners.reduce(add, [0, 0]).map(v => v / 4) : A0.corners.reduce(add, [0, 0]).map(v => v / 4), tc = (cn[0] - A[0]) * u[0] + (cn[1] - A[1]) * u[1];
  if (tc > 0 && tc < Ld) { Ln(prims, [tx(tc / Ld), mT - 18], [tx(tc / Ld), zbot + 14], AXIS, 1.2, [14, 4, 2, 4]); T(prims, [tx(tc / Ld) + 6, mT - 8], "MIDTAKSE", { size: 1.5, col: AXIS, bg: true }); }
  /* the kotes on the right: each level's top, a leader, its number; dimensions between them and from the foot */
  const baseKote = own.length ? Math.min(...own.map(r => r.base)) : null, topsAll = [...new Set([...own.map(r => r.top), ...iv.parts.map(r => r.top)])].sort((a, b) => a - b);
  const xr = x0 + Ld * p + 28, kotes = topsAll.slice().sort((a, b) => b - a);
  for (const kt of topsAll) { const y = px(0, kt)[1], rr = [...own, ...iv.parts].filter(r => r.top === kt), xe = tx(Math.max(...rr.map(r => r.t1))); Ln(prims, [xe + 2, y], [xr + 6, y], [90, 90, 90], 1, [3, 3]); T(prims, [xr + 10, y + 5], kote(kt), { size: 2, bg: true }); }
  const chain = [...(baseKote != null ? [baseKote] : []), ...topsAll], xd = xr + 138;
  for (let i = 1; i < chain.length; i++) { const a = [xd, px(0, chain[i - 1])[1]], b = [xd, px(0, chain[i])[1]], dh = r2(chain[i] - chain[i - 1]); if (Math.abs(a[1] - b[1]) < 12) continue;
    dimLine(prims, dims, a, b, [1, 0], 0, `${com(dh)} m`, { kind: "height", value: dh, from: chain[i - 1], to: chain[i] }); }
  if (baseKote != null) { const y = px(0, baseKote)[1]; Ln(prims, [tx(span[1]) + 2, y], [xr + 6, y], [90, 90, 90], 1, [3, 3]); T(prims, [xr + 10, y + 5], `${kote(baseKote)} FOT`, { size: 1.6, bg: true }); }
  /* the runs along the cut, in a chain below the ground; and the whole */
  const yb = zbot + 34, runDims = own.filter(r => (r.t1 - r.t0) * Ld >= 0.3);
  for (const r of runDims) { const a = [tx(r.t0), yb], b = [tx(r.t1), yb], v = r2((r.t1 - r.t0) * Ld); if (b[0] - a[0] < 4) continue;
    Ln(prims, [a[0], yb - 8], [a[0], yb + 5], DIMC, 1); Ln(prims, [b[0], yb - 8], [b[0], yb + 5], DIMC, 1); Ln(prims, a, b, DIMC, 1.2);
    if (b[0] - a[0] > textW(`${com(v)} m`, 1.6) + 4) T(prims, [(a[0] + b[0]) / 2, yb - 3], `${com(v)} m`, { size: 1.6, col: DIMC, anchor: "m" }); dims.push({ kind: "run", value: v, kote: r.top, text: `${com(v)} m` }); }
  if (span) { const tot = r2((span[1] - span[0]) * Ld); dimLine(prims, dims, [tx(span[0]), yb], [tx(span[1]), yb], [0, 1], 22, `${com(tot)} m`, { kind: "length", value: tot }); }
  /* A and B, the viewing direction, north */
  T(prims, [tx(0) - 2, mT - 8], "A", { size: 3, anchor: "r" }); T(prims, [tx(1) + 8, mT - 8], "A", { size: 3 });
  const nv = { cross: u[1], away: face[1] };   // north · u (right on the screen), north · face (away from the viewer)
  const nx = W - 50, ny = 62;
  if (Math.abs(nv.cross) < 0.3) { prims.push({ t: "poly", pts: Array.from({ length: 24 }, (_, i) => [nx + 16 * Math.cos(i / 24 * 2 * Math.PI), ny + 16 * Math.sin(i / 24 * 2 * Math.PI)]), fill: null, stroke: INK, w: 1.6 });
    if (nv.away > 0) { Ln(prims, [nx - 8, ny - 8], [nx + 8, ny + 8], INK, 1.6); Ln(prims, [nx - 8, ny + 8], [nx + 8, ny - 8], INK, 1.6); } else Pg(prims, Array.from({ length: 12 }, (_, i) => [nx + 4 * Math.cos(i / 12 * 2 * Math.PI), ny + 4 * Math.sin(i / 12 * 2 * Math.PI)]), INK, INK, 1);
    T(prims, [nx, ny + 34], nv.away > 0 ? "N BAK" : "N FORAN", { size: 1.6, anchor: "m" }); }
  else { const dx = Math.sign(nv.cross) * 26; Ln(prims, [nx - dx, ny], [nx + dx, ny], INK, 2); Pg(prims, [[nx + dx, ny], [nx + dx - Math.sign(dx) * 10, ny - 6], [nx + dx - Math.sign(dx) * 10, ny + 6]], INK, INK, 1); T(prims, [nx + dx * 1.25 + Math.sign(dx) * 4, ny + 6], "N", { size: 2, anchor: dx > 0 ? "l" : "r" }); }
  const looking = dirWord(norm360(Math.atan2(face[0], face[1]) * 180 / Math.PI)), kind = cut.kind === "across" ? "tverrsnitt" : cut.kind === "along" ? "lengdesnitt" : "snitt";
  const title = `SNITT A-A ${(f.kind === "wing" ? f.w.name : f.v.name).toUpperCase()}   ${kind.toUpperCase()}   ${sc.said.toUpperCase()}   SETT MOT ${looking.toUpperCase()}`;
  T(prims, [40, 36], title, { size: 2 }); frameBox(prims, W, H);
  const crossed = [...new Set(own.filter(r => (r.t1 - r.t0) * Ld >= 0.5).map(r => r.top))].sort((a, b) => b - a), all = R ? R.levels.map(l => l.kote) : [];
  const missed = all.filter(k => !crossed.includes(k));
  const say = `Snitt A-A gjennom ${f.kind === "wing" ? f.w.name : f.v.name} (${kind}, ${com(r1(Ld))} m langt, ${sc.said}, sett mot ${looking}). `
    + (all.length ? `Taket på ${wing?.name || "bygget"} ligger på kote ${all.map(com).join(", ")} (høyeste først); snittet går gjennom ${crossed.length ? crossed.map(com).join(", ") : "ingen av dem"}${missed.length ? ` og treffer ikke ${missed.map(com).join(", ")} (bruk line for en snittlinje der)` : ""}. ` : "")
    + (baseKote != null ? `Foten ligger på kote ${com(baseKote)}. ` : "")
    + (chain.length > 1 ? `Høydeforskjeller: ${chain.slice(1).map((k, i) => `${com(chain[i])} til ${com(k)} er ${com(r2(k - chain[i]))} m`).join("; ")}. ` : "")
    + (iv.parts.length ? `Nytt i snittet: ${[...new Set(iv.parts.map(r => `${r.v.name} (kote ${com(r.base)} til ${com(r.top)}${r.v.shape && r.v.shape !== "box" ? `, tegnet som en kasse opp til toppen fordi formen er ${r.v.shape}` : ""})`))].join("; ")}. ` : "")
    + `Snittlinjen går fra [${com(r1(A[0]))}, ${com(r1(A[1]))}] til [${com(r1(B[0]))}, ${com(r1(B[1]))}] (øst, nord i m). `
    + `Dette er et snitt gjennom takkotene og terrenget, ikke en fasadetegning: det finnes ingen tegnet fasade (oppriss) av ${f.kind === "wing" ? f.w.name : wing?.name || "bygget"} i dataene, så ingen fasade er tegnet; vinduene står i openings.`;
  return { prims, W, H, scale: sc.N, dims, kotes, say, cut: { kind: cut.kind, from: A.map(r1), to: B.map(r1), length_m: r1(Ld), looking }, crossed, levels: all };
}
