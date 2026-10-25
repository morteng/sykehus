/* The traced scans (trace.js files, kept in tools/traces/) into public/data/floors.json: each trace's walls and room
   stamps moved from the sheet's points to the site by its control points, as a floor "spor-<id>" at its kote.
   Run after floors.mjs (which writes floors.json from the vector drawings alone) and before roompoly.py; running it
   again replaces the traced floors it put there.

  node tools/trace-import.mjs [tools/traces] */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fitOf } from "../public/trace.js";

const dir = process.argv[2] || new URL("traces", import.meta.url).pathname;
const file = new URL("../public/data/floors.json", import.meta.url), data = JSON.parse(readFileSync(file, "utf8"));
const r2 = v => Math.round(v * 100) / 100;
const site = JSON.parse(readFileSync(new URL("../public/data/site.json", import.meta.url), "utf8"));
const inRing = ([x, y], r) => { let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [a, b] = r[i], [e, f] = r[j]; if ((b > y) !== (f > y) && x < (e - a) * (y - b) / (f - b) + a) o = !o; } return o; };
const near = (p, r, d) => inRing(p, r) || r.some((q, i) => { const n = r[(i + 1) % r.length], dx = n[0] - q[0], dy = n[1] - q[1], L = dx * dx + dy * dy || 1, k = Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / L)); return Math.hypot(p[0] - q[0] - k * dx, p[1] - q[1] - k * dy) < d; });
const centre = r => [r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length];
data.floors = data.floors.filter(f => !f.id.startsWith("spor-"));
for (const name of readdirSync(dir).filter(n => n.endsWith(".json")).sort()) {
  const t = JSON.parse(readFileSync(`${dir}/${name}`, "utf8"));
  if (!(t.cp?.length >= 2)) { console.error(`${name}: needs two control points (cp); skipped`); continue; }
  const fit = fitOf(t.cp), to = p => fit.to(p).map(r2);
  /* what the sheet draws of other buildings stays out: only walls within 1 m of the trace's own building */
  const rings = site.buildings.filter(b => (t.wing && b.wing === t.wing) || (t.building && b.id === t.building)).map(b => b.ring);
  const mine = p => !rings.length || rings.some(r => near(p, r, 1));
  const walls = (t.walls || []).map(r => r.map(to)).filter(r => mine(centre(r))), rooms = (t.rooms || []).map(r => ({ name: r.name, area_m2: r.area_m2 ?? undefined, code: r.code ?? undefined, at: to(r.at) })).filter(r => mine(r.at));
  data.floors.push({ id: `spor-${t.id}`, name: t.storey, wing: t.wing || t.building, kote: t.kote, height: t.height, how: t.how || undefined,
    source: `${t.title}, sporet${t.placement ? " (" + t.placement + " plassert)" : ""}${t.traced ? "; " + t.traced : ""}`, walls, rooms });
  console.log(`${name}: ${walls.length} of ${t.walls.length} walls on the building, ${rooms.length} rooms, 1 pt = ${(fit.scale * 100).toFixed(2)} cm (1:${Math.round(fit.scale / (25.4 / 72 / 1000))}), rotation ${(fit.angle * 180 / Math.PI).toFixed(2)}°`);
}
writeFileSync(file, JSON.stringify(data));
