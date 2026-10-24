/* Builds public/data/site.json, the site model the viewer draws: the lot, the buildings with their heights, the terrain.

  node tools/site.mjs <lot.json> <dom.tif> <dtm.tif> <x0,y0,x1,y1> [osm.json]

  lot.json   a hagekart project doc (its lot.ring and address), or {ring: [[lng, lat], ...]}
  dom/dtm    Kartverket laser surface and terrain, Float32 GeoTIFF on EPSG:25833 covering the box x0..x1, y0..y1
  osm.json   an Overpass answer (out geom) to use instead of asking Overpass

Coordinates in site.json are metres east and north of origin (EPSG:25833, rounded to whole metres), heights metres above
sea level (NN2000). A building's base is the lowest terrain at its corners and its top the median of the upper half of the
laser surface over it (roof plant and chimneys above that are left out), leaving out the building:parts on it (cut). */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildingFeatures } from "./osm-buildings.mjs";

const [lotFile, domFile, dtmFile, boxArg, osmFile] = process.argv.slice(2);
if (!boxArg) { console.error("usage: node tools/site.mjs <lot.json> <dom.tif> <dtm.tif> <x0,y0,x1,y1> [osm.json]"); process.exit(2); }
const [X0, Y0, X1, Y1] = boxArg.split(",").map(Number);

/* EPSG:4326 to EPSG:25833 (UTM 33N, GRS80): the series in Snyder, Map Projections (1987), good to millimetres here */
function utm33([lon, lat]) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, e2 = f * (2 - f), ep = e2 / (1 - e2);
  const phi = lat * Math.PI / 180, lam = (lon - 15) * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = ep * Math.cos(phi) ** 2, A = Math.cos(phi) * lam;
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi) + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  return [k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep) * A ** 5 / 120) + 500000,
    k0 * (M + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep) * A ** 6 / 720))];
}

/* an uncompressed Float32 TIFF, in strips or tiles */
function readTiff(path) {
  const b = readFileSync(path), le = b[0] === 0x49, u16 = o => le ? b.readUInt16LE(o) : b.readUInt16BE(o), u32 = o => le ? b.readUInt32LE(o) : b.readUInt32BE(o);
  const ifd = u32(4), n = u16(ifd), tags = {};
  for (let i = 0; i < n; i++) {
    const o = ifd + 2 + i * 12, tag = u16(o), type = u16(o + 2), cnt = u32(o + 4), sz = type === 3 ? 2 : 4, at = cnt * sz > 4 ? u32(o + 8) : o + 8;
    if (type === 3 || type === 4) tags[tag] = Array.from({ length: cnt }, (_, k) => type === 3 ? u16(at + k * 2) : u32(at + k * 4));
  }
  if ((tags[259]?.[0] ?? 1) !== 1) throw new Error(`${path}: compressed TIFF, ask for compression=None`);
  const w = tags[256][0], h = tags[257][0], out = new Float32Array(w * h), f32 = o => le ? b.readFloatLE(o) : b.readFloatBE(o);
  if (tags[273]) { let k = 0; for (const [o, c] of tags[273].map((o, i) => [o, tags[279][i]])) for (let j = 0; j < c && k < w * h; j += 4) out[k++] = f32(o + j); }
  else {
    const tw = tags[322][0], th = tags[323][0], across = Math.ceil(w / tw);
    tags[324].forEach((o, i) => { const tx = (i % across) * tw, ty = Math.floor(i / across) * th; for (let y = 0; y < th && ty + y < h; y++) for (let x = 0; x < tw && tx + x < w; x++) out[(ty + y) * w + tx + x] = f32(o + (y * tw + x) * 4); });
  }
  return { w, h, v: out };
}

const inRing = ([x, y], r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [a, b] = r[i], [e, f] = r[j]; if ((b > y) !== (f > y) && x < (e - a) * (y - b) / (f - b) + a) c = !c; } return c; };
const area = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(s / 2); };
const median = v => { const s = v.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };

const lot = JSON.parse(readFileSync(lotFile, "utf8")), lotLL = lot.lot?.ring || lot.ring, lotU = lotLL.map(utm33);
const dom = readTiff(domFile), dtm = readTiff(dtmFile);
if (dom.w !== dtm.w || dom.h !== dtm.h) throw new Error("DOM and DTM grids differ");
const G = { w: dom.w, h: dom.h, res: (X1 - X0) / dom.w };
const cellOf = (x, y) => { const c = Math.floor((x - X0) / G.res), r = Math.floor((Y1 - y) / G.res); return c < 0 || r < 0 || c >= G.w || r >= G.h ? -1 : r * G.w + c; };
const ok = v => v > -1000;

/* the lot's box plus 60 m, in lng/lat for Overpass */
const xs = lotU.map(p => p[0]), ys = lotU.map(p => p[1]);
const lng = lotLL.map(p => p[0]), lat = lotLL.map(p => p[1]), pad = 0.0009;
let osm;
if (osmFile) osm = JSON.parse(readFileSync(osmFile, "utf8"));
else {
  const [s, w, n, e] = [Math.min(...lat) - pad / 2, Math.min(...lng) - pad, Math.max(...lat) + pad / 2, Math.max(...lng) + pad];
  const q = `[out:json][timeout:25];(way[building](${s},${w},${n},${e});relation[building](${s},${w},${n},${e});way["building:part"](${s},${w},${n},${e}););out geom;`;
  const r = await fetch("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(q), { headers: { "user-agent": "sykehus.gulden.no site builder (morten)" } });
  if (!r.ok) throw new Error(`Overpass ${r.status}`);
  osm = await r.json();
}
const feats = buildingFeatures(osm.elements).features;

const origin = [Math.round((Math.min(...xs) + Math.max(...xs)) / 2), Math.round((Math.min(...ys) + Math.max(...ys)) / 2)];
const loc = ([x, y]) => [+(x - origin[0]).toFixed(2), +(y - origin[1]).toFixed(2)];
const buildings = [];
for (const f of feats) {
  const ring = f.geometry.coordinates[0].map(utm33), cut = (f.properties.cut || []).map(r => r.map(utm33));
  const bx = ring.map(p => p[0]), by = ring.map(p => p[1]);
  if (Math.max(...bx) < X0 || Math.min(...bx) > X1 || Math.max(...by) < Y0 || Math.min(...by) > Y1) continue;   // off the laser grid
  const tops = [], grounds = [];
  for (let y = Math.min(...by) + G.res / 2; y < Math.max(...by); y += G.res) for (let x = Math.min(...bx) + G.res / 2; x < Math.max(...bx); x += G.res) {
    if (!inRing([x, y], ring) || cut.some(r => inRing([x, y], r))) continue;
    const k = cellOf(x, y); if (k < 0 || !ok(dom.v[k]) || !ok(dtm.v[k])) continue;
    if (dom.v[k] - dtm.v[k] > 2) tops.push(dom.v[k]);
  }
  for (const p of ring) { const k = cellOf(...p); if (k >= 0 && ok(dtm.v[k])) grounds.push(dtm.v[k]); }
  if (!grounds.length) continue;
  const base = Math.min(...grounds), up = tops.sort((a, b) => a - b).slice(tops.length >> 1), top = median(up);
  const centre = [bx.reduce((a, b) => a + b, 0) / bx.length, by.reduce((a, b) => a + b, 0) / by.length];
  buildings.push({
    id: String(f.properties.osm), osm: f.properties.osm, type: f.properties.building, part: f.properties.part || undefined,
    own: inRing(centre, lotU) || undefined, ring: ring.map(loc), cut: cut.length ? cut.map(r => r.map(loc)) : undefined,
    base: +base.toFixed(2), top: top != null && top - base > 2 ? +top.toFixed(2) : null, osmHeight: f.properties.height || undefined, levels: f.properties.levels || undefined,
    area_m2: Math.round(area(ring)),
  });
}

/* terrain and laser surface at 2 m, heights to the decimetre; the surface as the median of each 2 x 2 m block (roof edges stay sharp) */
const step = Math.max(1, Math.round(2 / G.res)), tw = Math.floor(G.w / step), th = Math.floor(G.h / step), tv = new Array(tw * th), sv = new Array(tw * th);
for (let r = 0; r < th; r++) for (let c = 0; c < tw; c++) {
  const v = dtm.v[(r * step) * G.w + c * step]; tv[r * tw + c] = ok(v) ? +v.toFixed(1) : null;
  const blk = []; for (let dr = 0; dr < step; dr++) for (let dc = 0; dc < step; dc++) { const d = dom.v[(r * step + dr) * G.w + c * step + dc]; if (ok(d)) blk.push(d); }
  const m = median(blk); sv[r * tw + c] = m == null ? null : +m.toFixed(1);
}

const site = {
  v: 1, made: new Date().toISOString().slice(0, 10), name: "Gamle Drammen sykehus", address: lot.address?.label || null,
  crs: "EPSG:25833", origin, heights: "NN2000",
  lot: { ring: lotU.map(loc), area_m2: Math.round(area(lotU)) },
  buildings,
  terrain: { x0: X0 - origin[0], y1: Y1 - origin[1], res: G.res * step, w: tw, h: th, z: tv, surface: sv },
  sources: ["Kartverket laser (hoydedata.no), DOM/DTM 1 m", "OpenStreetMap contributors (ODbL), building outlines", "Kartverket matrikkel, lot outline"],
};
mkdirSync(new URL("../public/data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/data/site.json", import.meta.url), JSON.stringify(site));
const own = buildings.filter(b => b.own);
console.log(`${buildings.length} buildings (${own.length} on the lot), terrain ${tw}x${th}; tallest on the lot:`, own.filter(b => b.top).sort((a, b) => (b.top - b.base) - (a.top - a.base)).slice(0, 4).map(b => `${b.id} ${(b.top - b.base).toFixed(1)} m`).join(", "));
