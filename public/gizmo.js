/* Selection and the gizmo for a flat drawing, input in and events out (Morten 2026-10-28: «a much better gizmo, selection system … use
   that basic system but tuned for this purpose and general archviz»). Pure: no DOM, no canvas. The Fasade view feeds it pointer
   points in metres and draws what it answers; the 3D viewer can take it the same way.

   What is Fab's and the kit's, reused and not copied:
     renderkit/select.js   choose (add or replace, a shift tap toggles) and windowTest (a window takes what is wholly inside, left to
                           right, or what it crosses, right to left): the same rules as the 3D picker
     renderkit/infer.js    inferPoint: the endpoint, midpoint and edge a dragged point catches, on items' outlines as rings
     kit/typein.js         parseTyped: a typed «2,5», «25 cm» is the same number a drag makes
   What is written here: the elevation's own snaps (storey line, alignment with a neighbour, equal spacing, 0,1 m grid) with plain
   Norwegian names, the handles, a drag as a new rectangle, and align, distribute and array.

   An item is { id, kind, x0, x1, z0, z1 } in metres of the facade (x along it, z the kote). A rect is the same without id. */
import { choose, windowTest } from "./renderkit/select.js";
import { inferPoint } from "./renderkit/infer.js";
import { parseTyped } from "./kit/typein.js";
export { choose, parseTyped };

export const SNAP_WORDS = { storey: "etasjeskille", endpoint: "hjørne", midpoint: "midtpunkt", edge: "kant", align: "i flukt med", equal: "lik avstand", grid: "rutenett 0,1 m", corner: "hjørne på bygget" };
const r2 = v => Math.round(v * 100) / 100 + 0, GRID = 0.1;
const area = r => (r.x1 - r.x0) * (r.z1 - r.z0);

/* what a tap at p takes: the smallest item under it (within slack metres, the finger's size), or nothing */
export function pickAt(items, p, slack = 0) {
  return items.filter(i => p[0] >= i.x0 - slack && p[0] <= i.x1 + slack && p[1] >= i.z0 - slack && p[1] <= i.z1 + slack).sort((a, b) => area(a) - area(b))[0] || null;
}
/* the window from a to b (metres): left to right takes what lies wholly inside (solid), right to left what it crosses (dashed). Fab's windowTest on each item's outline */
export function marquee(items, a, b) {
  const inside = b[0] >= a[0], r = { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) };
  const project = (x, y) => ({ x, y });
  return { inside, dashed: !inside, keys: items.filter(i => windowTest([i.x0, i.z0, 0, i.x1, i.z0, 0, i.x1, i.z0, 0, i.x1, i.z1, 0, i.x1, i.z1, 0, i.x0, i.z1, 0, i.x0, i.z1, 0, i.x0, i.z0, 0], r, inside, project)).map(i => i.id) };
}
/* every item of one kind on one storey, or in one column (the card's «Velg alle …») */
export const selectAll = (items, kind, by = {}) => items.filter(i => i.kind === kind && (by.storey == null || i.storey === by.storey) && (by.col == null || (i.x0 + i.x1) / 2 >= by.col[0] && (i.x0 + i.x1) / 2 <= by.col[1])).map(i => i.id);

/* ---- snaps ---- */
const edgesX = r => [["kant", r.x0], ["kant", r.x1], ["midt", (r.x0 + r.x1) / 2]];
/* what a rectangle moved to `want` catches, the nearest of each kind per axis, in this order: a storey line, a building corner, a neighbour's edge or middle, equal spacing, the grid.
   ctx: { levels: [kote], corners: [x], others: [rect], tol (metres), off (Alt or Ctrl: no snap) } → { rect, snaps: [{ axis, kind, word, at }] } */
export function snapMove(want, ctx = {}) {
  const tol = ctx.tol ?? 0.25, w = want.x1 - want.x0, h = want.z1 - want.z0, snaps = [];
  if (ctx.off) return { rect: want, snaps };
  let dx = 0, dz = 0, zDone = false, xDone = false;
  /* z: the top or the underside on a storey line, else a neighbour's top or underside */
  const zs = [...(ctx.levels || []).map(k => ["storey", k]), ...(ctx.others || []).flatMap(o => [["align", o.z0], ["align", o.z1]])];
  let best = null; const pass = (kinds) => { for (const [kind, k] of zs.filter(z => kinds.includes(z[0]))) for (const e of kind === "storey" ? [want.z1] : [want.z0, want.z1]) { const d = k - e; if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, kind, k }; } };
  pass(["storey"]); if (!best) pass(["align"]);   // a storey line wins over a neighbour
  if (best) { dz = best.d; zDone = true; snaps.push({ axis: "z", kind: best.kind, word: SNAP_WORDS[best.kind], at: best.k }); }
  /* x: a building corner, a neighbour's edge or middle, then equal spacing */
  const xs = [...(ctx.corners || []).map(c => ["corner", c]), ...(ctx.others || []).flatMap(o => [["align", o.x0], ["align", o.x1], ["align", (o.x0 + o.x1) / 2]])];
  best = null; for (const [kind, k] of xs) for (const e of [want.x0, want.x1, (want.x0 + want.x1) / 2]) { const d = k - e; if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, kind, k }; }
  if (best) { dx = best.d; xDone = true; snaps.push({ axis: "x", kind: best.kind, word: SNAP_WORDS[best.kind], at: best.k }); }
  else {
    const row = (ctx.others || []).filter(o => Math.abs(o.z1 - (want.z1 + dz)) < 0.05).sort((a, b) => a.x0 - b.x0), gaps = row.slice(1).map((o, i) => o.x0 - row[i].x1).filter(g => g > 0.05);
    for (const o of row) for (const g of gaps) { const left = o.x1 + g, right = o.x0 - g - w; for (const [x0, at] of [[left, o.x1], [right, o.x0]]) if (Math.abs(x0 - want.x0) <= tol) { if (!best || Math.abs(x0 - want.x0) < Math.abs(best.d)) best = { d: x0 - want.x0, kind: "equal", k: at, gap: g }; } }
    if (best) { dx = best.d; xDone = true; snaps.push({ axis: "x", kind: "equal", word: `${SNAP_WORDS.equal} ${String(r2(best.gap)).replace(".", ",")} m`, at: best.k }); }
  }
  if (!zDone) { dz = Math.round(want.z0 / GRID) * GRID - want.z0; snaps.push({ axis: "z", kind: "grid", word: SNAP_WORDS.grid }); }
  if (!xDone) { dx = Math.round(want.x0 / GRID) * GRID - want.x0; snaps.push({ axis: "x", kind: "grid", word: SNAP_WORDS.grid }); }
  return { rect: { x0: r2(want.x0 + dx), x1: r2(want.x0 + dx + w), z0: r2(want.z0 + dz), z1: r2(want.z0 + dz + h) }, snaps };
}
/* a single dragged point (the edge a handle pulls) catches Fab's endpoint, midpoint and edge on the others' outlines, a storey line, else the grid */
export function snapPoint(p, ctx = {}) {
  if (ctx.off) return { p, snaps: [] };
  const tol = ctx.tol ?? 0.25, k = (ctx.levels || []).find(l => Math.abs(l - p[1]) <= tol);
  const q = k != null ? [p[0], k] : p;
  const rings = (ctx.others || []).map(o => [[o.x0, o.z0], [o.x1, o.z0], [o.x1, o.z1], [o.x0, o.z1]]);
  const hit = inferPoint(q, { rings, reach: tol, grid: GRID, kinds: ["endpoint", "midpoint", "edge", "grid"] });
  const kind = hit.kind === "grid" ? "grid" : hit.kind, out = hit.p || q;
  return { p: [r2(out[0]), r2(k != null && hit.kind === "grid" ? k : out[1])], snaps: [{ kind: k != null && hit.kind === "grid" ? "storey" : kind, word: SNAP_WORDS[k != null && hit.kind === "grid" ? "storey" : kind] }] };
}

/* ---- the gizmo ---- */
export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
/* the handles on a rect, as points in metres; px: the drawing's pixels per metre. touch is bigger: a finger or a pen's palm needs 44 px, a mouse 24 */
export function handlesOf(rect, px, touch = false) {
  const size = touch ? 44 : 24, at = { nw: [rect.x0, rect.z1], n: [(rect.x0 + rect.x1) / 2, rect.z1], ne: [rect.x1, rect.z1], e: [rect.x1, (rect.z0 + rect.z1) / 2], se: [rect.x1, rect.z0], s: [(rect.x0 + rect.x1) / 2, rect.z0], sw: [rect.x0, rect.z0], w: [rect.x0, (rect.z0 + rect.z1) / 2] };
  return HANDLES.map(h => ({ handle: h, at: at[h], hit_m: size / px, size, kind: h.length === 2 ? "hjørne" : "kant" }));
}
export const handleAt = (hs, p) => hs.map(h => [h, Math.hypot(h.at[0] - p[0], h.at[1] - p[1])]).filter(([h, d]) => d <= h.hit_m / 2).sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
/* a drag of a handle to p: the rect with that edge or corner at p (at least 0,3 m each way) */
export function resizeRect(rect, handle, p, min = 0.3) {
  const r = { ...rect };
  if (handle.includes("w")) r.x0 = Math.min(p[0], r.x1 - min); if (handle.includes("e")) r.x1 = Math.max(p[0], r.x0 + min);
  if (handle.includes("s")) r.z0 = Math.min(p[1], r.z1 - min); if (handle.includes("n")) r.z1 = Math.max(p[1], r.z0 + min);
  return { x0: r2(r.x0), x1: r2(r.x1), z0: r2(r.z0), z1: r2(r.z1) };
}
export const moveRect = (rect, dx, dz) => ({ x0: r2(rect.x0 + dx), x1: r2(rect.x1 + dx), z0: r2(rect.z0 + dz), z1: r2(rect.z1 + dz) });
/* the live words of the one-line HUD */
export const hudText = (r, snaps = []) => `bredde ${String(r2(r.x1 - r.x0)).replace(".", ",")} m · fra venstre ${String(r2(r.x0)).replace(".", ",")} m · topp kote ${String(r2(r.z1)).replace(".", ",")}${snaps.length ? ` · ${snaps.map(s => s.word).join(", ")}` : ""}`;

/* a rect that a drag ended with, as the balcony layout item it is (fasade.js): the storey is the level its top is on, the position and width are the rect's. The same function a typed number goes through */
export function layoutItemOf(item, rect, levels) {
  const l = levels.reduce((b, x) => Math.abs(x.kote - rect.z1) < Math.abs(b.kote - rect.z1) ? x : b, levels[0]);
  return { ...item, storey: l.name, t0: rect.x0, t1: rect.x1 };
}
/* a typed number on the one selected item: «bredde», «fra venstre», «dybde» (text as the person writes it: 2,5 or 250 cm) */
export function typedItem(item, field, text) {
  const v = parseTyped(text, "m"); if (v == null || v < 0) return null;
  if (field === "bredde") return v >= 0.5 ? { ...item, t1: r2(item.t0 + v) } : null;
  if (field === "venstre") return { ...item, t1: r2(v + (item.t1 - item.t0)), t0: r2(v) };
  if (field === "dybde") return v >= 0.8 && v <= 4 ? { ...item, depth: r2(v) } : null;
  return null;
}
/* align, distribute, array: on items (x0, x1, z0, z1) → the changed rects by id */
export function alignItems(items, how) {
  const t = how === "venstre" ? Math.min(...items.map(i => i.x0)) : how === "høyre" ? Math.max(...items.map(i => i.x1)) : how === "topp" ? Math.max(...items.map(i => i.z1)) : Math.min(...items.map(i => i.z0));
  return items.map(i => ({ id: i.id, ...(how === "venstre" ? moveRect(i, t - i.x0, 0) : how === "høyre" ? moveRect(i, t - i.x1, 0) : how === "topp" ? moveRect(i, 0, t - i.z1) : moveRect(i, 0, t - i.z0)) }));
}
export function distribute(items) {   // equal gaps between the items along x, the first and the last stay
  const s = items.slice().sort((a, b) => a.x0 - b.x0); if (s.length < 3) return s.map(i => ({ id: i.id, ...i }));
  const free = (s.at(-1).x0 - s[0].x1) - s.slice(1, -1).reduce((a, i) => a + (i.x1 - i.x0), 0), gap = free / (s.length - 1); let x = s[0].x1 + gap;
  return s.map((i, k) => { if (k === 0 || k === s.length - 1) return { id: i.id, x0: i.x0, x1: i.x1, z0: i.z0, z1: i.z1 }; const r = moveRect(i, x - i.x0, 0); x = r.x1 + gap; return { id: i.id, ...r }; });
}
export const arrayOf = (item, n, gap, dir = "x") => Array.from({ length: n }, (_, k) => dir === "x" ? moveRect(item, (k + 1) * (item.x1 - item.x0 + gap), 0) : moveRect(item, 0, (k + 1) * gap));
