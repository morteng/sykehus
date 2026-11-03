/* What one draft may ask of the page (U3644): more parts and textures slow a phone, so the draft has caps and the low tier
   draws what is left in few objects.
   PART_CAP   the most parts (one slab, one railing, its ends, a support: each a part) the new things of one draft hold
              together; applyDesign stops a balconies edit at it and says so, checkDesign refuses one that is over alone
   MERGE_ABOVE above this many parts a tier that carries pictures draws them merged too
   DRAW_BUDGET the most objects (meshes and lines) the new things of a draft cost on the low tier: one a material
   Merged: the parts of a group with the same material are one mesh, flat colour, no glass outline lines. */
export const PART_CAP = 3000, MERGE_ABOVE = 800, DRAW_BUDGET = 16;

export const partsOf = added => (added || []).reduce((n, a) => n + (a.parts?.length || 0), 0);
export const balconiesOf = added => (added || []).reduce((n, a) => n + (a.kind === "balconies" ? a.count || 0 : 0), 0);

/* how many parts of a draft that already holds `have` a new batch of `n` may add; the rest does not stand */
export const room = (have, n) => Math.max(0, Math.min(n, PART_CAP - have));
export const capSay = (n, kept) => `Taket på ${PART_CAP.toLocaleString("nb-NO")} deler per forslag er nådd: ${kept} av ${n} deler er satt opp, resten står ikke (færre balkonger, eller færre etasjer, gjør siden lettere å laste).`;

export const merges = (tier, parts) => !!tier?.merge || parts > MERGE_ABOVE;

/* the parts of one group by material: Map(material → [part]) in first-seen order */
export function byMaterial(parts) {
  const m = new Map();
  for (const p of parts) { const k = p.mat || "concrete"; if (!m.has(k)) m.set(k, []); m.get(k).push(p); }
  return m;
}
/* the objects a group costs: merged, one a material; not merged, one a part and a line set for each glass part */
export function drawCost(parts, merged) {
  if (merged) return byMaterial(parts).size;
  return parts.length + parts.filter(p => p.mat === "glass").length;
}
