/* Biomes: what ground a lot is by default, and what a bed fills itself with. Pure, in UTM metres; the UI (brush.js) shows the result.
   A bed made as "rose bed" gets plants placed for it. The layout is seeded, so the same bed and seed give the same plants.
   A plant placed by a biome carries `gen: <area id>`; the moment a person touches it the tag goes and it is theirs (pinned). */

/* The ground where nothing is drawn. `c` is the map colour, `c3` the 3D ground. Left unset a lot is lawn, as it always was. */
export const BASE = {
  lawn: { no: "Plen", c: "#dfe8cf", c3: "#cfdcb8" }, paving: { no: "Belegning", c: "#dcd8d0", c3: "#cfcac0" }, gravel: { no: "Grus", c: "#e0d5ba", c3: "#d2c6a6" },
  wild: { no: "Villnis", c: "#cdd9ae", c3: "#bcc99a" }, plastic: { no: "Duk", c: "#c3ccd0", c3: "#aeb9bd" },
};
export const baseOf = d => BASE[d?.lot?.base] || BASE.lawn;
/* Bed types: which species, and how many of each kind to a handful. `w` is a weight. Species ids are from plants.json. */
export const BIOMES = {
  roser: { no: "Roser", species: [{ pid: "poppius", w: 3 }, { pid: "gloriadei", w: 2 }] },
  stauder: { no: "Stauder", species: [{ pid: "pion", w: 2 }, { pid: "hosta", w: 2 }, { pid: "bergenia", w: 2 }, { pid: "ridderspore", w: 1 }, { pid: "akeleie", w: 1 }, { pid: "kattemynte", w: 2 }, { pid: "solhatt", w: 1 }] },
  groent: { no: "Grønt og bær", species: [{ pid: "jordbaer", w: 4 }, { pid: "rabarbra", w: 1 }, { pid: "solbaer", w: 1 }] },
};
export const MAX_POINTS = 400;

const pointInRing = ([x, y], ring) => { let o = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [a, b] = ring[i], [c, d] = ring[j]; if ((b > y) !== (d > y) && x < ((c - a) * (y - b)) / (d - b) + a) o = !o; } return o; };   // no import: the server reads this file too

/* mulberry32: a small seeded generator. */
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const distToRing = (p, ring) => {
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
  }
  return best;
};

/* Plants for an area.
   ring, holes: UTM, closed. kinds: [{ pid, sp (spacing in m), w }]. density 1 = each plant at its own spacing; 0.5 = twice as far apart.
   pinned: [{ x, y, sp }] plants already there (kept, and kept clear of). Returns [{ pid, x, y }]: only the new ones.
   No two plants closer than the mean of their spacings, none nearer the edge than 0.4 of their spacing, none in a hole.
   Best-candidate placement: each plant is the best of a few random spots, so the bed fills evenly instead of in clumps. */
export function populate({ ring, holes = [], kinds, density = 1, seed = 1, pinned = [], tries = 14, max = MAX_POINTS }) {
  if (!ring || ring.length < 4 || !kinds?.length) return [];
  const rnd = rng(seed), k = 1 / Math.max(0.2, density);
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const total = kinds.reduce((s, q) => s + q.w, 0), used = kinds.map(() => 0), placed = pinned.map(p => ({ x: p.x, y: p.y, sp: p.sp })), out = [];
  const pick = () => {   // the kind furthest below its share, so the mix stays even; ties go to chance
    let best = 0, gap = -Infinity;
    kinds.forEach((q, i) => { const g = q.w / total - used[i] / Math.max(1, out.length) + rnd() * 0.15; if (g > gap) { gap = g; best = i; } });
    return best;
  };
  let misses = 0;
  while (out.length < max && misses < 40) {
    const ki = pick(), q = kinds[ki], sp = q.sp * k;
    let bestC = null, bestSlack = -Infinity;
    for (let t = 0; t < tries; t++) {
      const c = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)];
      if (!pointInRing(c, ring) || holes.some(h => pointInRing(c, h))) continue;
      const m = 0.4 * sp; if (distToRing(c, ring) < m || holes.some(h => distToRing(c, h) < m)) continue;
      let slack = Infinity;
      for (const o of placed) { const need = (sp + o.sp) / 2, d = Math.hypot(c[0] - o.x, c[1] - o.y); if (d - need < slack) slack = d - need; if (slack < 0) break; }
      if (slack < 0) continue;
      if (slack > bestSlack) { bestSlack = slack; bestC = c; }
    }
    if (!bestC) { misses++; continue; }
    misses = 0; used[ki]++; placed.push({ x: bestC[0], y: bestC[1], sp }); out.push({ pid: q.pid, x: bestC[0], y: bestC[1] });
  }
  return out;
}

/* The kinds of a bed type, with spacing from the plant list. */
export const kindsOf = (type, plants) => (BIOMES[type]?.species || []).map(s => ({ pid: s.pid, w: s.w, sp: plants[s.pid]?.sp || 0.8 })).filter(q => plants[q.pid]);
