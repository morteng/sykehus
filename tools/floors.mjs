/* Builds public/data/floors.json, the floors the viewer can show one at a time: each drawing in tools/plans.json read
   for its walls (pdfpaths.py), placed on the site from its control points (georef.py), and stacked at its level.
   A sheet with "like": "<id>" shares that sheet's background; its control points are the other's moved by the page
   offset between the two (sheetshift.py), so one careful placement serves the whole set.

  PYTHON=<python with PyMuPDF> node tools/floors.mjs <folder with the drawings (PDF)[:another folder ...]> <work folder>

The walls are the drawing's grey-filled shapes, in site metres; the viewer stands them from kote to kote + height.
A sheet drawn in lines, not fills ("walls": "lines", the fire plans) has its walls paired from its lines
(linewalls.py, within "region" on the page). Several sheets may draw one storey, each the wings it shows best:
"keep" keeps only what stands in those wings, "leave" leaves those out (site.json buildings by wing, 1 m round).
The rooms are the drawing's stamps (rooms.py): name, area as the architect wrote it, room code, and where the stamp
stands (its left edge at the name's baseline).
Python runs isolated (-I): the drawings are downloaded files, read as data. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [pdfDirs, work] = process.argv.slice(2), PY = process.env.PYTHON || "python3";
if (!work) { console.error("usage: node tools/floors.mjs <folder with the drawings> <work folder>"); process.exit(2); }
const tools = new URL(".", import.meta.url).pathname, site = new URL("../public/data/site.json", import.meta.url).pathname;
const { plans } = JSON.parse(readFileSync(new URL("plans.json", import.meta.url), "utf8"));
mkdirSync(work, { recursive: true });

const pdfOf = f => pdfDirs.split(":").map(d => `${d}/${f}`).find(existsSync) || `${pdfDirs.split(":")[0]}/${f}`;
const inRing = ([x, y], r) => { let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [a, b] = r[i], [e, f] = r[j]; if ((b > y) !== (f > y) && x < (e - a) * (y - b) / (f - b) + a) o = !o; } return o; };
const near = (p, r, d) => inRing(p, r) || r.some((q, i) => { const n = r[(i + 1) % r.length], dx = n[0] - q[0], dy = n[1] - q[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / L)); return Math.hypot(p[0] - q[0] - t * dx, p[1] - q[1] - t * dy) < d; });
const siteJ = JSON.parse(readFileSync(site, "utf8")), ringsOf = ws => siteJ.buildings.filter(b => ws.includes(b.wing)).map(b => b.ring);
const centre = r => [r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length];
const grey = c => (c.length === 1 || c.length === 3) && c.every(v => Math.abs(v - c[0]) < 0.02) && c[0] > 0.4 && c[0] < 0.9;
const floors = [];
for (const p of plans) {
  const paths = `${work}/${p.id}.json`, geoF = `${work}/${p.id}-geo.json`;
  if (p.walls === "lines") execFileSync(PY, ["-I", tools + "linewalls.py", pdfOf(p.file), String(p.page), String(p.scale), paths, ...(p.region ? [p.region.join(",")] : [])], { stdio: "inherit" });
  else execFileSync("python3", ["-I", tools + "pdfpaths.py", pdfOf(p.file), String(p.page), paths], { stdio: "inherit" });
  let cp = p.cp;
  if (p.like) {
    const ref = plans.find(q => q.id === p.like), { offset: [dx, dy] } = JSON.parse(execFileSync("python3", ["-I", tools + "sheetshift.py", `${work}/${ref.id}.json`, paths], { encoding: "utf8" }));
    cp = ref.cp.split(";").map(c => { const [x, y, sx, sy] = c.split(",").map(Number); return [(x + dx).toFixed(2), (y + dy).toFixed(2), sx, sy].join(","); }).join(";");
  }
  execFileSync("python3", ["-I", tools + "georef.py", paths, site, String(p.scale), geoF], { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, CP: cp, CPONLY: "1", SEEDONLY: "1" } });
  const geo = JSON.parse(readFileSync(geoF, "utf8")), c = Math.cos(geo.theta), s = Math.sin(geo.theta), m = geo.m_per_pt;
  /* site = (page * m) @ [[cos, sin], [-sin, cos]] + shift, as georef.py writes it */
  const toSite = ([x, y]) => [+(x * m * c - y * m * s + geo.shift[0]).toFixed(2), +(x * m * s + y * m * c + geo.shift[1]).toFixed(2)];
  const keepR = p.keep && ringsOf(p.keep), leaveR = p.leave && ringsOf(p.leave);
  const mine = pt => (!keepR || keepR.some(r => near(pt, r, 1))) && (!leaveR || !leaveR.some(r => near(pt, r, 0.3)));
  const walls = JSON.parse(readFileSync(paths, "utf8")).shapes.filter(sh => sh.k !== "stroke" && grey(sh.fill)).flatMap(sh => sh.p.map(r => r.map(toSite))).filter(r => mine(centre(r)));
  const roomsF = `${work}/${p.id}-rooms.json`;
  if (p.rooms !== false) execFileSync("python3", ["-I", tools + "rooms.py", pdfOf(p.file), String(p.page), roomsF], { stdio: ["ignore", "ignore", "inherit"] });
  const rooms = p.rooms === false ? [] : JSON.parse(readFileSync(roomsF, "utf8")).map(r => ({ name: r.name, area_m2: r.area_m2 ?? undefined, code: r.code ?? undefined, at: toSite(r.at) })).filter(r => mine(r.at));
  floors.push({ id: p.id, name: p.name, wing: p.wing, kote: p.kote, height: p.height, source: p.source, walls, rooms });
  console.log(`${p.id}: ${walls.length} walls, ${rooms.length} rooms (${rooms.filter(r => r.area_m2).length} with an area), scale fitted 1:${geo.scale_fitted}, rotation ${geo.rotation_deg}°`);
}
writeFileSync(new URL("../public/data/floors.json", import.meta.url), JSON.stringify({ v: 1, floors }));
