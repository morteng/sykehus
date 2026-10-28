/* «Fasade»: one side of a building as an elevation drawing (oppriss) with dimension lines, and the numbers a person may change.
   Pure: it makes primitives (public/drawing.js's kind: line, poly, text) plus the words and the edits. Nothing here touches the page.

   One copy of the maths. The walls and their sides are design.js's facingWalls (the same walls a balconies edit stands on), the
   window bays are bays.js's rule (the high-rise's windows and the blind strip of site.json window_rule, as tools/ifc.py reads
   them), a facade drawn from the archive's drawings (site.facades) wins where there is one, the roof's levels are roof.js's,
   the ground is fit.js's groundAt. A number on the drawing is read from those, so the drawing and about_part, measure and the
   IFC cannot disagree.

   What a person may change goes through the SAME edits as try_change and the page's own changes (edits.js checkEdit, then
   applyEdits): a storey's kote is a «level» edit; a new building's length, width and height are one «reshape». A number with no
   edit kind in edits.js or design.js is read only (dim.ref is null). Nothing is saved here: editsFor gives the edits, tryEdits
   lays them over the model for a preview, and the page sends them (the draft) only when the person presses the button.

   The picture's frame: x (t) is metres along the facade from its left end seen from outside, z is the kote. A stroke the person
   draws is kept as [t, z] and goes to Anton also as site metres [east, north, kote] (world), so he can place a change where it
   was drawn.
     facadeDrawing(site, { focus, side }, wingOf, { W, H, dark })  → { prims, dims, toPx, toM, world, face, ... }; throws a sentence
     sidesOf(site, focus, wingOf)                                  → [{ key, name, bearing }], Sørsiden first
     editsFor(site, ref, value) · readRef(site, ref) · tryEdits(site0, floors0, base, pending) · sayChange(...) · strokeWords(...) · toSvg(...) */
import { footRing, roofOf } from "./roof.js";
import { groundAt } from "./renderkit/fit.js";
import { SIDES, SIDE_KEYS, bearingOf, turn } from "./renderkit/dirs.js";
import { facingWalls, facadeNames, facadesOf, replacesBuiltIn } from "./design.js";
import { WINDOWS, kindOf, rowsOf, windowsOn, blindWall } from "./bays.js";
import { checkEdit, applyEdits } from "./edits.js";
import { isBalcony, com, kote } from "./drawing.js";

const r2 = v => Math.round(v * 100) / 100 + 0;
export const fm = v => (Math.round(v * 100) / 100 + 0).toFixed(2).replace(".", ",");   // a length in metres, always two decimals
const dot = (p, q) => p[0] * q[0] + p[1] * q[1], rad = d => d * Math.PI / 180;
const SIDE_NAME = { S: "Sørsiden", "Ø": "Østsiden", V: "Vestsiden", N: "Nordsiden" }, ORDER = ["S", "Ø", "V", "N"];
const KEY_OF = Object.fromEntries(Object.entries(SIDE_NAME).map(([k, v]) => [v.toLowerCase(), k]));
const WHY = "endret på fasadetegningen";

const LIGHT = { paper: [251, 249, 244], ink: [35, 33, 30], wallFar: [205, 200, 191], wallNear: [232, 228, 220], glass: [150, 188, 218], glassLine: [60, 100, 140], slab: [105, 105, 112],
  vol: [255, 205, 150], volLine: [235, 110, 20], ground: [120, 90, 50], groundFill: [226, 214, 196], dim: [0, 84, 150], pill: [255, 255, 255], pillLine: [31, 95, 191], storey: [110, 150, 200], muted: [105, 101, 94], door: [140, 100, 70] };
const DARK = { paper: [28, 27, 26], ink: [235, 232, 225], wallFar: [58, 56, 52], wallNear: [88, 85, 80], glass: [70, 110, 150], glassLine: [140, 185, 230], slab: [175, 175, 182], vol: [120, 80, 40], volLine: [240, 150, 70],
  ground: [190, 160, 110], groundFill: [58, 51, 42], dim: [120, 180, 235], pill: [40, 44, 52], pillLine: [120, 170, 255], storey: [100, 140, 190], muted: [165, 160, 150], door: [200, 160, 120] };
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));

/* ---------- what is drawn: a wing or a new building, from one side ---------- */
function focusOf(site, ref, wingOf) {
  const key = String(ref ?? "").trim().toLowerCase();
  const v = key && (site.added || []).find(x => x.kind === "volume" && x.from && x.to && !isBalcony(x) && (x.id.toLowerCase() === key || x.name.toLowerCase() === key));
  if (v) return { kind: "part", v, name: v.name };
  const w = key && wingOf(site, ref);
  if (w) return { kind: "wing", w, name: w.name };
  throw new Error(`Fant ikke «${ref ?? ""}»: en fløy eller et nytt bygg`);
}
/* the sides a building has: the four names, each with the bearing its wall faces (a turned wing: design.js facadeNames) */
export function sidesOf(site, focus, wingOf) {
  const f = typeof focus === "object" && focus?.kind ? focus : focusOf(site, focus, wingOf), out = [];
  let faces;
  if (f.kind === "wing") {
    const named = facadeNames(site, f.w.id);
    if (named.length) return ORDER.map(k => { const n = named.find(x => x.name === SIDE_NAME[k].toLowerCase()); return n && { key: k, name: SIDE_NAME[k], bearing: n.bearing }; }).filter(Boolean);
    faces = facadesOf(site, f.w.id).filter(x => x.length_m >= 6).map(x => x.bearing);
  } else {
    const a = bearingOf([f.v.to[0] - f.v.from[0], f.v.to[1] - f.v.from[1]]);
    faces = [0, 90, 180, 270].map(d => (a + d) % 360);
  }
  for (const k of ORDER) {
    const best = faces.filter(b => turn(b, bearingOf(SIDES[k])) <= 45 && !out.some(o => o.bearing === b)).sort((a, b) => turn(a, bearingOf(SIDES[k])) - turn(b, bearingOf(SIDES[k])))[0];
    if (best != null) out.push({ key: k, name: SIDE_NAME[k], bearing: best });
  }
  return out;
}
function pickSide(sides, side) {
  if (!sides.length) throw new Error("Bygget har ingen fasade å tegne.");
  if (side == null) return sides[0];
  const key = typeof side === "string" ? KEY_OF[side.toLowerCase()] ?? side : side;
  return sides.find(s => s.key === key || s.name === side || s.bearing === side) || sides[0];
}

/* far_from_corner of tools/ifc.py: a window at u m along its wall stands outside the blind strip next to the end's corner (site.json window_rule) */
function farFromCorner([x0, y0, x1, y1], u, rule) {
  const L = Math.hypot(x1 - x0, y1 - y0), px = x0 + (x1 - x0) / L * u, py = y0 + (y1 - y0) / L * u, [ox, oy] = rule.end_origin, [nx, ny] = rule.end_out;
  const axial = -((px - ox) * nx + (py - oy) * ny);
  if (Math.abs((x1 - x0) * nx + (y1 - y0) * ny) < 0.7 * L) return true;   // a wall across the building: no strip
  const t = (px - ox) * ny - (py - oy) * nx;
  return axial >= rule.blind_from_end_m[t < rule.end_width_m / 2 ? "120" : "300"];
}

/* the windows the bay rule puts on one wall w (facingWalls' item): [{ x0, x1, z0, z1, kind }] with x along the facade (viewer's right) */
function ruleWindows(site, wing, w, rs, levels) {
  const { b, wall, L, flip, lo, hi } = w; if (blindWall(b, wall)) return [];
  const kind = kindOf(b), glass = WINDOWS[kind], { step, org } = rowsOf(kind, wing, b.base), rule = b.window_rule, out = [];
  const top = Math.max(b.top, ...levels.map(l => l.kote)), bands = levels.map((l, i) => [l.kote, levels[i + 1]?.kote ?? top]);
  const lefts = glass.map(g => g[0]), x0g = Math.min(...lefts) - 0.06, xa = rs.dot(w.a);   // x of the wall's start in its facade direction; the walk goes toward lower x
  for (const [g0] of windowsOn(kind, wall.slice(0, 4))) {
    const s0 = g0 - x0g;
    for (let r = Math.floor((lo - org) / step) - 1; r <= Math.floor((hi - org) / step) + 1; r++) {
      const rowTop = org + (r + 1) * step;
      for (const [l, t, rt, bt] of glass) {
        const z0 = rowTop - bt, z1 = rowTop - t;
        if (rule && !(z0 >= rule.from_kote && farFromCorner(wall.slice(0, 4), s0 + (l + rt) / 2, rule))) continue;   // a storey with none, a blind strip at the corner
        if (!(z0 >= lo && z1 <= hi - 0.3)) continue;
        if (bands.length && !bands.some(([a, c]) => a <= z0 + 1e-6 && z1 <= c + 1e-6)) continue;   // inside one storey, never over a floor
        const u0 = s0 + l, u1 = s0 + rt, e0 = flip ? L - u1 : u0, e1 = flip ? L - u0 : u1;   // metres from the wall's own a (facingWalls) toward bb
        out.push({ x0: xa - e1, x1: xa - e0, z0: r2(z0), z1: r2(z1), kind: "window" });
      }
    }
  }
  return out;
}

/* ---------- the drawing ---------- */
export function facadeDrawing(site, o, wingOf, { W = 1180, H = 720, dark = false } = {}) {
  const f = focusOf(site, o.focus, wingOf), sides = sidesOf(site, f, wingOf), side = pickSide(sides, o.side), B = side.bearing, C = dark ? DARK : LIGHT;
  const n = [Math.sin(rad(B)), Math.cos(rad(B))], rv = [-n[1], n[0]];   // n points out of the wall; rv is the viewer's right (a south face: east)
  const rs = { dot: p => dot(p, rv) };
  const wing = f.kind === "wing" ? f.w : null, levels = (wing?.levels || []).filter(l => l.kote != null).slice().sort((a, b) => a.kote - b.kote);
  const walls = [], bals = [], vols = [], doors = []; let wins = [];
  /* the walls that face this way, each a rectangle: x along the facade, kote from lo to hi, q how far out it stands */
  if (wing) {
    for (const w of facingWalls(site, wing.id, "N", B)) {
      const xa = dot(w.a, rv), xb = dot(w.bb, rv), q = dot(w.a, n);
      walls.push({ x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: w.lo, z1: w.hi ?? w.b.top, q, w });
    }
    if (!walls.length) throw new Error(`${wing.name} har ingen vegg mot ${side.name.toLowerCase()}.`);
  } else {
    const ring = footRing(f.v), xs = ring.map(p => dot(p, rv));
    walls.push({ x0: Math.min(...xs), x1: Math.max(...xs), z0: f.v.base_kote, z1: f.v.top_kote, q: Math.max(...ring.map(p => dot(p, n))), vol: f.v });
  }
  const X0 = Math.min(...walls.map(w => w.x0)), X1 = Math.max(...walls.map(w => w.x1)), qFront = Math.max(...walls.map(w => w.q));
  const width = r2(X1 - X0), baseLo = Math.min(...walls.map(w => w.z0)), roofTop = Math.max(...walls.map(w => w.z1));
  /* windows: the facade drawn from the archive's drawings where there is one on this wall, else the bay rule */
  if (wing) {
    const drawn = (site.facades || []).filter(fc => fc.building === wing.id && Math.abs(dot([(fc.to[0] - fc.from[0]), (fc.to[1] - fc.from[1])], n)) < 0.2 * Math.hypot(fc.to[0] - fc.from[0], fc.to[1] - fc.from[1]) && walls.some(w => Math.abs(dot(fc.from, n) - w.q) < 3));
    if (drawn.length) for (const fc of drawn) {
      const L = Math.hypot(fc.to[0] - fc.from[0], fc.to[1] - fc.from[1]), d = [(fc.to[0] - fc.from[0]) / L, (fc.to[1] - fc.from[1]) / L];
      for (const op of fc.openings || []) {
        const xa = dot(fc.from, rv) + dot(d, rv) * op.u[0], xb = dot(fc.from, rv) + dot(d, rv) * op.u[1], r = { x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: op.z[0], z1: op.z[1], kind: op.kind === "door" ? "door" : "window" };
        (r.kind === "door" ? doors : wins).push(r);
      }
    } else for (const w of walls) wins.push(...ruleWindows(site, wing, w.w, rs, levels));
    /* balconies: a person's own (a balconies edit's parts) and the base's built-in runs unless a person's replace them */
    const near = p => walls.some(w => Math.abs(dot(p, n) - w.q) < 3);
    if (o.layout) for (const it of o.layout) { const l = levels.find(x => x.name === it.storey); if (l) bals.push({ x0: it.t0 + X0, x1: it.t1 + X0, z0: l.kote - 0.2, z1: l.kote, depth: it.depth, id: it.id, storey: it.storey, built: !!it.built, support: !!it.support }); }
    else for (const a of site.added || []) if (a.kind === "balconies") for (const p of a.parts || []) if (p.role === "slab" && p.face != null && turn(p.face, B) <= 20) {
      const xa = dot(p.axis[0], rv), xb = dot(p.axis[1], rv), zs = p.profile.map(q => q[1]); bals.push({ x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(...zs), z1: Math.max(...zs), depth: Math.max(...p.profile.map(q => q[0])), id: `egen:${a.id}:${Math.round(Math.min(xa, xb) * 10)}:${Math.max(...zs)}`, storey: levels.find(l => Math.abs(l.kote - Math.max(...zs)) < 0.011)?.name, built: false, support: a.support === true });
    }
    if (!o.layout && !replacesBuiltIn(site)) for (const b of site.buildings.filter(x => x.wing === wing.id)) for (const run of b.balconies || []) {
      const d = [run.to[0] - run.from[0], run.to[1] - run.from[1]], L = Math.hypot(...d);
      if (Math.abs(dot(d, n)) > 0.2 * L || !near([(run.from[0] + run.to[0]) / 2, (run.from[1] + run.to[1]) / 2])) continue;
      const xa = dot(run.from, rv), xb = dot(run.to, rv);
      for (const l of levels) { const k = parseInt(l.name, 10); if (Number.isFinite(k) && k >= (run.from_storey ?? 1) && k <= (run.to_storey ?? 99) && l.kote <= (run.top ?? 1e9) && walls.some(w => Math.abs(dot(run.from, n) - w.q) < 3 && Math.min(xa, xb) < w.x1 + 0.1 && Math.max(xa, xb) > w.x0 - 0.1 && l.kote >= w.z0 - 0.3 && l.kote <= w.z1)) bals.push({ x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: l.kote - 0.2, z1: l.kote, depth: run.depth, built: true, storey: l.name, id: `bygd:${l.name}:${Math.round(Math.min(xa, xb) * 10)}` }); }
    }
    /* dørene lagt på (openings-editene): fra oppsettet mens det redigeres, ellers fra modellens egne endringer; en dør med
       window skjuler vinduet den står i, så det ikke stikker frem under en dør gjort mindre (matchet på midten, med sikkert
       grep: langs-målet går gjennom veggenes egen deling, som balkongenes, og kan ligge noen desimeter fra tegningens) */
    const covered = [];
    if (o.doors) for (const it of o.doors) { if (it.win) covered.push({ x0: it.win[0] + X0, x1: it.win[1] + X0, z0: it.win[2], z1: it.win[3] }); doors.push({ x0: it.t0 + X0, x1: it.t1 + X0, z0: it.z0, z1: it.z1, id: it.id }); }
    else for (const a of site.added || []) if (a.kind === "openings") {
      if (a.covered) for (const w of a.covered) covered.push({ x0: X0 + width - w[1], x1: X0 + width - w[0], z0: w[2], z1: w[3] });
      for (const p of a.parts || []) if (p.role === "door" && p.face != null && turn(p.face, B) <= 20) { const xa = dot(p.axis[0], rv), xb = dot(p.axis[1], rv), zs = p.profile.map(q => q[1]);
        doors.push({ x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(...zs), z1: Math.max(...zs), id: `egen:${a.id}:${doors.length}` }); }
    }
    wins = wins.filter(g => !covered.some(c => Math.abs((c.x0 + c.x1) / 2 - (g.x0 + g.x1) / 2) < 0.6 && Math.abs((c.z0 + c.z1) / 2 - (g.z0 + g.z1) / 2) < 0.6));
  }
  /* the new buildings in front of this side, or on its roof */
  for (const v of site.added || []) {
    if (v.kind !== "volume" || !v.from || !v.to || isBalcony(v) || v.base_kote == null || v.top_kote == null || (f.kind === "part" && v.id === f.v.id) || f.kind === "part") continue;
    const ring = footRing(v), xs = ring.map(p => dot(p, rv)), q = Math.max(...ring.map(p => dot(p, n)));
    if (!(v.on === wing?.id || (q >= qFront - 2 && Math.max(...xs) > X0 - 3 && Math.min(...xs) < X1 + 3))) continue;
    vols.push({ x0: Math.min(...xs), x1: Math.max(...xs), z0: v.base_kote, z1: v.top_kote, q: v.on === wing?.id ? qFront + 99 : q, vol: v });
  }
  if (f.kind === "part") vols.push({ ...walls[0], vol: f.v });
  const bodies = f.kind === "part" ? [] : walls;
  /* the frame: t from the facade's left end */
  const all = [...bodies, ...vols, ...bals], tMin = Math.min(0, ...all.map(a => a.x0 - X0)), tMax = Math.max(width, ...all.map(a => a.x1 - X0));
  const gnd = []; { const N = 48; for (let i = 0; i <= N; i++) { const t = tMin - 3 + (tMax - tMin + 6) * i / N, P = [(t + X0) * rv[0] + qFront * n[0], (t + X0) * rv[1] + qFront * n[1]]; gnd.push([t, r2(groundAt(site, P))]); } }
  const zlo = Math.min(...gnd.map(g => g[1]), baseLo) - 2.2, zhi = Math.max(roofTop, ...vols.map(v => v.z1)) + 2.2;
  const mL = 168, mR = 150, mT = 78, mB = 118, span = Math.max(tMax - tMin + 6, 1e-6), p = Math.min((W - mL - mR) / span, (H - mT - mB) / (zhi - zlo));
  const x0px = mL + (W - mL - mR - (tMax - tMin) * p) / 2 - tMin * p, zbot = H - mB, px = (t, z) => [x0px + t * p, zbot - (z - zlo) * p];
  const toM = (x, y) => [(x - x0px) / p, zlo + (zbot - y) / p];
  const world = (t, z) => [r2((t + X0) * rv[0] + qFront * n[0]), r2((t + X0) * rv[1] + qFront * n[1]), r2(z)];
  const prims = [], dims = [];
  const T = (pt, s, o2 = {}) => prims.push({ t: "text", p: pt, s, size: (o2.fs || 14) / 7, col: o2.col || C.ink, anchor: o2.anchor || "l", rot: o2.rot || 0, bg: o2.bg ? C.paper : null, bold: !!o2.bold });
  const Ln = (a, b, col = C.ink, w = 1, dash = null) => prims.push({ t: "line", a, b, col, w, dash });
  const Pg = (pts, fill, stroke, w = 1) => prims.push({ t: "poly", pts, fill, stroke, w });
  const rect = (a, fill, stroke, w = 1) => Pg([px(a.x0 - X0, a.z0), px(a.x1 - X0, a.z0), px(a.x1 - X0, a.z1), px(a.x0 - X0, a.z1)], fill, stroke, w);
  Pg([...gnd.map(g => px(g[0], g[1])), px(gnd.at(-1)[0], zlo), px(gnd[0][0], zlo)], C.groundFill, null);
  /* walls, the farthest first, nearer ones lighter so a recess and a step read */
  const qs = [...new Set(bodies.map(w => Math.round(w.q * 10)))].sort((a, b) => a - b);
  for (const w of bodies.slice().sort((a, b) => a.q - b.q)) rect(w, mix(C.wallFar, C.wallNear, qs.length > 1 ? qs.indexOf(Math.round(w.q * 10)) / (qs.length - 1) : 1), C.ink, 1.4);
  for (const g of wins) rect({ ...g, x0: g.x0, x1: g.x1 }, C.glass, C.glassLine, 0.8);
  for (const d of doors) rect(d, C.door, C.ink, 1);
  for (const bl of bals) { rect(bl, (o.selected || []).includes(bl.id) ? C.pillLine : C.slab, null); if (bl.id && o.selected?.includes(bl.id)) rect({ ...bl, z0: bl.z0 - 0.15, z1: bl.z1 + 0.15 }, null, C.pillLine, 2); const y = px(0, bl.z1 + 1.1)[1], a = px(bl.x0 - X0, 0)[0], c = px(bl.x1 - X0, 0)[0]; Ln([a, y], [c, y], C.slab, 1);
    /* understøttet: en støtte tegnet under hver ende; ellers, høyt over bakken: én rolig setning under dekket, aldri et stopp */
    if (bl.support) { const yt = px(0, bl.z0)[1], yb = px(0, bl.z0 - 0.85)[1]; for (const bx of [bl.x0 + 0.2, bl.x1 - 0.9]) { const x = px(bx - X0, 0)[0]; Pg([[x, yt], [x, yb], [x + 0.7 * p, yt]], null, C.slab, 1.6); } }
    else { const g = gnd.reduce((b, q) => Math.abs(q[0] - (bl.x0 + bl.x1) / 2 + X0) < Math.abs(b[0] - (bl.x0 + bl.x1) / 2 + X0) ? q : b, gnd[0]); if (bl.z0 - g[1] > 6) T([px((bl.x0 + bl.x1) / 2 - X0, bl.z0 - 1.3)[0], px(0, bl.z0 - 1.3)[1]], `Balkongen henger fritt ${fm(bl.z0 - g[1])} m over bakken.`, { fs: 12, col: C.muted, bg: true }); }
  }
  for (const v of vols) { rect(v, C.vol, C.volLine, 2.2); const q = px((v.x0 + v.x1) / 2 - X0, v.z1); T([q[0], q[1] - 6 - (f.kind === "part" ? 22 : 0)], v.vol.name, { fs: 14, anchor: "m", bold: true, bg: true, col: C.volLine }); }
  for (let i = 1; i < gnd.length; i++) Ln(px(...gnd[i - 1]), px(...gnd[i]), C.ground, 2.4);
  /* storey lines, a name and an editable kote on the left, the heights between them on the right */
  const xr = px(tMax, 0)[0], zs = wing ? levels.filter(l => l.kote > zlo && l.kote < zhi) : [];
  const spacing = i => Math.abs(px(0, zs[i].kote)[1] - px(0, (zs[i + 1] || zs[i - 1] || { kote: zs[i].kote + 3.7 }).kote)[1]);
  const pill = (cx, cy, text, ref, label, id, fs = 14, minH = 44) => {
    const w = text.length * fs * 0.62 + 18, h = Math.min(Math.max(fs + 10, 24), 34);
    if (ref) { Pg([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]], C.pill, C.pillLine, 1.8); }
    T([cx, cy + fs * 0.35], text, { fs, anchor: "m", col: ref ? C.pillLine : C.dim, bold: !!ref });
    return { hit: ref ? [cx - Math.max(w, 44) / 2, cy - minH / 2, Math.max(w, 44), minH] : null };
  };
  zs.forEach((l, i) => {
    const y = px(0, l.kote)[1];
    Ln([mL - 4, y], [xr + 14, y], C.storey, 1, [6, 5]);
    if (spacing(i) >= 18) T([10, y + 4], l.name, { fs: 13, col: C.muted });
    const ref = { kind: "level", wing: wing.id, storey: l.name }, h = Math.min(44, Math.max(24, spacing(i)));
    const { hit } = pill(mL - 62, y, kote(l.kote), ref, `Kote for ${l.name}`, 0, 14, h);
    dims.push({ id: `kote:${l.name}`, kind: "kote", label: `Kote for ${l.name}`, value: l.kote, text: kote(l.kote), unit: "m", ref, hit, at: [mL - 62, y] });
  });
  /* the heights between the lines, the foot and the roof */
  if (wing) {
    const chain = [{ z: baseLo, name: "fot" }, ...zs.map(l => ({ z: l.kote, name: l.name })), { z: roofTop, name: "tak" }].filter((c, i, a) => i === 0 || c.z > a[i - 1].z + 0.05);
    for (let i = 1; i < chain.length; i++) {
      const a = px(0, chain[i - 1].z)[1], b = px(0, chain[i].z)[1], v = r2(chain[i].z - chain[i - 1].z), x = xr + 30;
      Ln([x - 4, a], [x + 4, a], C.dim, 1); Ln([x - 4, b], [x + 4, b], C.dim, 1); Ln([x, a], [x, b], C.dim, 1.2);
      if (Math.abs(a - b) >= 15) T([x + 8, (a + b) / 2 + 5], `${fm(v)} m`, { fs: 13, col: C.dim });
      dims.push({ id: `høyde:${chain[i - 1].name}-${chain[i].name}`, kind: "height", label: `Høyde fra ${chain[i - 1].name} til ${chain[i].name}`, value: v, text: `${fm(v)} m`, unit: "m", ref: null, hit: null, at: [x + 8, (a + b) / 2] });
    }
    T([xr + 30, px(0, roofTop)[1] - 10], `Tak ${kote(roofTop)}`, { fs: 13, col: C.muted, bold: true });
    dims.push({ id: "tak", kind: "kote", label: "Høyeste vegg (tak)", value: roofTop, text: kote(roofTop), unit: "m", ref: null, hit: null });
  }
  /* the widths: the whole, and the runs of ground-floor wall (parts) */
  const yb = px(0, zlo)[1] + 0, hdim = (t0, t1, y, text, id, label, col = C.dim, ref = null) => {
    const a = px(t0, 0)[0], b = px(t1, 0)[0];
    Ln([a, y - 6], [a, y + 6], col, 1); Ln([b, y - 6], [b, y + 6], col, 1); Ln([a, y], [b, y], col, 1.2);
    if (ref) { const { hit } = pill((a + b) / 2, y - 16, text, ref, label, id, 15); dims.push({ id, kind: "width", label, value: r2(t1 - t0), text, unit: "m", ref, hit }); }
    else { if (b - a > text.length * 8 + 6) T([(a + b) / 2, y - 6], text, { fs: 13, anchor: "m", col, bg: true }); dims.push({ id, kind: "width", label, value: r2(t1 - t0), text, unit: "m", ref: null, hit: null }); }
  };
  hdim(0, width, zbot + 62, `${fm(width)} m`, "bredde", f.kind === "wing" ? `Bredde på ${f.name}, ${side.name.toLowerCase()}` : `Bredde på ${f.name}`, C.dim);
  if (wing) {
    const runs = []; for (const w of bodies.filter(w => w.z0 <= baseLo + 0.01).sort((a, b) => a.x0 - b.x0)) { const l = runs.at(-1); if (l && w.x0 - l.x1 < 0.05 && Math.abs(w.q - l.q) < 0.3) l.x1 = Math.max(l.x1, w.x1); else runs.push({ x0: w.x0, x1: w.x1, q: w.q }); }
    if (runs.length > 1) runs.forEach((r, i) => hdim(r.x0 - X0, r.x1 - X0, zbot + 36, `${fm(r.x1 - r.x0)} m`, `del:${i + 1}`, `Del ${i + 1} av ${f.name}`));
  } else {
    const v = f.v, along = bearingOf([v.to[0] - v.from[0], v.to[1] - v.from[1]]), par = turn(along, B) % 180 > 80 && turn(along, B) % 180 < 100;   // the axis runs along this wall
    const horiz = par ? "length" : turn(along % 180, B % 180) < 10 ? "width" : null;
    hdim(0, width, zbot + 36, `${fm(width)} m`, "del:1", `Bredde på ${v.name}`, C.dim, horiz ? { kind: "volume", id: v.id, field: horiz } : null);
  }
  /* new buildings in front or on the roof: width above, height beside, both changeable where the edit exists */
  for (const vb of vols) if (f.kind === "wing" || vb.vol.id !== f.v.id || true) {
    const v = vb.vol, along = bearingOf([v.to[0] - v.from[0], v.to[1] - v.from[1]]), d = turn(along, B), horiz = Math.abs(((d + 180) % 180) - 90) < 6 ? "length" : (d % 180 < 6 || d % 180 > 174) ? "width" : null;
    const a = px(vb.x0 - X0, vb.z1), b = px(vb.x1 - X0, vb.z1), top = Math.min(a[1], b[1]) - (f.kind === "part" ? 40 : 30), c = (a[0] + b[0]) / 2;
    if (f.kind === "wing") {
      const wv = r2(vb.x1 - vb.x0), ref = horiz ? { kind: "volume", id: v.id, field: horiz } : null;
      Ln([a[0], top - 6], [a[0], top + 6], C.volLine, 1); Ln([b[0], top - 6], [b[0], top + 6], C.volLine, 1); Ln([a[0], top], [b[0], top], C.volLine, 1.2);
      const { hit } = pill(c, top - 14, `${fm(wv)} m`, ref, `Bredde på ${v.name}`, 0, 14); dims.push({ id: `ny:${v.id}:bredde`, kind: "width", label: `Bredde på ${v.name}`, value: wv, text: `${fm(wv)} m`, unit: "m", ref, hit });
    } else {
      const wv = r2(vb.x1 - vb.x0), ref = horiz ? { kind: "volume", id: v.id, field: horiz } : null; void wv; void ref; void c;
    }
    const xh = px(vb.x1 - X0, 0)[0] + 24, ya = px(0, vb.z0)[1], yb2 = px(0, vb.z1)[1], hv = r2(vb.z1 - vb.z0), ref2 = v.shape === "bim" ? null : { kind: "volume", id: v.id, field: "height" };
    Ln([xh - 5, ya], [xh + 5, ya], C.volLine, 1); Ln([xh - 5, yb2], [xh + 5, yb2], C.volLine, 1); Ln([xh, ya], [xh, yb2], C.volLine, 1.2);
    const { hit } = pill(xh + 36, (ya + yb2) / 2, `${fm(hv)} m`, ref2, `Høyde på ${v.name}`, 0, 14); dims.push({ id: `ny:${v.id}:høyde`, kind: "height", label: `Høyde på ${v.name}`, value: hv, text: `${fm(hv)} m`, unit: "m", ref: ref2, hit });
  }
  /* one window measured: width, height and sill of the one nearest the middle of the lowest row that has windows */
  let sample = null;
  if (wins.length) {
    const lowZ = Math.min(...wins.map(g => g.z0)), row = wins.filter(g => g.z0 < lowZ + 1.5), mid = (X0 + X1) / 2;
    sample = row.slice().sort((a, b) => Math.abs((a.x0 + a.x1) / 2 - mid) - Math.abs((b.x0 + b.x1) / 2 - mid))[0];
    const floor = levels.filter(l => l.kote <= sample.z0 + 0.01).at(-1)?.kote ?? baseLo, a = px(sample.x0 - X0, sample.z1), b = px(sample.x1 - X0, sample.z0), cx = (a[0] + b[0]) / 2;
    Pg([[a[0] - 3, a[1] - 3], [b[0] + 3, a[1] - 3], [b[0] + 3, b[1] + 3], [a[0] - 3, b[1] + 3]], null, C.pillLine, 2.2);
    const ww = r2(sample.x1 - sample.x0), hh = r2(sample.z1 - sample.z0), sill = r2(sample.z0 - floor), lx = x0px + 4 + (tMax - tMin) * p * 0.02;
    void cx; void lx;
    for (const [id, label, value] of [["vindu:bredde", "Vindu, bredde", ww], ["vindu:høyde", "Vindu, høyde", hh], ["vindu:brystning", "Vindu, høyde over gulv", sill]]) dims.push({ id, kind: "window", label, value, text: `${fm(value)} m`, unit: "m", ref: null, hit: null });
    const left = a[0] - mL > 236, bx = left ? mL + 8 : Math.min(W - mR - 190, Math.max(mL + 6, b[0] + 30)), by = Math.max(mT + 8, Math.min(zbot - 76, a[1] - 30));
    Pg([[bx - 8, by - 6], [bx + 214, by - 6], [bx + 214, by + 68], [bx - 8, by + 68]], C.paper, C.pillLine, 1.4); Ln(left ? [a[0] - 3, (a[1] + b[1]) / 2] : [b[0] + 3, (a[1] + b[1]) / 2], left ? [bx + 214, by + 30] : [bx - 8, by + 30], C.pillLine, 1.2);
    T([bx, by + 12], "Dette vinduet", { fs: 13, bold: true, col: C.pillLine }); T([bx, by + 30], `bredde ${fm(ww)} m`, { fs: 13 }); T([bx, by + 46], `høyde ${fm(hh)} m`, { fs: 13 }); T([bx, by + 62], `fra gulv ${fm(sill)} m`, { fs: 13 });
  }
  /* title, the counts, the scale bar */
  T([10, 24], `${f.name.toUpperCase()} · ${side.name.toUpperCase()}`, { fs: 19, bold: true });
  const R = wing ? (() => { try { return roofOf(site, wing.id); } catch { return null; } })() : null;
  const nb = bals.length, say = [wing ? `${wing.name}, ${side.name.toLowerCase()} (fasade mot ${B}°), ${fm(width)} m bred, fra kote ${kote(baseLo)} til ${kote(roofTop)}.` : `${f.name}, ${side.name.toLowerCase()}, ${fm(width)} m bred, kote ${kote(f.v.base_kote)} til ${kote(f.v.top_kote)}.`,
    wins.length ? `${wins.length} vinduer${site.facades?.some(x => x.building === wing?.id) && wins.length && !ruleOnly(site, wing, walls, n) ? " (fra arkivets tegning)" : " (etter fasaderegelen, ikke målt)"}.` : "", nb ? `${nb} balkongdekker.` : "", R ? `Taket ligger på kote ${R.levels.map(l => com(l.kote)).join(", ")}.` : ""].filter(Boolean).join(" ");
  T([10, 46], `${wins.length ? `${wins.length} vinduer` : "Ingen vinduer tegnet"}${nb ? ` · ${nb} balkonger` : ""}${vols.length && f.kind === "wing" ? ` · ${vols.length} nytt` : ""}`, { fs: 14, col: C.muted });
  { const m = [5, 10, 20, 50].find(v => v * p >= 90) || 50, x = 12, y = H - 14, L = m * p;
    Ln([x, y], [x + L, y], C.ink, 2); Ln([x, y - 5], [x, y + 5], C.ink, 2); Ln([x + L, y - 5], [x + L, y + 5], C.ink, 2); T([x + L + 8, y + 5], `${m} m`, { fs: 13, col: C.muted }); }
  return { prims, dims, W, H, p, toPx: px, toM, world, say, width_m: width, base_kote: baseLo, top_kote: roofTop, levels: zs, items: [...bals.filter(b => b.id).map(b => ({ id: b.id, kind: "balkong", x0: r2(b.x0 - X0), x1: r2(b.x1 - X0), z0: r2(b.z0), z1: r2(b.z1), storey: b.storey, depth: b.depth, built: b.built, support: !!b.support })), ...doors.filter(dd => dd.id).map(dd => ({ id: dd.id, kind: "dør", x0: r2(dd.x0 - X0), x1: r2(dd.x1 - X0), z0: r2(dd.z0), z1: r2(dd.z1) }))], windowRects: wins.map(g => ({ t0: r2(g.x0 - X0), t1: r2(g.x1 - X0), z0: r2(g.z0), z1: r2(g.z1) })), windows: wins.length, balconies: nb, volumes: vols.map(v => v.vol.id), sample, paper: C.paper, ink: C.ink,
    face: { building: f.name, wing: wing?.id ?? null, side: side.name, key: side.key, bearing: B, origin: world(0, 0).slice(0, 2), along: rv.map(v => Math.round(v * 1e4) / 1e4), out: n.map(v => Math.round(v * 1e4) / 1e4), width_m: width, base_kote: baseLo, top_kote: roofTop }, sides, focus: f.kind === "wing" ? f.w.id : f.v.id };
}
const ruleOnly = (site, wing, walls, n) => !(site.facades || []).some(fc => fc.building === wing?.id && Math.abs(dot([fc.to[0] - fc.from[0], fc.to[1] - fc.from[1]], n)) < 0.2 * Math.hypot(fc.to[0] - fc.from[0], fc.to[1] - fc.from[1]) && walls.some(w => Math.abs(dot(fc.from, n) - w.q) < 3));

/* ---------- the numbers a person may change: the same edits as try_change ---------- */
/* the number a ref names, in the model as it stands */
export function readRef(site, ref) {
  if (ref.kind === "level") { const l = (site.wings || []).find(w => w.id === ref.wing)?.levels?.find(x => x.name === ref.storey); return l ? l.kote : null; }
  if (ref.kind === "volume") {
    const v = (site.added || []).find(x => x.id === ref.id && x.kind === "volume"); if (!v) return null;
    return ref.field === "length" ? r2(Math.hypot(v.to[0] - v.from[0], v.to[1] - v.from[1])) : ref.field === "width" ? r2(v.width) : r2(v.top_kote - v.base_kote);
  }
  return null;
}
/* the edits that make a ref this number: what edits.js and design.js take (the length keeps the middle and the direction) */
export function editsFor(site, ref, value) {
  const v = Number(value); if (!Number.isFinite(v)) throw new Error("Skriv et tall.");
  if (ref.kind === "level") return [{ kind: "level", wing: ref.wing, storey: ref.storey, kote: r2(v), why: WHY }];
  if (ref.kind === "volume") {
    const a = (site.added || []).find(x => x.id === ref.id && x.kind === "volume"); if (!a) throw new Error("Fant ikke bygget.");
    if (ref.field === "width") return [{ kind: "reshape", id: a.id, width: r2(v), why: WHY }];
    if (ref.field === "height") return [{ kind: "reshape", id: a.id, height: r2(v), why: WHY }];
    const L = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]), u = [(a.to[0] - a.from[0]) / L, (a.to[1] - a.from[1]) / L], c = [(a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2], h = v / 2;
    return [{ kind: "reshape", id: a.id, from: [r2(c[0] - u[0] * h), r2(c[1] - u[1] * h)], to: [r2(c[0] + u[0] * h), r2(c[1] + u[1] * h)], why: WHY }];
  }
  throw new Error("Det tallet kan ikke endres her.");
}
/* the model with the pending edits laid over the base: every one checked the way try_change checks it; throws a sentence the person can read */
export function tryEdits(site0, floors0, base, pending) {
  let m = applyEdits(site0, floors0, base);
  const done = [];
  for (const e of pending) { done.push(checkEdit(m.site, m.floors, e));  // the tidy form, as the server keeps it
    m = applyEdits(site0, floors0, [...base, ...done]); }
  return m;
}
/* the words for one change, as they go to Anton: what, old to new */
export function sayChange(ref, was, now, site) {
  const nm = ref.kind === "level" ? (site.wings || []).find(w => w.id === ref.wing)?.name : (site.added || []).find(x => x.id === ref.id)?.name;
  if (ref.kind === "level") return `${ref.storey} i ${nm}: kote ${kote(was)} til ${kote(now)} m`;
  return `${{ length: "Lengden", width: "Bredden", height: "Høyden" }[ref.field]} på ${nm}: ${fm(was)} m til ${fm(now)} m`;
}

/* ---------- the pen: strokes in facade metres ---------- */
const COLOUR_NAME = { "#c8102e": "rød", "#1f5fbf": "blå", "#23211e": "svart" };
export function strokeWords(strokes, face) {
  return strokes.slice(0, 8).map((s, i) => {
    const t = s.pts.map(q => q[0]), z = s.pts.map(q => q[1]), a = s.pts[0], b = s.pts.at(-1);
    return `Strek ${i + 1} (${COLOUR_NAME[s.colour] || s.colour}): fra ${fm(a[0])} m fra venstre, kote ${kote(a[1])}, til ${fm(b[0])} m, kote ${kote(b[1])}; dekker ${fm(Math.min(...t))}–${fm(Math.max(...t))} m, kote ${kote(Math.min(...z))} til ${kote(Math.max(...z))}`;
  }).join("\n") + (strokes.length > 8 ? `\n(og ${strokes.length - 8} streker til; se bildet)` : "");
}
/* a stroke for the server: at most 40 points, each as site metres [east, north, kote] on the facade's plane */
export const strokeToSite = (stroke, world, colourName) => {
  const step = Math.max(1, Math.ceil(stroke.pts.length / 40)), pts = stroke.pts.filter((_, i) => i % step === 0 || i === stroke.pts.length - 1);
  return { colour: colourName, points: pts.map(([t, z]) => world(t, z)) };
};

/* ---------- the primitives as SVG, for the page ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const rgb = c => c ? `rgb(${c[0]},${c[1]},${c[2]})` : "none";
export function toSvg(d) {
  const f = v => Math.round(v * 10) / 10, out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.W} ${d.H}" width="${d.W}" height="${d.H}" font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif"><rect width="${d.W}" height="${d.H}" fill="${rgb(d.paper)}"/>`];
  for (const q of d.prims) {
    if (q.t === "line") out.push(`<line x1="${f(q.a[0])}" y1="${f(q.a[1])}" x2="${f(q.b[0])}" y2="${f(q.b[1])}" stroke="${rgb(q.col)}" stroke-width="${q.w}"${q.dash ? ` stroke-dasharray="${q.dash.join(" ")}"` : ""}/>`);
    else if (q.t === "poly") out.push(`<polygon points="${q.pts.map(a => `${f(a[0])},${f(a[1])}`).join(" ")}" fill="${rgb(q.fill)}" stroke="${rgb(q.stroke)}" stroke-width="${q.w}" stroke-linejoin="round"/>`);
    else out.push(`<text x="${f(q.p[0])}" y="${f(q.p[1])}" font-size="${q.size * 7}" fill="${rgb(q.col)}" text-anchor="${{ l: "start", m: "middle", r: "end" }[q.anchor]}"${q.bold ? ` font-weight="700"` : ""}${q.bg ? ` stroke="${rgb(q.bg)}" stroke-width="4" paint-order="stroke"` : ""}${q.rot ? ` transform="rotate(${q.rot} ${f(q.p[0])} ${f(q.p[1])})"` : ""}>${esc(q.s)}</text>`);
  }
  return out.join("") + "</svg>";
}

/* ---------- the balconies as items: a layout of one facade, and the edits that make it ---------- */
export const balconySet = B => `fasade-${B}`;
/* the layout the base has: the building's own balconies on this facade, each one a slab at one storey, as the drawing shows them */
export const initialLayout = d => d.items.filter(i => i.built).map(i => ({ id: i.id, storey: i.storey, t0: i.x0, t1: i.x1, depth: i.depth, built: true }));
/* the layout as balconies edits: «remove» takes the built-in ones off the facade, then one exact balcony each. along counts from the facade's RIGHT end
   seen from outside (design.js balconyParts measures it along the wall's own run, which goes toward the viewer's left), so t is turned: width - t */
export function layoutEdits(face, wing, layout, rev = Date.now()) {
  const set = balconySet(face.bearing), why = "balkongene lagt på fasadetegningen", base = { kind: "balconies", wing, face: face.bearing, set, rev, why };
  return [{ ...base, remove: true }, ...layout.map(it => ({ ...base, from_storey: it.storey, to_storey: it.storey, along: [r2(Math.max(0, face.width_m - it.t1)), r2(face.width_m - it.t0)], depth: it.depth, exact: true, railing: "glass", ...(it.support ? { support: true } : {}) }))];;
}
/* the layout the draft already carries for this facade (the newest rev of its set), else null */
export function layoutFromEdits(edits, face) {
  const set = balconySet(face.bearing), mine = edits.filter(e => e.kind === "balconies" && e.set === set && !e.remove), rev = Math.max(0, ...mine.map(e => e.rev ?? 0));
  const cur = mine.filter(e => (e.rev ?? 0) === rev); if (!edits.some(e => e.kind === "balconies" && e.set === set && e.remove)) return null;
  return cur.map((e, i) => ({ id: `egen:${i}:${e.from_storey}`, storey: e.from_storey, t0: r2(face.width_m - e.along[1]), t1: r2(face.width_m - e.along[0]), depth: e.depth, ...(e.support ? { support: true } : {}) }));
}

/* ---------- the doors as items: a layout of one facade, and the edits that make it (the openings edit, design.js) ---------- */
export const doorSet = B => `apninger-${B}`;
/* the layout as openings edits: the remove edit takes the person's own doors of the set away (his «Tilbakestill»), then one exact door each.
   along and window count from the facade's RIGHT end seen from outside (as the balconies edit does), so t is turned: width - t.
   win is the door's own window [t0, t1, z0, z1] in t metres; the edit carries it in along metres, so the drawing finds it again */
export function openingsEdits(face, wing, doors, rev = Date.now()) {
  const set = doorSet(face.bearing), why = "dørene lagt på fasadetegningen", base = { kind: "openings", wing, face: face.bearing, set, rev, why }, toAlong = w => [r2(Math.max(0, face.width_m - w[1])), r2(face.width_m - w[0])];
  return [{ ...base, remove: true }, ...doors.map(it => ({ ...base, along: toAlong([it.t0, it.t1]), sill: r2(it.z0), head: r2(it.z1), ...(it.win ? { window: [...toAlong([it.win[0], it.win[1]]), r2(it.win[2]), r2(it.win[3])] } : {}) }))];
}
/* the layout the draft already carries for this facade (the newest rev of its set), else null; win turned back to t metres */
export function openingsFromEdits(edits, face) {
  const set = doorSet(face.bearing), mine = edits.filter(e => e.kind === "openings" && e.set === set);
  if (!mine.some(e => e.remove === true)) return null;
  const rev = Math.max(0, ...mine.map(e => e.rev ?? 0));
  return mine.filter(e => (e.rev ?? 0) === rev && e.remove !== true).map(e => ({ id: `dør:${e.along[0]}:${e.sill}`, t0: r2(face.width_m - e.along[1]), t1: r2(face.width_m - e.along[0]), z0: e.sill, z1: e.head, ...(e.window ? { win: [r2(face.width_m - e.window[1]), r2(face.width_m - e.window[0]), e.window[2], e.window[3]] } : {}) }));
}
