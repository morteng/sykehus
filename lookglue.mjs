/* What Anton sees through look, beyond the kit's picture (public/renderkit/look.js, vendored and hash-locked, so the fixes
   are drawn from here): U-pics, Morten 2026-10-27 «the pictures anton takes for itself don't really show what it wants to look at».

   The kit draws only the terrain, the lot, the buildings, the new volumes (and constructions' triangles) and the trees on the
   ground. It does not know site.landscape (a lawn, a path, water), puts a tree on a roof at the ground under it (buried), and
   draws every roof level in one colour. So, in this file:
     withGarden(site)     the landscape's surfaces and paths as flat triangles at their own kote (a roof's: the page's lift over the
                          roof), the trees on a roof as cones at the roof's kote and out of the ground list
     roofLevels(site, w)  the roof pieces of one wing as thin slabs, one colour a level (roof.js's roofOf: the page's numbers)
     frame(...)           what a picture is aimed at: distance, pitch and what is picked out, from the focus' size and kind
     annotate(png, marks) the kit's PNG with a legend, the roof levels' kotes and a labelled scale bar drawn on it
     say(...)             the caption: what is in the frame, by name and kote
   If the kit one day draws these itself, withGarden and roofLevels are the lines to delete (marked «kit gap»). */
import { inflateSync, deflateSync, crc32 } from "node:zlib";
import { roofOf, roofHold } from "./public/roof.js";

const TAN = Math.tan(19 * Math.PI / 180);   // the kit's lens: 38° over the height
const com = v => String(v).replace(".", ",");
const r1 = v => Math.round(v * 10) / 10;

/* ---- kit gap 1: the garden ---- */
/* the kit colours a part by its `mat`, a key of its own palette (materials and also ground, tree, edge …) */
const SURFACE_MAT = { grass: "ground", meadow: "ground", planting: "tree", gravel: "other", paving: "own", asphalt: "edge", soil: "wood", water: "glass" };
const PATH_MAT = { gravel: "other", paving: "own", asphalt: "edge", wood: "wood" };

/* ear clipping, as the kit does (its own is not exported) */
function earcut(pts) {
  const n = pts.length; if (n < 3) return [];
  const area = pts.reduce((a, p, i) => { const q = pts[(i + 1) % n]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
  const idx = [...Array(n).keys()]; if (area < 0) idx.reverse();
  const tris = [], side = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]), inside = (p, a, b, c) => side(a, b, p) >= 0 && side(b, c, p) >= 0 && side(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 5000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const [ia, ib, ic] = [idx[(i + idx.length - 1) % idx.length], idx[i], idx[(i + 1) % idx.length]], a = pts[ia], b = pts[ib], c = pts[ic];
      if (side(a, b, c) <= 0) continue;
      if (idx.some(j => j !== ia && j !== ib && j !== ic && inside(pts[j], a, b, c))) continue;
      tris.push([ia, ib, ic]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) tris.push(idx.slice());
  return tris;
}
const open = ring => ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;

function terrainAt(site) {
  const t = site.terrain;
  return (x, y) => { const i = Math.max(0, Math.min(t.w - 1, Math.round((x - t.x0) / t.res))), j = Math.max(0, Math.min(t.h - 1, Math.round((t.y1 - y) / t.res))); return t.z[j * t.w + i] ?? 0; };
}

export function withGarden(site) {
  const land = (site.landscape || []).filter(g => g.ring?.length >= 3), roofTrees = (site.trees || []).filter(t => t[7] != null);
  if (!land.length && !roofTrees.length) return site;
  const zAt = terrainAt(site), extra = [];
  land.forEach((g, n) => {
    const roof = g.on != null && g.kote != null, ring = open(g.ring);
    /* as the page lays it (viewer.js drawLandscape): flat at the roof's kote and a hair over; on the ground a surface follows the terrain
       (here one flat level over the highest ring point: the kit has no draped surface); water at its own level */
    const lift = roof ? 0.3 + 0.02 * n + (g.kind === "path" ? 0.05 : 0) : 0.25 + 0.02 * n + (g.kind === "path" ? 0.05 : 0);   // over the level slabs (+0.12)
    const z = g.level ?? (roof ? g.kote + lift : Math.max(...ring.map(p => zAt(...p))) + lift);
    const tris = earcut(ring).map(([a, b, c]) => [[...ring[a], z], [...ring[b], z], [...ring[c], z]]);
    if (tris.length) extra.push({ id: `_lag-${g.id}`, kind: "look", name: g.name || g.id, parts: [{ axis: [ring[0], ring[1]], tris, mat: (g.kind === "path" ? PATH_MAT : SURFACE_MAT)[g.surface] || "ground" }] });
  });
  const cone = ([x, y, h = 8, r = 3, , , , kote]) => {
    const top = [x, y, kote + h], ring = [0, 1, 2, 3, 4, 5].map(k => [x + Math.cos(k * Math.PI / 3) * r, y + Math.sin(k * Math.PI / 3) * r, kote + h * 0.3]);
    return ring.map((p, k) => [p, ring[(k + 1) % 6], top]);
  };
  if (roofTrees.length) extra.push({ id: "_lag-trær", kind: "look", name: "trær på tak", parts: [{ axis: [[0, 0], [1, 0]], tris: roofTrees.flatMap(cone), mat: "tree" }] });
  return { ...site, roof_trees: roofTrees.length, added: [...(site.added || []), ...extra], trees: (site.trees || []).filter(t => t[7] == null) };
}

/* ---- kit gap 2: a wing's roof levels, one colour each ---- */
const LEVEL_MAT = [["lot", "rødt", [200, 49, 43]], ["glass", "blågrønt", [168, 216, 207]], ["wood", "brunt", [180, 138, 90]], ["steel", "grått", [142, 146, 151]], ["north", "svart", [35, 33, 30]]];
export function roofLevels(site, wing) {
  const R = wing ? roofOf(site, wing) : null; if (!R) return null;
  const levels = R.levels.map((l, i) => ({ kote: l.kote, area_m2: l.area_m2, mat: LEVEL_MAT[i % LEVEL_MAT.length][0], colour: LEVEL_MAT[i % LEVEL_MAT.length][1], rgb: LEVEL_MAT[i % LEVEL_MAT.length][2] }));
  const parts = R.blocks.map(b => {
    const l = levels.find(x => x.kote === b.kote), c = b.corners, ccw = ((c[1][0] - c[0][0]) * (c[2][1] - c[0][1]) - (c[1][1] - c[0][1]) * (c[2][0] - c[0][0])) > 0;
    const [p, q, o] = ccw ? [c[0], c[1], c[2]] : [c[1], c[0], c[3]], w = Math.hypot(o[0] - q[0], o[1] - q[1]), z0 = b.kote + 0.02;   // the slab lies on the walking-left side of its axis
    return { axis: [p, q], profile: [[0, z0], [w, z0], [w, z0 + 0.1], [0, z0 + 0.1]], mat: l.mat };
  });
  return { levels, blocks: R.blocks, entry: { id: "_takniva", kind: "look", name: "takets nivåer", parts } };
}

/* ---- what a picture is aimed at ---- */
const own = (site, f) => (site.wings || []).find(w => w.name === f?.name || w.id === f?.ids?.[0]);
const addedOf = (site, f) => (site.added || []).find(x => f?.ids?.includes(x.id));
const real = site => (site.added || []).filter(a => !a.id.startsWith("_"));

/* distance, pitch, what is picked out, and the roof levels, for a look: explicit numbers always win.
   a wing: seen whole (its size fills the picture), steep enough to see its roof, the roof levels coloured, the new parts picked out;
   a new part: close, and the new in orange with the rest toned down (the kit's accent); nothing: the site as before */
export function frame(site, a, f, v, view = {}) {
  const wing = f ? own(site, f) : null, part = f && !wing ? addedOf(site, f) : null, fresh = real(site).map(x => x.id);
  const steady = a.view_name == null || a.view_name === "isometrisk", out = { focus: fresh, accent: false, tilt: v.tilt, dist: null, target: f?.target, site, levels: null, kind: wing ? "wing" : part ? "part" : f ? "building" : "site" };
  if (wing) {
    const L = roofLevels(site, wing.id);
    if (L) { out.levels = L; out.site = { ...site, added: [...(site.added || []), L.entry] }; out.target = [f.target[0], f.target[1], Math.max(...L.levels.map(l => l.kote)) - 4]; }
    if (steady && a.tilt_deg == null && !v.plan) out.tilt = 50;
    out.dist = v.plan ? f.size * 1.6 : f.size * 1.9;
    if (!v.plan && (out.tilt ?? 30) < 30) { out.focus = [...fresh, ...f.ids]; out.picked = true; }   // from the side no roof shows: the wing itself in orange
  } else if (part || fresh.length) {
    out.accent = true;   // the new ones in the strong orange, the rest toned down
    if (part) { out.dist = v.plan ? Math.max(30, f.size * 1.8) : Math.max(35, f.size * 2.4); if (steady && a.tilt_deg == null && !v.plan) out.tilt = 40; }
    if (!f) out.dist = null;
  }
  if (f && !wing && !part) out.dist = v.plan ? f.size * 1.6 : f.size * 2.2, out.focus = f.ids;   // an old building: as before, picked out
  if (out.accent && !part && f) out.focus = [...fresh, ...f.ids];
  if (a.distance_m != null) out.dist = a.distance_m;
  out.dist = out.dist == null ? null : Math.max(30, Math.min(1200, Math.round(out.dist)));
  return out;
}

/* ---- the caption ---- */
const kote = v => com(Math.round(v * 100) / 100), SURF_NO = { grass: "gress", meadow: "eng", planting: "beplantning", gravel: "grus", paving: "belegg", asphalt: "asfalt", soil: "jord", water: "vann" };
export function say(site, fr, f, v, shown) {
  const bits = [], R = f ? own(site, f) : null;
  const near = (x, y) => !f || Math.hypot(x - fr.target[0], y - fr.target[1]) < (fr.dist || 200) * (v.plan ? 0.55 : 0.5);
  if (fr.levels) bits.push(`${R.name}${fr.picked ? " (i oransje)" : ""}: taket har ${fr.levels.levels.length} nivå${fr.levels.levels.length === 1 ? "" : "er"}, tegnet i hver sin farge: ${fr.levels.levels.map(l => `kote ${com(l.kote)} ${l.colour} (${l.area_m2} m²)`).join(", ")}`);
  else if (f && !addedOf(site, f)) bits.push(f.name);
  const parts = real(site).filter(x => !x.from || near(...x.from)).slice(0, 6).map(x => {
    const stand = x.on ? `på taket til ${(site.wings || []).find(w => w.id === x.on)?.name || x.on}` : "på bakken";
    let over = "";
    if (x.on && x.from && x.to && x.width) { const h = roofHold(site, { on: x.on, from: x.from, to: x.to, width: x.width }); if (h) over = h.overhang_m > 0.05 ? `, ${com(h.overhang_m)} m ut over takkanten` : ", innenfor takkanten"; }
    return `${x.name} (${stand}${x.base_kote != null ? `, kote ${kote(x.base_kote)}–${kote(x.top_kote ?? x.base_kote + x.height)}` : ""}${over})`;
  });
  if (parts.length) bits.push(`nye deler${shown.accent ? ", i sterk oransje mot dempede gamle bygg" : ""}: ${parts.join("; ")}`);
  const land = (site.landscape || []).filter(g => g.on || near(...g.ring[0])).slice(0, 8);
  const roofLand = land.filter(g => g.on);
  if (roofLand.length || site.roof_trees) {
    const nT = site.roof_trees || 0;
    bits.push(`på taket: ${[...roofLand.map(g => `${g.name || g.id} (${g.kind === "path" ? "sti" : SURF_NO[g.surface] || g.surface}, kote ${kote(g.kote)}, ${com(g.area_m2)} m²)`), ...(nT ? [`${nT} trær`] : [])].join("; ")}`);
  }
  const ground = land.filter(g => !g.on);
  if (ground.length) bits.push(`på bakken: ${ground.map(g => `${g.name || g.id} (${g.kind === "path" ? "sti" : SURF_NO[g.surface] || g.surface}, ${com(g.area_m2)} m²)`).join("; ")}`);
  const wings = (site.wings || []).filter(w => w.id !== R?.id).map(w => [w, (site.buildings || []).find(b => b.wing === w.id)]).filter(([, b]) => b && near(b.ring[0][0], b.ring[0][1])).map(([w]) => w.name).slice(0, 6);
  if (wings.length && f) bits.push(`ellers i bildet: ${wings.join(", ")}`);
  return bits.join(". ") + (bits.length ? "." : "");
}

/* ---- annotation: drawn on the kit's PNG ---- */
const GLYPH = { 0: "01110 10001 10011 10101 11001 10001 01110", 1: "00100 01100 00100 00100 00100 00100 01110", 2: "01110 10001 00001 00010 00100 01000 11111", 3: "11110 00001 00001 01110 00001 00001 11110",
  4: "00010 00110 01010 10010 11111 00010 00010", 5: "11111 10000 11110 00001 00001 10001 01110", 6: "00110 01000 10000 11110 10001 10001 01110", 7: "11111 00001 00010 00100 01000 01000 01000",
  8: "01110 10001 10001 01110 10001 10001 01110", 9: "01110 10001 10001 01111 00001 00010 01100", ",": "00000 00000 00000 00000 00000 00100 01000", ".": "00000 00000 00000 00000 00000 00000 00100",
  m: "00000 00000 11010 10101 10101 10101 10101", k: "10000 10000 10010 10100 11000 10100 10010", o: "00000 00000 01110 10001 10001 10001 01110", t: "01000 01000 11100 01000 01000 01001 00110",
  e: "00000 00000 01110 10001 11111 10000 01110", "-": "00000 00000 00000 11111 00000 00000 00000", " ": "00000 00000 00000 00000 00000 00000 00000" };
const FONT = Object.fromEntries(Object.entries(GLYPH).map(([k, v]) => [k, v.split(" ")]));

function decode(buf) {
  const W = buf.readUInt32BE(16), H = buf.readUInt32BE(20); let off = 8; const idat = [];
  while (off < buf.length) { const len = buf.readUInt32BE(off), type = buf.toString("ascii", off + 4, off + 8); if (type === "IDAT") idat.push(buf.subarray(off + 8, off + 8 + len)); off += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat)), px = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) { if (raw[y * (W * 3 + 1)] !== 0) throw new Error("the kit's PNG is not filter 0 any more: teach annotate()"); raw.copy(px, y * W * 3, y * (W * 3 + 1) + 1, (y + 1) * (W * 3 + 1)); }
  return { px, W, H };
}
function encode({ px, W, H }) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(px.buffer, px.byteOffset + y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}
const textW = (s, sc) => [...s].length * 6 * sc - sc;
function text(img, s, x, y, sc = 2, col = [35, 33, 30], halo = true) {
  const put = (X, Y, c) => { if (X >= 0 && Y >= 0 && X < img.W && Y < img.H) img.px.set(c, (Y * img.W + X) * 3); };
  for (const pass of halo ? [1, 0] : [0]) [...s].forEach((ch, i) => (FONT[ch] || FONT[" "]).forEach((row, ry) => [...row].forEach((bit, rx) => {
    if (bit !== "1") return; const X = x + i * 6 * sc + rx * sc, Y = y + ry * sc;
    for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) { if (pass) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) put(X + dx + a, Y + dy + b, [255, 255, 255]); else put(X + dx, Y + dy, col); }
  })));
}
const rect = (img, x0, y0, x1, y1, c) => { for (let y = Math.max(0, y0); y < Math.min(img.H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(img.W, x1); x++) img.px.set(c, (y * img.W + x) * 3); };

/* marks: { plan, dist, target, levels (roofLevels' result), width, height } → the PNG with the legend, the levels' kotes (plan) and a scale bar with numbers (plan) */
export function annotate(png, m) {
  if (!m.levels && !m.plan) return png;
  const img = decode(png), { W, H } = img;
  if (m.levels) {
    const ls = m.levels.levels, boxW = 118, boxH = 12 + ls.length * 20;
    rect(img, 8, 8, 8 + boxW, 8 + boxH, [255, 255, 255]);
    ls.forEach((l, i) => { rect(img, 14, 14 + i * 20, 32, 28 + i * 20, l.rgb); text(img, com(l.kote), 38, 14 + i * 20, 2, [35, 33, 30], false); });
    if (m.plan) {   // a kote on each level's biggest pieces
      const k = H / (2 * m.dist * TAN), P = ([x, y]) => [W / 2 + (x - m.target[0]) * k, H / 2 - (y - m.target[1]) * k], seen = new Map();
      for (const b of m.levels.blocks) { const n = seen.get(b.kote) || 0; if (n >= 2 || (n && b.length_m * b.width_m < 60)) continue; seen.set(b.kote, n + 1);
        const c = b.corners.map(P), cx = c.reduce((s, p) => s + p[0], 0) / 4, cy = c.reduce((s, p) => s + p[1], 0) / 4, s = com(b.kote);
        if (cx > 0 && cy > 0 && cx < W && cy < H && b.width_m * k > 12) text(img, s, Math.round(cx - textW(s, 2) / 2), Math.round(cy - 7), 2); }
    }
  }
  if (m.plan) {   // the kit's 50 m bar (bottom left, 5 chequers) gets its numbers; a bar longer than the picture is replaced by a nice one
    const L = Math.round(50 * H / (2 * m.dist * TAN) / 2 * 2) / 2;
    if (L <= W - 60) { text(img, "0", 14, H - 12, 1); text(img, "25", 20 + Math.round(L / 2) - 5, H - 12, 1); text(img, "50 m", 20 + Math.round(L) - 8, H - 12, 1); }
    else { rect(img, 0, H - 24, W, H - 14, [255, 255, 255]); const k = H / (2 * m.dist * TAN), nice = [1, 2, 5, 10, 20, 25].filter(n => n * k < W / 2).pop() || 1, len = Math.round(nice * k);
      rect(img, 8, H - 56, 30 + len + textW(`${nice} m`, 2), H - 6, [255, 255, 255]); rect(img, 20, H - 34, 20 + len, H - 28, [35, 33, 30]); rect(img, 19, H - 36, 21, H - 26, [35, 33, 30]); rect(img, 19 + len, H - 36, 21 + len, H - 26, [35, 33, 30]);
      text(img, "0", 14, H - 22, 2, undefined, false); text(img, `${nice} m`, 24 + len, H - 36, 2, undefined, false); }
  }
  return encode(img);
}
