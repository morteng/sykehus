/* Builds public/data/floors.json, the floors the viewer can show one at a time: each drawing in tools/plans.json read
   for its walls (pdfpaths.py), placed on the site from its control points (georef.py), and stacked at its level.
   A sheet with "like": "<id>" shares that sheet's background; its control points are the other's moved by the page
   offset between the two (sheetshift.py), so one careful placement serves the whole set.

  node tools/floors.mjs <folder with the drawings (PDF)> <work folder>

The walls are the drawing's grey-filled shapes, in site metres; the viewer stands them from kote to kote + height.
The rooms are the drawing's stamps (rooms.py): name, area as the architect wrote it, room code, and where the stamp
stands (its left edge at the name's baseline).
Python runs isolated (-I): the drawings are downloaded files, read as data. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [pdfDir, work] = process.argv.slice(2);
if (!work) { console.error("usage: node tools/floors.mjs <folder with the drawings> <work folder>"); process.exit(2); }
const tools = new URL(".", import.meta.url).pathname, site = new URL("../public/data/site.json", import.meta.url).pathname;
const { plans } = JSON.parse(readFileSync(new URL("plans.json", import.meta.url), "utf8"));
mkdirSync(work, { recursive: true });

const grey = c => (c.length === 1 || c.length === 3) && c.every(v => Math.abs(v - c[0]) < 0.02) && c[0] > 0.4 && c[0] < 0.9;
const floors = [];
for (const p of plans) {
  const paths = `${work}/${p.id}.json`, geoF = `${work}/${p.id}-geo.json`;
  execFileSync("python3", ["-I", tools + "pdfpaths.py", `${pdfDir}/${p.file}`, String(p.page), paths], { stdio: "inherit" });
  let cp = p.cp;
  if (p.like) {
    const ref = plans.find(q => q.id === p.like), { offset: [dx, dy] } = JSON.parse(execFileSync("python3", ["-I", tools + "sheetshift.py", `${work}/${ref.id}.json`, paths], { encoding: "utf8" }));
    cp = ref.cp.split(";").map(c => { const [x, y, sx, sy] = c.split(",").map(Number); return [(x + dx).toFixed(2), (y + dy).toFixed(2), sx, sy].join(","); }).join(";");
  }
  execFileSync("python3", ["-I", tools + "georef.py", paths, site, String(p.scale), geoF], { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, CP: cp, CPONLY: "1", SEEDONLY: "1" } });
  const geo = JSON.parse(readFileSync(geoF, "utf8")), c = Math.cos(geo.theta), s = Math.sin(geo.theta), m = geo.m_per_pt;
  /* site = (page * m) @ [[cos, sin], [-sin, cos]] + shift, as georef.py writes it */
  const toSite = ([x, y]) => [+(x * m * c - y * m * s + geo.shift[0]).toFixed(2), +(x * m * s + y * m * c + geo.shift[1]).toFixed(2)];
  const walls = JSON.parse(readFileSync(paths, "utf8")).shapes.filter(sh => sh.k !== "stroke" && grey(sh.fill)).flatMap(sh => sh.p.map(r => r.map(toSite)));
  const roomsF = `${work}/${p.id}-rooms.json`;
  execFileSync("python3", ["-I", tools + "rooms.py", `${pdfDir}/${p.file}`, String(p.page), roomsF], { stdio: ["ignore", "ignore", "inherit"] });
  const rooms = JSON.parse(readFileSync(roomsF, "utf8")).map(r => ({ name: r.name, area_m2: r.area_m2 ?? undefined, code: r.code ?? undefined, at: toSite(r.at) }));
  floors.push({ id: p.id, name: p.name, wing: p.wing, kote: p.kote, height: p.height, source: p.source, walls, rooms });
  console.log(`${p.id}: ${walls.length} walls, ${rooms.length} rooms (${rooms.filter(r => r.area_m2).length} with an area), scale fitted 1:${geo.scale_fitted}, rotation ${geo.rotation_deg}°`);
}
writeFileSync(new URL("../public/data/floors.json", import.meta.url), JSON.stringify({ v: 1, floors }));
