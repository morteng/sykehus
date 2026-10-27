/* A railing round a roof level's edge (Anton's wish 2026-10-27, «høyt glassgjerde rundt takkanten»): the straight railing part, laid in pieces along the edge of one
   roof level (about_wing roof.edges), each at that level's kote by the foot rule (roof.js: on + align free puts the foot on the level that holds the piece).
   Pure: it makes the `part` edits; mcp.mjs's try_change takes them as if Anton had sent each. The part is straight and at most `maxLen` m (gulden-worker's
   parts.json «railing»: length 0.5 to 60), so a long edge is cut into equal pieces, and a piece starts where the last one ends, so the corners are closed. */
import { levelRingsOf, roofKotes } from "./roof.js";

const r2 = v => Math.round(v * 100) / 100 + 0, com = v => String(v).replace(".", ",");
const MIN_PIECE = 1;   // a part is placed over at least 1 m (design.js: from -> to between 1 and 250)

/* a ring (the filled side on the left) with its edges moved d m to the left (d < 0: out); corners are the offset lines' meeting, bevelled when a corner would shoot out */
export function offsetRing(ring, d) {
  const n = ring.length, nm = ring.map((a, i) => { const b = ring[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [-dy / L, dx / L]; });
  return ring.map((p, i) => {
    const n0 = nm[(i + n - 1) % n], n1 = nm[i], a = [p[0] + n0[0] * d, p[1] + n0[1] * d], b = [p[0] + n1[0] * d, p[1] + n1[1] * d], cr = n0[0] * n1[1] - n0[1] * n1[0];
    if (Math.abs(cr) < 1e-6) return b;   // straight on
    const d0 = [n0[1], -n0[0]], d1 = [n1[1], -n1[0]], den = d0[0] * d1[1] - d0[1] * d1[0], sv = ((b[0] - a[0]) * d1[1] - (b[1] - a[1]) * d1[0]) / den, q = [a[0] + d0[0] * sv, a[1] + d0[1] * sv];
    return Math.hypot(q[0] - p[0], q[1] - p[1]) > 4 * Math.abs(d) + 0.01 ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : q;
  });
}

/* edge_rail { wing, level, height_m?, inset_m?, infill?, edges?, name?, id?, maxLen? } -> { parts: [part edits], say, ... } */
export function edgeRail(site, w, o, wingName = w.name) {
  const level = Number(String(o.level).replace(",", ".")), kotes = roofKotes(site, w.id);
  if (!Number.isFinite(level)) throw new Error(`level er taknivåets kote (about_wing roof.levels): ${kotes.map(com).join(", ")}`);
  const rings = levelRingsOf(site, w.id, level);
  if (!rings.length) throw new Error(`${wingName} har ikke tak på kote ${com(level)}; takene ligger på ${kotes.map(com).join(", ")}`);
  const height = o.height_m == null ? 1.1 : Number(o.height_m), inset = o.inset_m == null ? 0.15 : Number(o.inset_m), infill = o.infill == null ? "glass" : String(o.infill), all = o.edges === "all", maxLen = o.maxLen || 60;
  if (!(height >= 0.8 && height <= 1.5)) throw new Error("height_m er rekkverkets høyde, 0,8 til 1,5 m");
  if (!(inset >= 0 && inset <= 5)) throw new Error("inset_m er hvor langt inn fra kanten rekkverket står, 0 til 5 m (0,15 er en stolpe på kanten)");
  if (!["glass", "bars"].includes(infill)) throw new Error("infill er glass eller bars");
  const k = rings[0].kote, base = String(o.id || "nkant").replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "nkant", name = String(o.name || "Takrekkverk").slice(0, 60);
  const lines = [];   // [from, to] of each edge, the offset ones; skipped: what was left out
  let smoothed = 0, walls = 0, tiny = 0;
  for (const g of rings) {
    let vs = g.ring.map((p, i) => ({ p: p.slice(), wall: g.edges[i].wall }));   // each vertex with whether the edge leaving it is a wall
    /* a step under 1 m (the outline's small notches) is smoothed to its middle: a part is at least 1 m, and a gap there would leave the corner open */
    for (let again = true; again && vs.length > 3;) {
      again = false;
      for (let i = 0; i < vs.length; i++) { const j = (i + 1) % vs.length, a = vs[i].p, b = vs[j].p; if (Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_PIECE) {
        vs[i] = { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], wall: vs[j].wall }; vs.splice(j, 1); smoothed++; again = true; break; } }
    }
    const pts = vs.map(v => v.p), wall = vs.map(v => v.wall);
    const off = offsetRing(pts, inset);
    pts.forEach((_, i) => { if (wall[i] && !all) { walls++; return; } const a = off[i], b = off[(i + 1) % off.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < MIN_PIECE) { tiny++; return; } lines.push([a, b, L]); });
  }
  const parts = []; let total = 0;
  for (const [a, b, L] of lines) {
    const n = Math.ceil(L / maxLen - 1e-9), len = L / n;
    for (let j = 0; j < n; j++) {
      const p = t => [r2(a[0] + (b[0] - a[0]) * t), r2(a[1] + (b[1] - a[1]) * t)];
      parts.push({ kind: "part", part: "railing", from: p(j / n), to: p((j + 1) / n), params: { length: r2(len), height, infill }, on: w.id, align: "free", allow_overlap: true });
      total += len;
    }
  }
  if (!parts.length) throw new Error(`Taknivået kote ${com(k)} på ${wingName} har ingen kant å legge rekkverk langs (${walls} kanter står mot et høyere tak; edges: "all" legger langs dem også)`);
  parts.forEach((e, i) => Object.assign(e, { id: `${base}${i + 1}`, name: `${name} ${i + 1}/${parts.length}`, why: `rekkverk langs kanten av taknivået kote ${com(k)}` }));
  return { parts, total_m: r2(total), say: `Rekkverk langs kanten av taknivået kote ${com(k)} på ${wingName}: ${parts.length} deler, ${com(Math.round(total * 10) / 10)} m, ${com(height)} m høyt (${infill === "glass" ? "glass" : "spiler"}), ${com(inset)} m inn fra kanten, hver del på kote ${com(k)} etter fotregelen`
    + (walls && !all ? `; ${walls} kanter mot et høyere tak er utelatt (der er det ikke fall)` : "") + (smoothed ? `; ${smoothed} trinn under 1 m i kanten er jevnet ut` : "") + (tiny ? `; ${tiny} deler under 1 m er utelatt` : "") + "." };
}
