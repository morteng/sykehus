/* The window bays of a facade drawn by rule, where the drawings give none (U3624): one copy for the viewer, which
   paints one bay of a facade and repeats it along every wall, and for what is set on the facade by its windows
   (balconies, one per window). A bay is BAY m wide and a storey STOREY m high, counted along the wall's line from the
   site origin (so the walls on one line share them) and up from the building's base. WINDOWS: the glass in one bay,
   [left, top, right, bottom] in metres from the bay's top left: the high-rise's pair of windows in a recessed slot, the
   low wings' ribbon of two. */
export const BAY = 2.5, STOREY = 3.5;
export const WINDOWS = { tower: [[1.22, 1.0, 1.78, 2.35], [1.9, 1.0, 2.43, 2.35]], low: [[0.06, 1.21, 1.19, 2.24], [1.31, 1.21, 2.44, 2.24]] };
/* which picture a building wears: the high-rise's over 40 m, the low wings' under */
export const kindOf = b => b.top - b.base > 40 ? "tower" : "low";
/* The storey rows (U3637): the high-rise's storeys are 3.76 m, not STOREY, and a row of windows must stand inside one storey
   (the IFC's IfcBuildingStorey), so its rows count from a floor of the wing's own, not from the building's base: the step is the
   median distance between the wing's levels (w.levels[].kote), the origin the top level's floor less whole steps down to
   the base. Without the levels (the low wings, which share one picture) the step is STOREY and the origin the base. */
export function rowsOf(kind, wing, base) {
  const ks = (wing?.levels || []).map(l => l.kote).sort((a, b) => a - b);
  if (kind !== "tower" || ks.length < 3) return { step: STOREY, org: base };
  const d = ks.slice(1).map((k, i) => k - ks[i]).sort((a, b) => a - b), step = Math.round(d[d.length >> 1] * 100) / 100;
  return { step, org: Math.round((ks.at(-1) - step * Math.floor((ks.at(-1) - base) / step)) * 100) / 100 };
}
/* the storey step a kind's picture is painted with: the tower's from its wing (site.json), the low wings' STOREY */
export const stepOf = (site, kind) => { const b = (site.buildings || []).find(x => x.wing && kindOf(x) === kind); return rowsOf(kind, (site.wings || []).find(w => w.id === b?.wing), b?.base).step; };
/* the window groups along a wall from [ax, ay] to [bx, by]: [t0, t1] metres from its start, one a bay whose windows lie
   wholly on it (the glass's left and right, the frame's 6 cm beside) */
export function windowsOn(kind, [ax, ay, bx, by]) {
  const len = Math.hypot(bx - ax, by - ay); if (len < BAY / 2) return [];
  const w = WINDOWS[kind], x0 = Math.min(...w.map(g => g[0])) - 0.06, x1 = Math.max(...w.map(g => g[2])) + 0.06;
  const along = (ax * (bx - ax) + ay * (by - ay)) / len, out = [];
  for (let k = Math.floor(along / BAY) - 1; k * BAY - along < len; k++) {
    const s = k * BAY - along, t0 = s + x0, t1 = s + x1;
    if (t0 >= 0 && t1 <= len) out.push([Math.round(t0 * 100) / 100, Math.round(t1 * 100) / 100]);
  }
  return out;
}
/* a wall that has no windows in life (site.json buildings[].blind, a list of walls [ax, ay, bx, by], e.g. Sentralblokka's south-west end): the rule gives it none */
export const blindWall = (b, wall) => (b.blind || []).some(k => k.every((v, i) => Math.abs(v - wall[i]) < 0.011));
/* a wall of a named part of a facade (site.json buildings[].parts: { name: { face, walls: [[ax, ay, bx, by]] } }): what a balconies edit's part limits it to */
export const partWall = (b, name, wall) => !!b.parts?.[name]?.walls.some(k => k.every((v, i) => Math.abs(v - wall[i]) < 0.011));
