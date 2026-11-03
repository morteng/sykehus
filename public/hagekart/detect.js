/* Automatic detection of what is already on a lot, from open Norwegian data.

   - Height: Kartverket's national height model (DOM = surface, DTM = terrain) via
     WCS. DOM - DTM = height above ground. Trees, hedges and shrubs come from it.
   - Colour: aerial imagery sampled onto the same grid. Low + green = lawn,
     low + grey = paving.
   - Buildings come from OpenStreetMap (via our API); tall flat blobs are a fallback.

   All work happens on a grid in EPSG:25833 (UTM 33N), so distances are metres. */

import { pointInRing, smoothPath, pathRing } from "../renderkit/paths2d.js";   // moved to renderkit (U3530): the street drawing shares them
export { pointInRing, smoothPath, pathRing };

/* global proj4 */
const UTM = "+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs";
export const toUtm = ([lon, lat]) => proj4("EPSG:4326", UTM, [lon, lat]);
export const toLngLat = ([x, y]) => proj4(UTM, "EPSG:4326", [x, y]);

const WCS = {
  dom: ["https://wcs.geonorge.no/skwms1/wcs.hoyde-dom-nhm-25833", "nhm_dom_topo_25833"],
  dtm: ["https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833", "nhm_dtm_topo_25833"],
};

/* ---------- GeoTIFF (uncompressed float32, strips or tiles) ---------- */
export function parseTiff(buf) {
  const dv = new DataView(buf);
  const le = dv.getUint16(0) === 0x4949;
  const u16 = o => dv.getUint16(o, le), u32 = o => dv.getUint32(o, le);
  if (u16(2) !== 42) throw new Error("Not a classic TIFF");
  const ifd = u32(4), n = u16(ifd), tags = {};
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const size = { 3: 2, 4: 4 }[type] || 1;
    const at = count * size > 4 ? u32(e + 8) : e + 8;
    const vals = [];
    if (type === 3 || type === 4) for (let k = 0; k < count; k++) vals.push(type === 3 ? u16(at + k * 2) : u32(at + k * 4));
    tags[tag] = vals;
  }
  const w = tags[256][0], h = tags[257][0];
  if ((tags[259]?.[0] ?? 1) !== 1) throw new Error("Compressed TIFF not supported");
  if ((tags[258]?.[0] ?? 32) !== 32) throw new Error("Expected float32 TIFF");
  const out = new Float32Array(w * h);
  const readF = (o, k) => dv.getFloat32(o + k * 4, le);
  if (tags[324]) {                      // tiled
    const tw = tags[322][0], th = tags[323][0], across = Math.ceil(w / tw);
    tags[324].forEach((off, i) => {
      const x0 = (i % across) * tw, y0 = Math.floor(i / across) * th;
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const X = x0 + x, Y = y0 + y;
        if (X < w && Y < h) out[Y * w + X] = readF(off, y * tw + x);
      }
    });
  } else {                              // stripped
    const rps = tags[278]?.[0] ?? h;
    tags[273].forEach((off, s) => {
      const rows = Math.min(rps, h - s * rps);
      for (let k = 0; k < rows * w; k++) out[s * rps * w + k] = readF(off, k);
    });
  }
  return { w, h, data: out };
}

/* Heights: the newest laser project from hoydedata.no at 0.25 m first (Oslo, most
   towns), the national 1 m model where no project covers the lot. */
const HOYDEDATA = { dom: "Prosjekt_DOM", dtm: "Prosjekt_DTM" };
/* Laser heights, quickest source first: this browser's own copy (IndexedDB), our server's
   cache (api/heights, fetched once per lot for everybody), hoydedata.no directly (30 s to
   connect, often slower), and the national 1 m model when the laser has no answer. */
async function fetchHeights(kind, g) {
  const key = `n2:${kind}:${g.x0},${g.y0},${g.x1},${g.y1}:${g.w},${g.h}`;   // n: newest scan (server)
  const kept = await idbGet(key);
  if (kept && kept.data?.length === g.w * g.h) return kept;
  const got = await fetchHeightsFresh(kind, g);
  if (got.src === "hoydedata") idbPut(key, got);     // a fallback is not kept: next time may do better
  return got;
}
async function fetchHeightsFresh(kind, g) {
  const bbox = [g.x0, g.y0, g.x1, g.y1].join(","), size = `${g.w},${g.h}`;
  const laser = t => {
    if (t.w !== g.w || t.h !== g.h) throw new Error("size mismatch");
    let missing = 0; for (const v of t.data) if (!(v > -100)) missing++;
    if (missing > t.data.length * 0.1) throw new Error("not covered");
    return { data: t.data, src: "hoydedata" };
  };
  let direct = true;
  try {
    const r = await fetch(`api/heights?kind=${kind}&bbox=${bbox}&size=${size}&v=2`);   // v: newest-scan answers
    if (r.ok) {
      let scan = null; try { scan = JSON.parse(decodeURIComponent(r.headers.get("x-scan") || "null")); } catch {}
      return { ...laser(parseTiff(await r.arrayBuffer())), scan };
    }
    direct = r.status !== 502;                         // 502: our server tried hoydedata and failed; else an older server
    throw new Error("server HTTP " + r.status);
  } catch (e) {
    if (!direct || e.message === "not covered") { console.info(`hoydedata ${kind}: ${e.message}; using the national 1 m model`); return { data: await fetchCoverage(kind, g), src: "nhm", why: nhmWhy(e.message) }; }
  }
  try {
    // @ts-ignore inferred too narrowly (tuples, growing objects)
    const q = new URLSearchParams({
      bbox, bboxSR: 25833, imageSR: 25833, size,
      format: "tiff", pixelType: "F32", noData: -9999, compression: "None", interpolation: "RSP_BilinearInterpolation", f: "image",
    });
    const r = await fetch(`https://hoydedata.no/arcgis/rest/services/${HOYDEDATA[kind]}/ImageServer/exportImage?${q}`);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return laser(parseTiff(await r.arrayBuffer()));
  } catch (e) {
    console.info(`hoydedata ${kind}: ${e.message}; using the national 1 m model`);
    return { data: await fetchCoverage(kind, g), src: "nhm", why: nhmWhy(e.message) };
  }
}
/* Why the 25 cm laser was not used, in words for the status text (CLAUDE.md: never settle for a fallback silently). */
export const nhmWhy = message => message === "not covered" ? "laserdata (25 cm) dekker ikke tomta" : `hoydedata.no svarte ikke (${String(message).slice(0, 60)})`;
/* The reason to show when the heights are not the laser ones; null when they are. */
export const heightWhy = (D, T) => D.src === "hoydedata" && T.src === "hoydedata" ? null : D.why || T.why || "høydedata fra laser var ikke tilgjengelig";

/* A small IndexedDB store for height grids: the 40 latest, at most half a year old. Every
   call tolerates a browser without storage (private mode, blocked site data). */
let idbP = null;
function idb() {
  return idbP ||= new Promise((ok, fail) => {
    const rq = indexedDB.open("hagekart", 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore("heights");
    rq.onsuccess = () => ok(rq.result); rq.onerror = () => fail(rq.error);
  }).catch(() => null);
}
async function idbGet(key) {
  try {
    const d = await idb(); if (!d) return null;
    const v = await new Promise((ok, fail) => { const rq = d.transaction("heights").objectStore("heights").get(key); rq.onsuccess = () => ok(rq.result); rq.onerror = () => fail(rq.error); });
    return v && Date.now() - v.at < 180 * 864e5 ? v : null;
  } catch { return null; }
}
async function idbPut(key, { data, src, scan = null }) {
  try {
    const d = await idb(); if (!d) return;
    const st = d.transaction("heights", "readwrite").objectStore("heights");
    st.put({ data, src, scan, at: Date.now() - (scan ? 0 : 173 * 864e5) }, key);   // without scan facts: a week, then ask again
    const all = await new Promise(ok => { const out = []; const c = st.openCursor(); c.onsuccess = () => { const cur = c.result; if (!cur) return ok(out); out.push([cur.key, cur.value.at]); cur.continue(); }; c.onerror = () => ok(out); });
    all.sort((x, y) => y[1] - x[1]).slice(40).forEach(([k]) => st.delete(k));
  } catch {}
}

/* The national model has stray cells (seen: 2 564 m beside the sea at Bygdøy). A cell more
   than 25 m off the median of its 7×7 neighbourhood is dropped and filled from its neighbours;
   only cells with a 10 m step to a neighbour are tested, so this stays cheap. */
export function despike(g, a) {
  const ok = v => v > -100 && v < 3000, out = Float32Array.from(a, v => ok(v) ? v : NaN), bad = [];
  for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) {
    const i = r * g.w + c, v = out[i];
    if (Number.isNaN(v)) { bad.push(i); continue; }
    const step = [c > 0 ? i - 1 : i, c < g.w - 1 ? i + 1 : i, r > 0 ? i - g.w : i, r < g.h - 1 ? i + g.w : i].some(j => !(Math.abs(out[j] - v) <= 10));
    if (!step) continue;
    const nb = [];
    for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < g.h && cc < g.w && !Number.isNaN(out[rr * g.w + cc])) nb.push(out[rr * g.w + cc]); }
    nb.sort((x, y) => x - y);
    if (Math.abs(v - nb[nb.length >> 1]) > 25) bad.push(i);
  }
  for (const i of bad) out[i] = NaN;
  for (let pass = 0, left = bad.length; left && pass < 60; pass++) {
    left = 0; const prev = out.slice();
    for (const i of bad) {
      if (!Number.isNaN(prev[i])) continue;
      const r = (i / g.w) | 0, c = i % g.w; let sum = 0, n = 0;
      for (const j of [c > 0 ? i - 1 : -1, c < g.w - 1 ? i + 1 : -1, r > 0 ? i - g.w : -1, r < g.h - 1 ? i + g.w : -1]) if (j >= 0 && !Number.isNaN(prev[j])) { sum += prev[j]; n++; }
      if (n) out[i] = sum / n; else left++;
    }
  }
  return Float32Array.from(out, v => Number.isNaN(v) ? -9999 : v);
}

/* The surface around the lot for sun and shade (sun.js): `pad` metres of neighbours and
   slope on every side, since a tall tree or a hillside 30 m away shades the garden too. */
export async function fetchSurface(ringUtm, pad = 35) {
  const g = makeGrid(ringUtm, pad);
  /* ?debug&flat: a level grid with no network call, so street and furniture tests do not wait for Høydedata. */
  if (typeof location !== "undefined" && /[?&]flat\b/.test(location.search) && /[?&]debug\b/.test(location.search)) {
    const N = g.w * g.h, z = new Float32Array(N); return { g, surf: z, ground: z.slice(), src: "flat (debug)", ridge: null, scan: null };
  }
  const [D, T, ridge] = await Promise.all([fetchHeights("dom", g), fetchHeights("dtm", g), fetchRidgeMask(g).catch(() => null)]);
  let dom = D.data, dtm = T.data;
  if (D.src !== T.src) { dom = D.src === "nhm" ? D.data : await fetchCoverage("dom", g); dtm = T.src === "nhm" ? T.data : await fetchCoverage("dtm", g); }
  const N = g.w * g.h, surf = new Float32Array(N), ground = new Float32Array(N);
  dtm = despike(g, dtm); dom = despike(g, dom);
  let fallback = 0, n = 0; for (let i = 0; i < N; i++) if (dtm[i] > -100 && dtm[i] < 3000) { fallback += dtm[i]; n++; }
  fallback = n ? fallback / n : 0;
  for (let i = 0; i < N; i++) {
    const b = dtm[i] > -100 && dtm[i] < 3000 ? dtm[i] : fallback, a = dom[i] > -100 && dom[i] < 3000 ? dom[i] : b;
    ground[i] = b; surf[i] = Math.max(a, b);
  }
  return { g, surf, ground, src: D.src, ridge, scan: D.src === "hoydedata" ? D.scan || null : null };
}

/* Building footprints (FKB quality) from Kartverket's open INSPIRE WMS, drawn onto our
   grid. Grey fill is building; the thin dark line between neighbours keeps them apart. */
async function fetchBuildingMask(g) {
  const q = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetMap", LAYERS: "BU.Building", STYLES: "", CRS: "EPSG:25833",
    BBOX: [g.x0, g.y0, g.x1, g.y1].join(","), WIDTH: g.w, HEIGHT: g.h, FORMAT: "image/png", TRANSPARENT: "TRUE",
  });
  const img = await loadImg("https://wms.geonorge.no/skwms1/wms.inspire_bu?" + q);
  const cv = document.createElement("canvas"); cv.width = g.w; cv.height = g.h;
  const ctx = cv.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, g.w, g.h).data, N = g.w * g.h;
  const fill = new Uint8Array(N), any = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (px[i * 4 + 3] > 100) { any[i] = 1; if (px[i * 4] > 70) fill[i] = 1; }
  return { fill, any };
}

/* Roof ridge lines (mønelinje) from Kartverket's open FKB map, drawn onto our grid. The vector
   data needs a login, but the map service draws any FKB line class we ask for with SLD_BODY
   (tested 2026-09-29: 0.5 s, CORS open). Ridges fix a roof's direction in roof.js. */
async function fetchRidgeMask(g) {
  const sld = `<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"><NamedLayer><Name>bygningsavgrensning</Name><UserStyle><FeatureTypeStyle><Rule><ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>fromtable</ogc:PropertyName><ogc:Literal>monelinje</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter><LineSymbolizer><Stroke><CssParameter name="stroke">#ff0000</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke></LineSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
  const q = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetMap", LAYERS: "bygningsavgrensning", STYLES: "", CRS: "EPSG:25833",
    BBOX: [g.x0, g.y0, g.x1, g.y1].join(","), WIDTH: g.w, HEIGHT: g.h, FORMAT: "image/png", TRANSPARENT: "TRUE", SLD_BODY: sld,
  });
  const img = await loadImg("https://wms.geonorge.no/skwms1/wms.fkb?" + q);
  const cv = document.createElement("canvas"); cv.width = g.w; cv.height = g.h;
  const ctx = cv.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, g.w, g.h).data, m = new Uint8Array(g.w * g.h);
  for (let i = 0; i < m.length; i++) if (px[i * 4 + 3] > 60) m[i] = 1;
  return m;
}

/* Known public roads are not garden: no lawn, paving or bed can be on the carriageway or the
   pavement. NVDB (Statens vegvesen) has the measured carriageway (dekke, with its real width) and
   the pavement (fortau) as lines; OSM fills in where NVDB has none. Driveways and footpaths stay
   out of the mask: the owner's own paving is real paving, and a park promenade is not a road.
   Returns corridor rings in UTM, ready for rasterize().
   Detection itself now masks with known.js (rasterKnown) instead; this stays for tools/clip-roads.mjs,
   the one-off repair for documents analysed before known geometry, and for tests/roads.test.mjs. */
const ROAD_W = { motorway: 12, motorway_link: 6, trunk: 10, trunk_link: 6, primary: 9, primary_link: 5, secondary: 8, secondary_link: 5, tertiary: 7, tertiary_link: 5, unclassified: 6, residential: 6, living_street: 5, pedestrian: 6 };
export function roadCorridors(osm, nv) {
  const lines = f => f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [];
  const rings = [];
  for (const f of nv?.features || []) {
    const p = f.properties || {};
    /* fortau lines run along the pavement's axis or far edge, so cover both readings of the width */
    const w = p.t === "dekke" ? (+p.Dekkebredde || +p["Dekkebredde, maks"] || 6) : p.t === "fortau" ? 2 * (+p["Bredde, gjennomsnitt"] || 2) : 0;
    if (!(w > 0)) continue;
    for (const ln of lines(f)) { const r = pathRing(ln.map(toUtm), w + 1, 2); if (r.length > 3) rings.push(r); }
  }
  for (const f of osm?.features || []) {
    const p = f.properties || {};
    /* footway=sidewalk/crossing is street furniture even though it is a footway; a pedestrian area
       (plaza) is drawn as a ring, not a centre line, so its "corridor" would be nonsense */
    const walk = p.footway === "sidewalk" || p.footway === "crossing", w = walk ? 2.5 : ROAD_W[p.highway];
    if (!w || p.area === "yes" || (p.highway === "pedestrian" && !p.name && !p.maxspeed)) continue;
    const width = (+p.est_width || +p.width || w) + (walk ? 1 : 2);
    for (const ln of lines(f)) { const r = pathRing(ln.map(toUtm), width, 2); if (r.length > 3) rings.push(r); }
  }
  return rings;
}

/* The public roads around a lot, from our cached OSM and NVDB endpoints (the same pair the 3D
   street model is built from). Fails soft: without them detection still runs, it may just read the
   road as paving. */
export async function fetchRoads(ringUtm) {
  const g = makeGrid(ringUtm, 35);
  const [w, s] = toLngLat([g.x0, g.y0]), [e, n] = toLngLat([g.x1, g.y1]);
  const q = [s, w, n, e].map(v => v.toFixed(6)).join(",");
  const get = u => fetch(u).then(r => r.ok ? r.json() : { features: [] }).catch(() => ({ features: [] }));
  const [osm, nv] = await Promise.all([get(`api/streets?bbox=${q}`), get(`api/nvdb?bbox=${q}`)]);
  return roadCorridors(osm, nv);
}

async function fetchCoverage(kind, g) {
  const [url, cov] = WCS[kind];
  const q = new URLSearchParams({
    service: "WCS", version: "1.0.0", request: "GetCoverage", coverage: cov,
    crs: "EPSG:25833", bbox: [g.x0, g.y0, g.x1, g.y1].join(","),
    width: g.w, height: g.h, format: "GeoTIFF",
  });
  const r = await fetch(`${url}?${q}`);
  if (!r.ok) throw new Error(`Height data ${kind}: HTTP ${r.status}`);
  const t = parseTiff(await r.arrayBuffer());
  if (t.w !== g.w || t.h !== g.h) throw new Error("Height grid size mismatch");
  return t.data;
}

/* ---------- Grid helpers ---------- */
export function makeGrid(ringUtm, pad = 6) {
  const xs = ringUtm.map(p => p[0]), ys = ringUtm.map(p => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 2 * pad;
  const res = span <= 250 ? 0.5 : span <= 400 ? 1 : 2;   // keep grids under ~160k cells
  const x0 = Math.floor(Math.min(...xs) - pad), y0 = Math.floor(Math.min(...ys) - pad);
  const x1 = Math.ceil(Math.max(...xs) + pad), y1 = Math.ceil(Math.max(...ys) + pad);
  return { x0, y0, x1, y1, res, w: Math.round((x1 - x0) / res), h: Math.round((y1 - y0) / res) };
}
const cellXY = (g, c, r) => [g.x0 + (c + 0.5) * g.res, g.y1 - (r + 0.5) * g.res];

/* Cells whose centre lies inside any ring (even-odd per ring). A scanline fill: each row finds where the ring's edges cross it
   and fills between the crossings, so the cost is rows x edges, not cells x edges (a stroke window on a long lawn stays cheap).
   Same answer as testing every cell centre with pointInRing. */
export function rasterize(g, rings) {
  const m = new Uint8Array(g.w * g.h);
  for (const ring of rings) {
    const n = ring.length; if (n < 3) continue;
    let ymin = Infinity, ymax = -Infinity;
    for (const p of ring) { if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1]; }
    const r0 = Math.max(0, Math.floor((g.y1 - ymax) / g.res) - 1), r1 = Math.min(g.h - 1, Math.ceil((g.y1 - ymin) / g.res) + 1);
    for (let r = r0; r <= r1; r++) {
      const y = g.y1 - (r + 0.5) * g.res, xs = [];
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = ring[i][1], yj = ring[j][1];
        if ((yi > y) !== (yj > y)) xs.push(((ring[j][0] - ring[i][0]) * (y - yi)) / (yj - yi) + ring[i][0]);
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.res - 0.5)), c1 = Math.min(g.w - 1, Math.ceil((xs[k + 1] - g.x0) / g.res - 0.5) - 1);
        for (let c = c0; c <= c1; c++) m[r * g.w + c] = 1;
      }
    }
  }
  return m;
}

export function dilate(g, m, steps) {
  let cur = m;
  for (let s = 0; s < steps; s++) {
    const nx = cur.slice();
    for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) {
      if (cur[r * g.w + c]) continue;
      if ((c > 0 && cur[r * g.w + c - 1]) || (c < g.w - 1 && cur[r * g.w + c + 1]) ||
          (r > 0 && cur[(r - 1) * g.w + c]) || (r < g.h - 1 && cur[(r + 1) * g.w + c])) nx[r * g.w + c] = 1;
    }
    cur = nx;
  }
  return cur;
}

/* 3x3 majority filter to clean speckle. */
function majority(g, m) {
  const out = new Uint8Array(m.length);
  for (let r = 1; r < g.h - 1; r++) for (let c = 1; c < g.w - 1; c++) {
    let s = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) s += m[(r + dr) * g.w + c + dc];
    out[r * g.w + c] = s >= 5 ? 1 : 0;
  }
  return out;
}

export function components(g, m) {
  const lab = new Int32Array(m.length), comps = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || lab[i]) continue;
    const id = comps.length + 1, cells = [i], stack = [i];
    lab[i] = id;
    while (stack.length) {
      const k = stack.pop(), r = (k / g.w) | 0, c = k % g.w;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc, j = rr * g.w + cc;
        if (rr < 0 || cc < 0 || rr >= g.h || cc >= g.w || !m[j] || lab[j]) continue;
        lab[j] = id; cells.push(j); stack.push(j);
      }
    }
    comps.push({ id, cells });
  }
  return { lab, comps };
}

/* The component's first cell in raster order (a loop: spreading a big component into Math.min
   overflows the call stack). */
function firstCell(cells) {
  let m = cells[0];
  for (const c of cells) if (c < m) m = c;
  return m;
}

/* Outline of one component (Moore-neighbour tracing), simplified, in UTM.
   `start` must be the component's first cell in raster order. */
export function traceOutline(g, lab, id, start) {
  const inC = (r, c) => r >= 0 && c >= 0 && r < g.h && c < g.w && lab[r * g.w + c] === id;
  // clockwise on screen (rows grow downwards), starting West
  const D = [[0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1]];
  const dirOf = (dr, dc) => D.findIndex(([a, b]) => a === dr && b === dc);
  const r0 = (start / g.w) | 0, c0 = start % g.w;
  const pts = [[r0, c0]];
  let r = r0, c = c0, back = 0, guard = 0;
  while (guard++ < 40000) {
    let found = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8, rr = r + D[d][0], cc = c + D[d][1];
      if (inC(rr, cc)) {
        const pd = (back + k - 1) % 8;                    // last background cell checked
        const br = r + D[pd][0], bc = c + D[pd][1];
        r = rr; c = cc; back = dirOf(br - r, bc - c); found = true; break;
      }
    }
    if (!found || back < 0) break;                          // single cell
    if (r === r0 && c === c0) break;
    pts.push([r, c]);
  }
  if (pts.length < 3) return null;
  const ring = simplify(pts.map(([rr, cc]) => cellXY(g, cc, rr)), g.res * 1.2);
  if (ring.length < 3) return null;
  ring.push(ring[0]);
  return ring;
}

/* Outline of one component along the cell sides, with its holes: { ring, holes } in UTM, closed, or null. A mask of n cells
   encloses n cells, so an outline traced again after each edit does not shrink by half a cell as traceOutline (which runs through
   the centres of the edge cells) does, and a neighbour's outline meets this one with no gap. Holes (ground of another class
   inside it) under minHoleM2 are dropped. */
export function cellOutline(g, lab, id, cells, minHoleM2 = 1) {
  const W = g.w + 1, out = new Map();
  const edge = (a, b) => { (out.get(a) || out.set(a, []).get(a)).push(b); };
  const inC = (r, c) => r >= 0 && c >= 0 && r < g.h && c < g.w && lab[r * g.w + c] === id;
  for (const k of cells) {
    const r = (k / g.w) | 0, c = k % g.w, tl = r * W + c, tr = tl + 1, bl = tl + W, br = bl + 1;
    if (!inC(r - 1, c)) edge(tl, tr);
    if (!inC(r, c + 1)) edge(tr, br);
    if (!inC(r + 1, c)) edge(br, bl);
    if (!inC(r, c - 1)) edge(bl, tl);
  }
  const xy = v => [g.x0 + (v % W) * g.res, g.y1 - Math.floor(v / W) * g.res];
  const loops = [];
  for (const [start] of out) {
    while (out.get(start)?.length) {
      const loop = [start]; let cur = start;
      for (let guard = 0; guard < 4e6; guard++) {
        const nx = out.get(cur)?.pop(); if (nx === undefined) break;
        if (nx === start) break;
        loop.push(nx); cur = nx;
      }
      if (loop.length < 4) continue;
      const pts = loop.map(xy); let a = 0;
      for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
      loops.push({ pts, a: a / 2 });
    }
  }
  if (!loops.length) return null;
  const big = loops.reduce((m, l) => (Math.abs(l.a) > Math.abs(m.a) ? l : m));
  const close = pts => { const r = simplify(pts, g.res * 0.6); if (r.length < 3) return null; r.push(r[0]); return r; };   // simplified open, as snapRing does
  const ring = close(big.pts); if (!ring) return null;
  const holes = loops.filter(l => l !== big && Math.sign(l.a) !== Math.sign(big.a) && Math.abs(l.a) >= minHoleM2).map(l => close(l.pts)).filter(Boolean);
  return { ring, holes };
}

/* Traced outlines come from a raster (cells of about half a metre), so they run in small steps, and the true edge lies
   anywhere inside a cell. Taking the steps out is accuracy-neutral as long as the outline stays within a fraction of a
   cell of the trace: Douglas-Peucker at 0.3 m, then one round of corner rounding, and the rounded outline is used only
   if no point of it is more than `maxDev` metres from the original trace (else the plain simplified outline is kept). */
export function smoothRing(ring, tolM = 0.3, maxDev = 0.3) {
  const closed = ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const u = (closed ? ring.slice(0, -1) : ring).map(toUtm);
  if (u.length < 6) return ring;
  let pts = simplify([...u, u[0]], tolM).slice(0, -1);
  if (pts.length < 4) pts = u;
  const back = p => { const ll = p.map(toLngLat); ll.push(ll[0]); return ll; };
  const dev = (P, Q) => {   // largest distance from a vertex of P to the closed polyline Q
    let worst = 0;
    for (const [x, y] of P) {
      let best = Infinity;
      for (let i = 0; i < Q.length; i++) {
        const a = Q[i], b = Q[(i + 1) % Q.length], vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / l2));
        const dx = x - (a[0] + t * vx), dy = y - (a[1] + t * vy), q = dx * dx + dy * dy; if (q < best) best = q;
      }
      if (best > worst) worst = best;
    }
    return Math.sqrt(worst);
  };
  if (dev(pts, u) > maxDev) return ring;   // the simplification itself moved the edge too far: keep the trace
  const r = [];
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; r.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
  return back(dev(r, u) <= maxDev ? r : pts);
}
export function smoothAutoAreas(d) {
  /* an automatic hedge or bed cannot stand in open water: the laser sees trees on the pond's shore and islands, never on its surface */
  const wet = c => (d.water || []).some(w => pointInRing(c, w.ring) && !(w.holes || []).some(h => pointInRing(c, h)));
  if (d.water?.length) d.areas = (d.areas || []).filter(a => !(["auto", "ai", "auto+ai"].includes(a.src) && a.ring?.length > 3 && (a.kind === "hedge" || a.kind === "bed") && wet([a.ring.reduce((s, p) => s + p[0], 0) / a.ring.length, a.ring.reduce((s, p) => s + p[1], 0) / a.ring.length])));
  for (const a of d.areas || []) if (!a.smooth && ["auto", "ai", "auto+ai"].includes(a.src) && a.ring?.length > 6) { a.ring = smoothRing(a.ring); if (a.holes?.length) a.holes = a.holes.map(h => smoothRing(h)); a.smooth = 1; }
  return d;
}

export function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let best = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
      if (d > best) { best = d; idx = i; }
    }
    if (best > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* ---------- Known geometry (known.js): roads, paths, fences, kerbs and water from maps and registers ----------
   rasterKnown marks the cells a known object covers: 1 road, path or traffic island, 2 fence or wall, 3 water.
   Detection keeps lawn, paving, beds, hedges and shrubs off them. A band narrower than a cell still gets a
   connected line of cells, so a fence splits the lawn on its two sides. */
export const KNOWN_CODE = { road: 1, path: 1, island: 1, fence: 2, hedge: 2, water: 3 };
export function rasterKnown(g, known) {
  const m = new Uint8Array(g.w * g.h);
  if (!known) return m;
  const thin = 0.71 * g.res;
  for (const b of known.bands || []) {
    const code = KNOWN_CODE[b.kind] || 1, L = Math.max(b.left, thin), R = Math.max(b.right, thin), reach = Math.max(L, R), cap = Math.min(L, R);
    for (let k = 0; k < b.pts.length - 1; k++) {
      const [ax, ay] = b.pts[k], [bx, by] = b.pts[k + 1], dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      if (!len2) continue;
      const len = Math.sqrt(len2);
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - g.x0) / g.res)), c1 = Math.min(g.w - 1, Math.ceil((Math.max(ax, bx) + reach - g.x0) / g.res));
      const r0 = Math.max(0, Math.floor((g.y1 - Math.max(ay, by) - reach) / g.res)), r1 = Math.min(g.h - 1, Math.ceil((g.y1 - Math.min(ay, by) + reach) / g.res));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const i = r * g.w + c; if (m[i]) continue;
        const [x, y] = cellXY(g, c, r), u = ((x - ax) * dx + (y - ay) * dy) / len2;
        let inside;
        if (u >= 0 && u <= 1) { const s = (dx * (y - ay) - dy * (x - ax)) / len; inside = s <= L && s >= -R; }   // s > 0: left of travel
        else { const qx = u < 0 ? ax : bx, qy = u < 0 ? ay : by; inside = Math.hypot(x - qx, y - qy) <= cap; }
        if (inside) m[i] = code;
      }
    }
  }
  for (const a of known.areas || []) {
    const inA = rasterize(g, [a.ring]), holes = a.holes?.length ? rasterize(g, a.holes) : null, code = KNOWN_CODE[a.kind] || 1;
    for (let i = 0; i < m.length; i++) if (inA[i] && !m[i] && !(holes && holes[i])) m[i] = code;
  }
  return m;
}

/* Ground the colour step could not see (shade, under tree crowns) and the bounded fill did not reach, where it lies
   between seen ground and a known edge (a building, road, path, fence or water). A cell is filled when the way from
   the nearest seen ground through it to that edge is at most GAP_M long; it takes the class of that ground. A gap
   that runs to no known edge stays open: there nothing says where the ground ends.
   cls: classes per cell (1 lawn, 2 paving, 3 hedge or low growth, 4 bed; 1, 2 and 4 may spread), open: cells that may
   be filled, stop: the known edges. Changes cls in place and returns how many cells it filled. */
export const GAP_M = 12;
const SPREAD = new Set([1, 2, 4]);
export function fillGaps(g, cls, open, stop, maxGapM = GAP_M) {
  const N = cls.length, INF = 0x3fffffff, ds = new Int32Array(N).fill(INF), de = new Int32Array(N).fill(INF), from = new Uint8Array(N);
  const bfs = (dist, isSource, carry) => {
    const q = [];
    for (let i = 0; i < N; i++) if (isSource(i)) { dist[i] = 0; q.push(i); if (carry) from[i] = cls[i]; }
    for (let h = 0; h < q.length; h++) {
      const k = q[h], r = (k / g.w) | 0, c = k % g.w;
      for (const j of [c > 0 ? k - 1 : -1, c < g.w - 1 ? k + 1 : -1, r > 0 ? k - g.w : -1, r < g.h - 1 ? k + g.w : -1]) {
        if (j < 0 || !open[j] || dist[j] !== INF) continue;
        dist[j] = dist[k] + 1; if (carry) from[j] = from[k]; q.push(j);
      }
    }
  };
  bfs(ds, i => !open[i] && SPREAD.has(cls[i]), true);
  bfs(de, i => !open[i] && !!stop[i], false);
  const most = Math.round(maxGapM / g.res) + 1;
  let n = 0;
  for (let i = 0; i < N; i++) if (open[i] && from[i] && ds[i] + de[i] <= most) { cls[i] = from[i]; n++; }
  return n;
}

/* An outline traced from the raster runs up to a cell or so beside a known edge. Points within `tol` metres of one
   are put onto it: the ring is sampled every metre, each sample within reach moves to the nearest point of the
   nearest edge, and the result is simplified again at 0.1 m. Points further away keep the trace. */
export function snapRing(ring, edges, tol) {
  if (!edges?.length || ring.length < 4) return ring;
  const r = snapRun(ring, edges, tol, false); if (!r) return ring;
  const s = simplify(r, 0.1);   // open, as traceOutline does: a closed chain has no base line to measure from
  s.push(s[0]);
  if (s.length < 4 || ringArea(s) < 0.5 * ringArea(ring)) return ring;   // a sliver along the edge would collapse onto it
  return s;
}
/* The same for an open chain (a stretch of outline between two points that stay where they are): the ends are kept. */
export function snapChain(pts, edges, tol) {
  if (!edges?.length || pts.length < 2) return pts;
  const r = snapRun(pts, edges, tol, true); if (!r) return pts;
  const s = simplify(r, 0.1);
  return s.length < 2 ? pts : s;
}
/* The sampled points of a run, each moved to the nearest known edge within tol; null when none moved. */
function snapRun(ring, edges, tol, open) {
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const bx0 = Math.min(...xs) - tol, bx1 = Math.max(...xs) + tol, by0 = Math.min(...ys) - tol, by1 = Math.max(...ys) + tol;
  const segs = [];
  for (const e of edges) for (let i = 0; i < e.length - 1; i++) {
    const [ax, ay] = e[i], [cx, cy] = e[i + 1];
    if (Math.max(ax, cx) < bx0 || Math.min(ax, cx) > bx1 || Math.max(ay, cy) < by0 || Math.min(ay, cy) > by1) continue;
    segs.push([ax, ay, cx, cy]);
  }
  if (!segs.length) return null;
  const dense = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i], [cx, cy] = ring[i + 1], n = Math.max(1, Math.ceil(Math.hypot(cx - ax, cy - ay)));
    for (let k = 0; k < n; k++) dense.push([ax + (cx - ax) * k / n, ay + (cy - ay) * k / n]);
  }
  if (open) dense.push(ring[ring.length - 1]);
  let moved = 0;
  const out = dense.map(([x, y]) => {
    let best = tol, q = null;
    for (const [ax, ay, cx, cy] of segs) {
      const dx = cx - ax, dy = cy - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(x - px, y - py);
      if (d < best) { best = d; q = [px, py]; }
    }
    if (q) moved++;
    return q || [x, y];
  });
  return moved ? out : null;
}
const ringArea = r => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(a) / 2; };

function shapeStats(g, cells) {
  let sx = 0, sy = 0;
  for (const k of cells) { sx += k % g.w; sy += (k / g.w) | 0; }
  const n = cells.length, mx = sx / n, my = sy / n;
  let xx = 0, yy = 0, xy = 0;
  for (const k of cells) { const dx = k % g.w - mx, dy = ((k / g.w) | 0) - my; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  xx /= n; yy /= n; xy /= n;
  const tr = xx + yy, det = xx * yy - xy * xy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
  return { n, mx, my, elong: Math.sqrt(l1 / l2), length: 4 * Math.sqrt(l1) * g.res, area: n * g.res * g.res };
}

/* ---------- Aerial colour sampling (Esri World Imagery tiles) ---------- */
export const TILE = z => (x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
/* Where Esri has no zoom-19 photo it answers a 2521-byte "Map data not yet available" tile
   (identical everywhere we looked: 3 places in Norway, checked 2026-09-30; Oslo has real ones).
   Probe the tile at the middle of the box once and fall back to zoom 18 for those places. */
const zoomProbe = new Map();
export function realZoom(lngLat) {
  const t = lngLatToTile(lngLat, 19), tx = Math.floor(t[0] / 256), ty = Math.floor(t[1] / 256), key = tx + "," + ty;
  if (!zoomProbe.has(key)) zoomProbe.set(key, fetch(TILE(19)(tx, ty)).then(r => r.blob()).then(b => (b.size === 2521 ? 18 : 19)).catch(() => 18));
  return zoomProbe.get(key);
}
export function lngLatToTile([lon, lat], z) {
  const n = 2 ** z, s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * n * 256, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * 256];
}
export function loadImg(src) {
  return new Promise((ok, bad) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = bad; i.src = src; });
}

/* The tiles of zoom z that cover grid g. */
export function tileSpan(g, z) {
  const corners = [[g.x0, g.y0], [g.x1, g.y1], [g.x0, g.y1], [g.x1, g.y0]].map(toLngLat).map(p => lngLatToTile(p, z));
  const tx0 = Math.floor(Math.min(...corners.map(p => p[0])) / 256), tx1 = Math.floor(Math.max(...corners.map(p => p[0])) / 256);
  const ty0 = Math.floor(Math.min(...corners.map(p => p[1])) / 256), ty1 = Math.floor(Math.max(...corners.map(p => p[1])) / 256);
  return { tx0, tx1, ty0, ty1, n: (tx1 - tx0 + 1) * (ty1 - ty0 + 1) };
}
/* The sharpest zoom for a grid: the finest the imagery really has here (maxZ, from realZoom), unless that needs more than `cap` tiles.
   (Before 2026-10-03 the zoom came from the lot's size alone: a 200 m lot was read at zoom 17, 0.6 m a pixel, where zoom 18 was there.) */
export const AERIAL_TILE_CAP = 64;
export function pickZoom(g, maxZ, cap = AERIAL_TILE_CAP) {
  for (let z = maxZ; z > 16; z--) if (tileSpan(g, z).n <= cap) return z;
  return 16;
}
/* Metres per pixel of web-mercator zoom z at a latitude. */
export const metresPerPixel = (z, lat) => (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
/* What the last sampleAerial read: { src, z, maxZ, mpp }, for the status text (CLAUDE.md: say which source and why not a better one). */
let aerialRead = null;
export const aerialSource = () => aerialRead;

/* Returns RGB per grid cell (Uint8ClampedArray, 3 per cell) or null. */
export async function sampleAerial(g) {
  const mid = toLngLat([(g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2]), maxZ = await realZoom(mid), z = pickZoom(g, maxZ);
  const { tx0, tx1, ty0, ty1, n: tiles } = tileSpan(g, z);
  if (tiles > AERIAL_TILE_CAP) return null;
  aerialRead = { src: "esri", z, maxZ, mpp: +metresPerPixel(z, mid[1]).toFixed(2) };
  const cv = document.createElement("canvas");
  cv.width = (tx1 - tx0 + 1) * 256; cv.height = (ty1 - ty0 + 1) * 256;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const url = TILE(z), jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++)
    jobs.push(loadImg(url(tx, ty)).then(img => ctx.drawImage(img, (tx - tx0) * 256, (ty - ty0) * 256)).catch(() => {}));
  await Promise.all(jobs);
  const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
  return cellColours(g, px, cv.width, cv.height, tx0 * 256, ty0 * 256, z, CELL_SAMPLING);
}

/* Colour of every grid cell from a mosaic of web-mercator pixels (RGBA, px at tile-pixel offset ox, oy).
   "point": the one pixel under the cell centre (the original behaviour). "mean" / "median": all pixels
   inside the cell, sub x sub nearest samples laid out along the cell's own axes (UTM grid north is a few degrees off
   web-mercator north at 10 E), so a 0.5 m cell is the average of its ~3 x 3 photo pixels instead of one noisy one. */
export function cellColours(g, px, W, H, ox, oy, z, mode = "point", sub = 4) {
  const out = new Uint8ClampedArray(g.w * g.h * 3), tile = xy => lngLatToTile(toLngLat(xy), z);
  if (mode === "point") {
    for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) {
      // @ts-ignore inferred too narrowly (tuples, growing objects)
      const [X, Y] = tile(cellXY(g, c, r));
      const ix = Math.min(W - 1, Math.max(0, Math.round(X - ox))), iy = Math.min(H - 1, Math.max(0, Math.round(Y - oy))), s = (iy * W + ix) * 4, o = (r * g.w + c) * 3;
      out[o] = px[s]; out[o + 1] = px[s + 1]; out[o + 2] = px[s + 2];
    }
    return out;
  }
  /* one projection per cell corner; a cell's sub-samples are then bilinear between its four corners */
  const cw = g.w + 1, cx = new Float64Array(cw * (g.h + 1)), cy = new Float64Array(cw * (g.h + 1));
  for (let r = 0; r <= g.h; r++) for (let c = 0; c <= g.w; c++) {
    // @ts-ignore inferred too narrowly (tuples, growing objects)
    const [X, Y] = tile([g.x0 + c * g.res, g.y1 - r * g.res]); cx[r * cw + c] = X - ox; cy[r * cw + c] = Y - oy;
  }
  const n = sub * sub, v = new Float32Array(n);
  for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) {
    const i00 = r * cw + c, i10 = i00 + 1, i01 = i00 + cw, i11 = i01 + 1, o = (r * g.w + c) * 3;
    for (let k = 0; k < 3; k++) {
      let sum = 0, m = 0;
      for (let i = 0; i < sub; i++) for (let j = 0; j < sub; j++) {
        const u = (i + 0.5) / sub, t = (j + 0.5) / sub;
        const X = (1 - t) * ((1 - u) * cx[i00] + u * cx[i10]) + t * ((1 - u) * cx[i01] + u * cx[i11]);
        const Y = (1 - t) * ((1 - u) * cy[i00] + u * cy[i10]) + t * ((1 - u) * cy[i01] + u * cy[i11]);
        const s = (Math.min(H - 1, Math.max(0, Math.floor(Y))) * W + Math.min(W - 1, Math.max(0, Math.floor(X)))) * 4 + k;
        if (mode === "mean") sum += px[s]; else v[m++] = px[s];
      }
      if (mode === "mean") out[o + k] = sum / n;
      else { const a = v.subarray(0, m).sort(); out[o + k] = (a[(m - 1) >> 1] + a[m >> 1]) / 2; }
    }
  }
  return out;
}
/* Measured on the three bench lots against tools/bench/truth (mean class IoU, one pixel -> mean of the cell):
   herbern 0.363 -> 0.356, akeberg-gard 0.475 -> 0.552, nordstrand 0.409 -> 0.406; cell accuracy 0.500/0.669/0.666 -> 0.496/0.720/0.667. */
const CELL_SAMPLING = "mean";

/* Ground cover from colour on low ground. Classes: 1 lawn, 2 paving, 3 low vegetation
   (hedges, shrubs: from height, so the fill below does not run across them), 4 bed.
   Lit cells are classified by colour; shaded cells only as grass (by green chromaticity,
   which survives shade); everything else — shadow, tree crowns, the strip where a leaning
   roof covers the ground in the photo — takes the class of the ground around it.
   Measured on three hand-labelled lots (tools/bench/truth): mean IoU 14 % → 34 %.
   known (rasterKnown, optional): cells a road, path, fence or water covers. They get no class, and with the buildings
   they are the edges fillGaps carries unseen ground up to. */
const CLS = { lawn: 1, paving: 2, low: 3, bed: 4 };
export function classifyGround(g, nd, lot, bld, rgb, known = null) {
  const N = g.w * g.h, cls = new Uint8Array(N), fillable = new Uint8Array(N), crown = new Uint8Array(N);
  for (let i = 0; i < N; i++) crown[i] = nd[i] > 3.5 ? 1 : 0;
  const nearCrown = dilate(g, crown, 2);                          // the edge of a crown is not a hedge
  for (let i = 0; i < N; i++) {
    if (!lot[i] || bld[i] || known?.[i]) continue;
    if (nd[i] > 0.8 && nd[i] < 3.5 && !nearCrown[i]) { cls[i] = CLS.low; continue; }
    fillable[i] = 1;
    if (nd[i] >= 0.8) continue;                                  // under a tree crown: filled later
    const R_ = rgb[i * 3], G = rgb[i * 3 + 1], B = rgb[i * 3 + 2], S = Math.max(1, R_ + G + B);
    const lum = S / 3, gc = G / S, exg = (2 * G - R_ - B) / S;
    const mx = Math.max(R_, G, B), mn = Math.min(R_, G, B), sat = mx ? (mx - mn) / mx : 0;
    const veg = gc > 0.365 && exg > 0.05;
    if (lum > 100) {
      if (veg) cls[i] = CLS.lawn;
      else if (sat < 0.18) cls[i] = CLS.paving;
      else if (sat >= 0.2 && R_ > G && G > B) cls[i] = CLS.bed;
    } else if (lum > 40 && gc > 0.38) cls[i] = CLS.lawn;
  }
  const cur = majorityClass(g, cls);
  for (let i = 0; i < N; i++) if (!fillable[i] && cls[i] !== CLS.low) cur[i] = 0;
  for (let step = 0; step < 12; step++) {                       // grow known ground into the unknown
    const m = majorityClass(g, cur); let changed = false;
    for (let i = 0; i < N; i++) if (!cur[i] && fillable[i] && m[i]) { cur[i] = m[i]; changed = true; }
    if (!changed) break;
  }
  const open = new Uint8Array(N), stop = new Uint8Array(N);
  for (let i = 0; i < N; i++) { open[i] = fillable[i] && !cur[i] ? 1 : 0; stop[i] = bld[i] || known?.[i] ? 1 : 0; }
  fillGaps(g, cur, open, stop);
  return cur;
}
/* 3x3 vote among labelled cells; 0 where none. */
function majorityClass(g, cls) {
  const out = new Uint8Array(cls.length), cnt = [0, 0, 0, 0, 0];
  for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) {
    cnt.fill(0);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < g.h && cc < g.w) cnt[cls[rr * g.w + cc]]++;
    }
    let best = 0, bn = 0;
    for (let k = 1; k <= 4; k++) if (cnt[k] > bn) { bn = cnt[k]; best = k; }
    out[r * g.w + c] = best;
  }
  return out;
}
/* Small paving and bed patches that touch nothing hard: no road, path, fence, water or building within a cell. Real paving joins
   something (a house, a path, a drive, a road); a lone grey or brown patch of a few square metres inside lawn is what the colour step
   makes of a grave, a stone, bare soil or a patch of fallen leaves. MICRO_M2 is the largest such patch.
   - Inside a churchyard (OSM amenity=grave_yard / landuse=cemetery; cem: its cells) they are graves: the lawn quarter they stand in
     becomes a grave field (class 5, catalog.js "graves"); quarters under MIN_FIELD_M2 stay lawn.
   - Elsewhere a lone patch under LONE_M2 that lawn surrounds (LAWN_SHARE of its border) is lawn: lawn with something on it.
   Changes cls in place; returns { graves: patches read as graves, lawn: patches given to the lawn }. */
export const CLS_GRAVES = 5, MICRO_M2 = 25, MIN_FIELD_M2 = 20, LONE_M2 = 10, LAWN_SHARE = 0.75;
export function microPatches(g, cls, kn, bld, cem = null) {
  const N = cls.length, cellM2 = g.res * g.res, out = { graves: 0, lawn: 0 };
  const hard = new Uint8Array(N);
  for (let i = 0; i < N; i++) hard[i] = kn?.[i] || bld?.[i] ? 1 : 0;
  const nearHard = dilate(g, hard, 1);
  for (const k of [CLS.paving, CLS.bed]) {
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) mask[i] = cls[i] === k ? 1 : 0;
    const { lab, comps } = components(g, mask);
    for (const cp of comps) {
      const area = cp.cells.length * cellM2;
      if (area >= MICRO_M2) continue;
      let touch = false, border = 0, lawnB = 0, inCem = 0;
      for (const i of cp.cells) {
        if (nearHard[i]) { touch = true; break; }
        if (cem?.[i]) inCem++;
        const r = (i / g.w) | 0, c = i % g.w;
        for (const j of [c > 0 ? i - 1 : -1, c < g.w - 1 ? i + 1 : -1, r > 0 ? i - g.w : -1, r < g.h - 1 ? i + g.w : -1]) if (j >= 0 && lab[j] !== cp.id) { border++; if (cls[j] === CLS.lawn) lawnB++; }
      }
      if (touch) continue;
      if (inCem > cp.cells.length / 2) { for (const i of cp.cells) cls[i] = CLS_GRAVES; out.graves++; }
      else if (area < LONE_M2 && border && lawnB / border >= LAWN_SHARE) { for (const i of cp.cells) cls[i] = CLS.lawn; out.lawn++; }
    }
  }
  if (out.graves) {
    /* A churchyard is laid out in quarters between its paths and hedges (known geometry splits the lawn there). A lawn quarter in the
       churchyard with graves in it is a grave field as a whole; the marks themselves are not kept as patches. */
    const grass = new Uint8Array(N);
    for (let i = 0; i < N; i++) grass[i] = cls[i] === CLS.lawn || cls[i] === CLS_GRAVES ? 1 : 0;
    for (const cp of components(g, grass).comps) {
      let marks = 0, inCem = 0;
      for (const i of cp.cells) { if (cls[i] === CLS_GRAVES) marks++; if (cem[i]) inCem++; }
      const field = marks && inCem > cp.cells.length / 2 && cp.cells.length * cellM2 >= MIN_FIELD_M2;
      for (const i of cp.cells) cls[i] = field ? CLS_GRAVES : CLS.lawn;
    }
  }
  return out;
}
export function surfacesFrom(g, nd, lot, bld, rgb, kn = null, edges = null, cem = null) {
  const cls = classifyGround(g, nd, lot, bld, rgb, kn);
  const micro = microPatches(g, cls, kn, bld, cem);
  const lawn = [], paving = [], beds = [], graves = [];
  for (const [k, out, min] of [[CLS.lawn, lawn, 8], [CLS.paving, paving, 6], [CLS.bed, beds, 4], [CLS_GRAVES, graves, MIN_FIELD_M2]]) {
    const mask = new Uint8Array(cls.length);
    for (let i = 0; i < cls.length; i++) mask[i] = cls[i] === k ? 1 : 0;
    const { lab, comps } = components(g, mask);
    for (const cp of comps) {
      const area = cp.cells.length * g.res * g.res;
      // @ts-ignore inferred too narrowly (tuples, growing objects)
      if (area < min) continue;
      const o = cellOutline(g, lab, cp.id, cp.cells);
      const snap = r => (edges ? snapRing(r, edges, 2 * g.res) : r);
      // @ts-ignore inferred too narrowly (growing objects)
      if (o) out.push({ ring: snap(o.ring), holes: o.holes.map(snap), area: +area.toFixed(0) });
    }
  }
  return { lawn, paving, beds, graves, cls, micro };
}

/* Re-run only lawn/paving/beds, e.g. after the user supplies a newer aerial photo or the known geometry changed. */
export async function detectSurfaces({ lotUtm, buildingsUtm = [], sampler, known = null, context = null }) {
  const g = makeGrid(lotUtm);
  /* the same laser heights as detectLot (it read the national 1 m model here before 2026-10-03) */
  const [D, T] = await Promise.all([fetchHeights("dom", g), fetchHeights("dtm", g)]);
  let dom = D.data, dtm = T.data;
  if (D.src !== T.src) { dom = D.src === "nhm" ? D.data : await fetchCoverage("dom", g); dtm = T.src === "nhm" ? T.data : await fetchCoverage("dtm", g); }
  const nd = new Float32Array(g.w * g.h);
  for (let i = 0; i < nd.length; i++) nd[i] = dom[i] > -100 && dtm[i] > -100 && dom[i] < 3000 && dtm[i] < 3000 ? Math.max(0, dom[i] - dtm[i]) : 0;
  const lot = rasterize(g, [lotUtm]), bld = dilate(g, rasterize(g, buildingsUtm), 2);
  const L = laserWithContext(g, nd, smooth3(g, nd), bld, lot, known, context);
  const rgb = await sampler(g);
  return { ...surfacesFrom(g, nd, lot, bld, rgb, L.kn, L.edges, L.cem), aerialSrc: sampler === sampleAerial ? aerialSource() : null };
}

/* Sampler over a user image placed at mercator-aligned bounds [w, s, e, n]. */
export function imageSampler(img, bounds) {
  return async g => {
    const cv = document.createElement("canvas"); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const z = 22, [x0, y0] = lngLatToTile([bounds[0], bounds[3]], z), [x1, y1] = lngLatToTile([bounds[2], bounds[1]], z);
    const out = new Uint8ClampedArray(g.w * g.h * 3);
    for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) {
      // @ts-ignore inferred too narrowly (tuples, growing objects)
      const [X, Y] = lngLatToTile(toLngLat(cellXY(g, c, r)), z);
      const ix = Math.round(((X - x0) / (x1 - x0)) * cv.width), iy = Math.round(((Y - y0) / (y1 - y0)) * cv.height);
      if (ix < 0 || iy < 0 || ix >= cv.width || iy >= cv.height) continue;
      const s = (iy * cv.width + ix) * 4, o = (r * g.w + c) * 3;
      out[o] = px[s]; out[o + 1] = px[s + 1]; out[o + 2] = px[s + 2];
    }
    return out;
  };
}

/* ---------- Main entry ---------- */
/* lotUtm: outer ring of the lot in UTM. buildingsUtm: rings (OSM). */
/* Trees: local maxima >= 3 m on the smoothed height, crown from where the profile halves.
   Only cells where keep[i] is set and bld[i] is not. */
function treePeaks(g, nd, sm, bld, keep) {
  const R = Math.round(2 / g.res), peaks = [];
  for (let r = R; r < g.h - R; r++) for (let c = R; c < g.w - R; c++) {
    const i = r * g.w + c, v = sm[i];
    if (v < 3 || bld[i] || !keep[i]) continue;
    let isMax = true;
    for (let dr = -R; dr <= R && isMax; dr++) for (let dc = -R; dc <= R; dc++) {
      if ((dr || dc) && sm[(r + dr) * g.w + c + dc] > v) { isMax = false; break; }
    }
    if (!isMax) continue;
    let rs = 0;
    for (let a = 0; a < 8; a++) {
      const dx = Math.cos((a * Math.PI) / 4), dy = Math.sin((a * Math.PI) / 4);
      let d = 1;
      for (; d < 16 / g.res; d++) {
        const cc = Math.round(c + dx * d), rr = Math.round(r + dy * d);
        if (cc < 0 || rr < 0 || cc >= g.w || rr >= g.h) break;
        const j = rr * g.w + cc;
        if (bld[j] || nd[j] < Math.max(1.5, v * 0.45)) break;
      }
      rs += d * g.res;
    }
    peaks.push({ c, r, h: nd[i] > v ? nd[i] : v, crown: Math.min(9, Math.max(1, rs / 8)) });
  }
  peaks.sort((a, b) => b.h - a.h);
  /* One crown can have several tops. A lower top joins a taller tree when it is close, or when
     the canopy between them never dips much (a big broadleaf with two leaders). */
  const saddle = (a, b) => { const n = Math.max(a.c - b.c, b.c - a.c, a.r - b.r, b.r - a.r); let m = Infinity; for (let k = 1; k < n; k++) m = Math.min(m, sm[Math.round(a.r + (b.r - a.r) * k / n) * g.w + Math.round(a.c + (b.c - a.c) * k / n)]); return m; };
  const trees = [];
  for (const p of peaks) {
    const [x, y] = cellXY(g, p.c, p.r);
    const t = trees.find(t => { const d = Math.hypot(t.x - x, t.y - y); return d < Math.max(1.5, 0.7 * t.crown) || (d < 0.45 * t.h && saddle(t.p, p) >= 0.75 * p.h); });
    if (t) { const d = Math.hypot(t.x - x, t.y - y); if (d > 0.7 * t.crown) t.crown = Math.min(9, Math.max(t.crown, (d + t.crown + p.crown) / 2)); t.parts.push([x, y]); continue; }
    trees.push({ x, y, h: +p.h.toFixed(1), crown: p.crown, p, parts: [[x, y]] });
  }
  /* a crown with several tops sits between them */
  return trees.map(({ x, y, h, crown, parts }) => ({ x: parts.length > 1 ? parts.reduce((a, q) => a + q[0], 0) / parts.length : x, y: parts.length > 1 ? parts.reduce((a, q) => a + q[1], 0) / parts.length : y, h, crown: +crown.toFixed(1) }));
}

const smooth3 = (g, nd) => {
  const sm = new Float32Array(g.w * g.h);
  for (let r = 1; r < g.h - 1; r++) for (let c = 1; c < g.w - 1; c++) {
    let s = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) s += nd[(r + dr) * g.w + c + dc];
    sm[r * g.w + c] = s / 9;
  }
  return sm;
};

/* What stands around the lot, as objects for the 3D view: houses the project doesn't have
   (OSM outlines, else Kartverket's building layer; own: mostly on the lot), the neighbours'
   trees, and tall hedges and shrubs. s is a fetchSurface() result with s.lot set; osmUtm
   are OSM outlines in and around it, knownUtm the project's own buildings. */
export async function surroundings(s, osmUtm = [], knownUtm = []) {
  const { g } = s, N = g.w * g.h, nd = new Float32Array(N);
  for (let i = 0; i < N; i++) nd[i] = Math.max(0, s.surf[i] - s.ground[i]);
  const known = rasterize(g, knownUtm), buildings = [], taken = Uint8Array.from(known);
  const add = (ring, cells) => { let lotN = 0, kn = 0; for (const k of cells) { lotN += s.lot[k]; kn += known[k]; } if (!cells.length || kn / cells.length > 0.3) return; buildings.push({ ring, own: lotN / cells.length > 0.5 }); for (const k of cells) taken[k] = 1; };
  for (const ring of osmUtm) { const m = rasterize(g, [ring]), cells = []; for (let i = 0; i < N; i++) if (m[i]) cells.push(i); add(ring, cells); }
  const fkb = await fetchBuildingMask(g).catch(() => null);
  if (fkb) {
    const { lab, comps } = components(g, fkb.fill);
    for (const cp of comps) {
      if (cp.cells.length * g.res * g.res < 6) continue;
      let seen = 0; for (const k of cp.cells) seen += taken[k];
      if (seen / cp.cells.length > 0.3) continue;
      const ring = traceOutline(g, lab, cp.id, cp.cells[0]);
      if (ring) add(ring, cp.cells);
    }
  }
  const bld = dilate(g, fkb ? Uint8Array.from(taken, (v, i) => v | fkb.any[i]) : taken, 2);
  const keep = Uint8Array.from(s.lot, v => v ? 0 : 1);
  const trees = treePeaks(g, nd, smooth3(g, nd), bld, keep);
  /* Lower growth (1.2–4 m) that no tree crown covers: hedges, bushes, fences. */
  const growth = [], low = new Uint8Array(N);
  for (let i = 0; i < N; i++) low[i] = nd[i] > 1.2 && nd[i] < 4 && !bld[i] && keep[i] ? 1 : 0;
  const { lab, comps } = components(g, majority(g, low));
  for (const cp of comps) {
    if (cp.cells.length * g.res * g.res < 1.5) continue;
    const st = shapeStats(g, cp.cells), [x, y] = cellXY(g, st.mx, st.my);
    if (trees.some(t => Math.hypot(t.x - x, t.y - y) < t.crown)) continue;
    const ring = traceOutline(g, lab, cp.id, firstCell(cp.cells));
    let hs = 0; for (const k of cp.cells) hs += nd[k];
    if (ring) growth.push({ ring, h: +(hs / cp.cells.length).toFixed(1) });
  }
  return { buildings, trees, growth };
}

/* ---------- Plants from the laser ----------
   What a low object (0.8–3.5 m) next to or inside taller growth really is, decided from its shape in the height model alone:
   - the skirt of a taller crown: a crown slopes down to the ground at its edge, and that band of 0.8–3.5 m cells lies just outside
     the crown radius treePeaks measures. When the taller growth it touches is a crown or canopy (at least SKIRT_M2 of cells over
     3.5 m), the low cells are that crown's edge, not a shrub or a hedge;
   - a narrow tall object (it reaches over 3.5 m but its tall part is small): a pole, mast or lamp when what stands above half its
     height is no more than POLE_M2 (a lamp post at 0.5 m cells), else a slim tree (a columnar or young tree);
   - otherwise a shrub, or a hedge when long and narrow, as before. */
export const SKIRT_M2 = 3, POLE_M2 = 0.5, TALL_M = 3.5;
export function lowObjectKind(f) {
  if (f.tallNear >= SKIRT_M2) return "skirt";
  if (f.hmax >= TALL_M) return f.halfM2 <= POLE_M2 ? "pole" : "tree";
  return "low";
}
/* Trees, shrubs and hedges from the laser height above ground (nd), smoothed (sm). Pure: grids in, plants out (UTM).
   dropped counts the low objects that were not plants (crown skirts, poles), so the status text can say so. */
export function laserPlants(g, nd, sm, bld, lot, kn) {
  const N = g.w * g.h, cellM2 = g.res * g.res;
  const trees = /** @type {{ x: number, y: number, h: number, crown: number, slim?: boolean }[]} */ (treePeaks(g, nd, sm, bld, lot));
  /* taller growth, as components, to see what a low object leans against */
  const tall = new Uint8Array(N);
  for (let i = 0; i < N; i++) tall[i] = nd[i] >= TALL_M && !bld[i] ? 1 : 0;
  const T = components(g, tall), tallM2 = T.comps.map(c => c.cells.length * cellM2);
  /* Hedges and shrubs: lower vegetation, 0.8–3.5 m. */
  const hedges = [], shrubs = [], dropped = { skirt: 0, pole: 0 };
  const low = new Uint8Array(N);
  for (let i = 0; i < N; i++) low[i] = nd[i] > 0.8 && nd[i] < TALL_M && !bld[i] && !kn[i] && lot[i] ? 1 : 0;   // a parked car is not a hedge
  const { lab, comps } = components(g, majority(g, low));
  for (const cp of comps) {
    const st = shapeStats(g, cp.cells);
    if (st.area < 0.75) continue;
    const [x, y] = cellXY(g, st.mx, st.my);
    if (trees.some(t => Math.hypot(t.x - x, t.y - y) < t.crown)) continue;
    /* the tall components inside it or beside it, and its highest cell */
    const near = new Set(); let hm = 0, top = cp.cells[0];
    for (const k of cp.cells) {
      if (nd[k] > hm) { hm = nd[k]; top = k; }
      const r = (k / g.w) | 0, c = k % g.w;
      for (const j of [c > 0 ? k - 1 : -1, c < g.w - 1 ? k + 1 : -1, r > 0 ? k - g.w : -1, r < g.h - 1 ? k + g.w : -1, k]) if (j >= 0 && T.lab[j]) near.add(T.lab[j]);
    }
    let tallNear = 0; for (const id of near) tallNear = Math.max(tallNear, tallM2[id - 1]);
    let halfM2 = 0;
    if (hm >= TALL_M) {   // what stands above half its height, within 1.5 m of its top
      const R = Math.round(1.5 / g.res), r0 = (top / g.w) | 0, c0 = top % g.w;
      for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) { const rr = r0 + dr, cc = c0 + dc; if (rr >= 0 && cc >= 0 && rr < g.h && cc < g.w && nd[rr * g.w + cc] >= hm / 2) halfM2 += cellM2; }
    }
    const kind = lowObjectKind({ tallNear, hmax: hm, halfM2 });
    if (kind === "skirt" || kind === "pole") { dropped[kind]++; continue; }
    if (kind === "tree") { const [tx, ty] = cellXY(g, top % g.w, (top / g.w) | 0); trees.push({ x: tx, y: ty, h: +hm.toFixed(1), crown: +Math.max(0.5, Math.sqrt(halfM2 / Math.PI)).toFixed(1), slim: true }); continue; }
    if (st.elong > 3 && st.length > 4 && st.area / st.length < 2.5) {
      const ring = traceOutline(g, lab, cp.id, firstCell(cp.cells));
      if (ring) { let hs = 0; for (const k of cp.cells) hs += nd[k]; hedges.push({ ring, h: +(hs / cp.cells.length).toFixed(1), length: +st.length.toFixed(0) }); }
    } else if (st.area < 14) {
      shrubs.push({ x, y, h: +hm.toFixed(1), crown: +Math.max(0.5, Math.sqrt(st.area / Math.PI)).toFixed(1) });
    }
  }
  return { trees, shrubs, hedges, dropped };
}

/* Nearest point of a polyline: { q, d, s } (s: distance along the line from its start). */
export function nearestOnLine(p, line) {
  let best = { q: line[0], d: Infinity, s: 0 }, run = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (L * L))), q = [ax + dx * t, ay + dy * t], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.d) best = { q, d, s: run + t * L };
    run += L;
  }
  return best;
}
/* Trees on a mapped tree row (OSM natural=tree_row, an avenue). Where crowns grow together the height model shows one long canopy;
   its tops are found anywhere across it, and treePeaks merges the tops of a double avenue into one row in the middle (on the path).
   OSM says where the trunks stand: a tree whose crown covers a row line (the line is within 0.6 crown radii of its top, at most 6 m,
   and the canopy over the line is at least half its height) stands on that row; on a double avenue it stands on each row it covers.
   Its crown then reaches as far past the row as it reached past the top. Row trees closer than ROW_GAP_M on one row are one tree.
   How many trees a closed canopy holds the height model cannot say (the laser point cloud, with trunks, could): the count along
   the row stays that of the tops found. rows: UTM polylines. Returns the new list and how many trees were placed on rows. */
export const ROW_GAP_M = 3;
export function treesOnRows(g, sm, trees, rows) {
  if (!rows?.length) return { trees, onRows: 0 };
  const hAt = ([x, y]) => { const c = Math.floor((x - g.x0) / g.res), r = Math.floor((g.y1 - y) / g.res); return c >= 0 && r >= 0 && c < g.w && r < g.h ? sm[r * g.w + c] : 0; };
  const out = [], per = rows.map(() => []);
  for (const t of trees) {
    const hits = [];
    rows.forEach((row, k) => { const n = nearestOnLine([t.x, t.y], row); if (n.d <= Math.min(0.6 * t.crown, 6) && hAt(n.q) >= 0.5 * t.h) hits.push({ k, n }); });
    if (!hits.length) { out.push(t); continue; }
    for (const { k, n } of hits) per[k].push({ x: n.q[0], y: n.q[1], s: n.s, h: t.h, crown: +Math.max(1, t.crown - n.d).toFixed(1), row: true });
  }
  let onRows = 0;
  for (const list of per) {
    list.sort((a, b) => a.s - b.s);
    for (const t of list) {
      const prev = out.length && out[out.length - 1];
      if (prev?.row && prev.k === list && Math.abs(prev.s - t.s) < ROW_GAP_M) { if (t.h > prev.h) Object.assign(prev, t); continue; }
      out.push({ ...t, k: list }); onRows++;
    }
  }
  return { trees: out.map(({ k, s, ...t }) => t), onRows };
}

/* Hedges mapped in OSM (barrier=hedge): a centreline, often 1–2 m off the plant and often clipped lower than the 0.8 m the laser
   step takes for growth. The line is moved sideways (up to 2 m) to where the height model has the hedge, if it shows one; the
   height is the median along it and the width where it stands over half that height. Where the hedge is not seen (lower than
   0.25 m, or under a tree's crown) it keeps its line and a 1 m width, and no height. lines: UTM polylines.
   Returns [{ pts, width, h|null, seen (share of the line the laser sees it on) }]. */
export function fitHedges(g, nd, lines) {
  const at = (x, y) => { const c = Math.floor((x - g.x0) / g.res), r = Math.floor((g.y1 - y) / g.res); return c >= 0 && r >= 0 && c < g.w && r < g.h ? nd[r * g.w + c] : NaN; };
  const out = [];
  for (const line of lines || []) {
    const S = [];   // samples: point and unit normal
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, ay] = line[i], [bx, by] = line[i + 1], L = Math.hypot(bx - ax, by - ay); if (!L) continue;
      const ux = (bx - ax) / L, uy = (by - ay) / L;
      for (let s = 0.25; s < L; s += 0.5) S.push({ x: ax + ux * s, y: ay + uy * s, nx: -uy, ny: ux });
    }
    if (!S.length) continue;
    const vis = v => v > 0.25 && v < TALL_M;   // a hedge, not lawn and not a tree crown above it
    const score = o => { let sum = 0, n = 0; for (const p of S) { const v = at(p.x + p.nx * o, p.y + p.ny * o); if (v < TALL_M) { sum += Math.min(v, 2.5); n++; } } return n ? sum / n : 0; };
    let off = 0, best = score(0);
    for (let o = -2; o <= 2; o += 0.5) { const sc = score(o); if (sc > best + 0.1) { best = sc; off = o; } }
    const hs = [];
    for (const p of S) { const v = at(p.x + p.nx * off, p.y + p.ny * off); if (vis(v)) hs.push(v); }
    const seen = hs.length / S.length;
    hs.sort((a, b) => a - b);
    const h = seen >= 0.3 ? hs[hs.length >> 1] : null, ws = [];
    if (h) for (const p of S) {
      const cx = p.x + p.nx * off, cy = p.y + p.ny * off; if (!vis(at(cx, cy))) continue;
      let w = g.res;
      for (const sgn of [-1, 1]) for (let t = g.res; t <= 2.5; t += g.res) { const v = at(cx + sgn * p.nx * t, cy + sgn * p.ny * t); if (!(v >= h / 2 && v < TALL_M)) break; w += g.res; }
      ws.push(w);
    }
    ws.sort((a, b) => a - b);
    const width = ws.length ? Math.max(0.6, Math.min(3, ws[ws.length >> 1])) : 1;
    const nrm = S[0], pts = line.map(([x, y], i) => { const p = S[Math.min(S.length - 1, Math.round(i * (S.length - 1) / Math.max(1, line.length - 1)))]; return [x + (p || nrm).nx * off, y + (p || nrm).ny * off]; });
    out.push({ pts, width: +width.toFixed(1), h: h ? +h.toFixed(1) : null, seen: +seen.toFixed(2) });
  }
  return out;
}
export const smoothHeights = (g, nd) => smooth3(g, nd);

/* What the lot's context adds to the laser (pure, for detectLot and the bench): context = { cemeteries, hedges, treeRows } as UTM rings
   and lines (streets.js contextFrom, projected). OSM hedges become known bands (code 2: no lawn on them, and the laser's own hedge
   cells there are not read twice); trees on a mapped tree row stand on it; a churchyard's cells are returned for the ground step. */
export function laserWithContext(g, nd, sm, bld, lot, known, context = null) {
  const lotNear = dilate(g, lot, Math.round(2 / g.res));
  const onLot = pts => pts.some(([x, y]) => { const c = Math.floor((x - g.x0) / g.res), r = Math.floor((g.y1 - y) / g.res); return c >= 0 && r >= 0 && c < g.w && r < g.h && lotNear[r * g.w + c]; });
  const osmHedges = fitHedges(g, nd, (context?.hedges || []).filter(onLot));
  const k2 = osmHedges.length ? { ...(known || { bands: [], areas: [], edges: [] }), bands: [...(known?.bands || []), ...osmHedges.map(h => ({ kind: "hedge", pts: h.pts, left: h.width / 2, right: h.width / 2 }))] } : known;
  const kn = rasterKnown(g, k2);
  const plants = laserPlants(g, nd, sm, bld, lot, kn);
  const { trees, onRows } = treesOnRows(g, sm, plants.trees, (context?.treeRows || []).filter(onLot));
  const cem = context?.cemeteries?.length ? rasterize(g, context.cemeteries) : null;
  let cemOnLot = 0, lotN = 0; for (let i = 0; i < lot.length; i++) if (lot[i]) { lotN++; if (cem?.[i]) cemOnLot++; }
  return { ...plants, trees, onRows, osmHedges, kn, cem: cemOnLot > 0.2 * lotN ? cem : null, edges: [...(known?.edges || []), ...osmHedges.map(h => pathRing(h.pts, h.width, 0.5))] };
}

export async function detectLot({ lotUtm, buildingsUtm = [], buildingPts = [], sampler = null, known = null, context = null, onStep = /** @type {(s: string) => void} */ (() => {}), onPart = /** @type {(p: any) => void} */ (() => {}) }) {
  const g = makeGrid(lotUtm);
  onStep("height");
  const rgbP = (sampler || sampleAerial)(g).catch(() => null);   // the aerial photo is read while the laser answers
  const [D, T, fkb] = await Promise.all([fetchHeights("dom", g), fetchHeights("dtm", g), fetchBuildingMask(g).catch(e => { console.warn("bygningsmaske", e); return null; })]);
  let dom = D.data, dtm = T.data;
  if (D.src !== T.src) { dom = D.src === "nhm" ? D.data : await fetchCoverage("dom", g); dtm = T.src === "nhm" ? T.data : await fetchCoverage("dtm", g); }   // never mix two models
  const N = g.w * g.h, nd = new Float32Array(N);
  let elevSum = 0, elevN = 0;
  for (let i = 0; i < N; i++) {
    const a = dom[i], b = dtm[i];
    const ok = a > -100 && b > -100 && a < 3000 && b < 3000;
    nd[i] = ok ? Math.max(0, a - b) : 0;
    if (ok) { elevSum += b; elevN++; }
  }
  const lot = rasterize(g, [lotUtm]);
  /* Exact footprints when Kartverket's building layer answered; else OSM with a wider margin. */
  const bld = fkb ? dilate(g, fkb.any, 1) : dilate(g, rasterize(g, buildingsUtm), 2);
  /* Known public roads: no lawn, paving or bed on the carriageway or the pavement. Trees and hedges
     are still read there (street trees stand on the pavement), so the mask joins in at the colour
     step only. */


  /* Smoothed height for peak finding. */
  const sm = new Float32Array(N);
  for (let r = 1; r < g.h - 1; r++) for (let c = 1; c < g.w - 1; c++) {
    let s = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) s += nd[(r + dr) * g.w + c + dc];
    sm[r * g.w + c] = s / 9;
  }

  /* Roughness: trees are bumpy, roofs are smooth. */
  const rough = new Float32Array(N).fill(99);
  for (let r = 1; r < g.h - 1; r++) for (let c = 1; c < g.w - 1; c++) {
    const i = r * g.w + c;
    rough[i] = Math.abs(4 * nd[i] - nd[i - 1] - nd[i + 1] - nd[i - g.w] - nd[i + g.w]);
  }

  const heightBuildings = [];
  if (fkb) {
    const { lab, comps } = components(g, fkb.fill);
    for (const cp of comps) {
      if (cp.cells.length * g.res * g.res < 4) continue;
      let inLot = 0; for (const k of cp.cells) inLot += lot[k];
      if (inLot / cp.cells.length < 0.5) continue;              // a neighbour's house
      const ring = traceOutline(g, lab, cp.id, cp.cells[0]);
      if (!ring) continue;
      let hs = 0; for (const k of cp.cells) hs += nd[k];
      const bp = buildingPts.find(b => { const c = Math.round((b.x - g.x0) / g.res - 0.5), r = Math.round((g.y1 - b.y) / g.res - 0.5); return lab[r * g.w + c] === cp.id; });
      heightBuildings.push({ ring, h: hs / cp.cells.length, code: bp?.code || null });
    }
  }

  /* Buildings grown from Matrikkel building points over smooth, raised ground. */
  for (const bp of fkb ? [] : buildingPts) {
    const c0 = Math.round((bp.x - g.x0) / g.res - 0.5), r0 = Math.round((g.y1 - bp.y) / g.res - 0.5);
    if (c0 < 0 || r0 < 0 || c0 >= g.w || r0 >= g.h || bld[r0 * g.w + c0]) continue;
    let seed = -1, best = 1e9;
    const S = Math.round(4 / g.res);
    for (let dr = -S; dr <= S; dr++) for (let dc = -S; dc <= S; dc++) {
      const rr = r0 + dr, cc = c0 + dc; if (rr < 1 || cc < 1 || rr >= g.h - 1 || cc >= g.w - 1) continue;
      const j = rr * g.w + cc, d = dr * dr + dc * dc;
      if (nd[j] > 2 && rough[j] < 1.2 && !bld[j] && d < best) { best = d; seed = j; }
    }
    if (seed < 0) continue;
    const reg = new Uint8Array(N), stack = [seed]; reg[seed] = 1; let n = 0;
    const maxCells = 800 / (g.res * g.res);
    while (stack.length && n < maxCells) {
      const k = stack.pop(); n++;
      const r = (k / g.w) | 0, c = k % g.w;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc, j = rr * g.w + cc;
        if (rr < 1 || cc < 1 || rr >= g.h - 1 || cc >= g.w - 1 || reg[j] || bld[j]) continue;
        if (nd[j] > 1.8 && rough[j] < 1.6) { reg[j] = 1; stack.push(j); }
      }
    }
    const grown = majority(g, dilate(g, reg, 1));
    const { lab, comps } = components(g, grown);
    const cp = comps.sort((a, b) => b.cells.length - a.cells.length)[0];
    if (!cp || cp.cells.length * g.res * g.res < 6) continue;
    const ring = traceOutline(g, lab, cp.id, firstCell(cp.cells));
    if (!ring) continue;
    let hs = 0; for (const k of cp.cells) hs += nd[k];
    heightBuildings.push({ ring, h: hs / cp.cells.length, code: bp.code });
    for (const k of dilate(g, grown, 1).reduce((a, v, i) => (v && a.push(i), a), [])) bld[k] = 1;
  }

  /* Buildings from height where no source has one: tall, flat, big blobs. */
  if (!fkb) {
    const tall = new Uint8Array(N);
    for (let i = 0; i < N; i++) tall[i] = nd[i] > 2.3 && !bld[i] ? 1 : 0;
    const { lab, comps } = components(g, majority(g, tall));
    for (const cp of comps) {
      const st = shapeStats(g, cp.cells);
      if (st.area < 14) continue;
      let rs = 0, n = 0;
      for (const k of cp.cells) if (rough[k] < 99) { rs += rough[k]; n++; }
      const meanRough = rs / Math.max(1, n);
      let inLot = 0; for (const k of cp.cells) inLot += lot[k];
      if (meanRough < 0.9 && inLot / cp.cells.length > 0.5) {
        const ring = traceOutline(g, lab, cp.id, firstCell(cp.cells));
        if (ring) {
          let hs = 0; for (const k of cp.cells) hs += nd[k];
          heightBuildings.push({ ring, h: hs / cp.cells.length });
          for (const k of cp.cells) bld[k] = 1;
        }
      }
    }
  }

  const L = laserWithContext(g, nd, sm, bld, lot, known, context), { trees, shrubs, dropped, onRows, kn, cem } = L;
  /* hedges: the laser's own, and OSM's fitted to the laser (src "osm", height null where the laser does not see it) */
  const hedges = [...L.hedges, ...L.osmHedges.map(h => ({ ring: pathRing(h.pts, h.width, 0.5), h: h.h, length: +h.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - h.pts[i][0], p[1] - h.pts[i][1]), 0).toFixed(0), src: "osm", seen: h.seen }))];
  /* the laser's ridge height (95th percentile) over each known footprint, to check the footprint's type tag (buildingType) */
  const buildingH = buildingsUtm.map(r => { const m = rasterize(g, [r]), v = []; for (let i = 0; i < N; i++) if (m[i]) v.push(nd[i]); v.sort((a, b) => a - b); return v.length ? +v[Math.floor(v.length * 0.95)].toFixed(1) : null; });
  const notes = { skirts: dropped.skirt, poles: dropped.pole, onRows, slim: trees.filter(t => t.slim).length, osmHedges: L.osmHedges.length, cemetery: !!cem };

  /* The laser part is done: hand it over now so it can be drawn while the aerial photo is read. */
  onPart({ trees, shrubs, hedges, heightBuildings, buildingH, notes, elevation: elevN ? elevSum / elevN : 0, heightSrc: D.src === T.src ? D.src : "nhm", heightWhy: heightWhy(D, T), fkb: !!fkb });
  /* Lawn and paving from colour on low ground. */
  onStep("aerial");
  const rgb = await rgbP;
  const { lawn, paving, beds, graves, cls, micro } = rgb ? surfacesFrom(g, nd, lot, bld, rgb, kn, L.edges, cem) : { lawn: [], paving: [], beds: [], graves: [], cls: null, micro: null };
  if (globalThis.hk) globalThis.hk.last = { g, nd, lot, bld, rgb, fkb, cls, kn, cem };   // ?debug only

  return {
    grid: g,
    elevation: elevN ? elevSum / elevN : 0,
    trees, shrubs, hedges, heightBuildings, buildingH, lawn, paving, beds, graves, notes: { ...notes, micro },
    aerial: !!rgb, aerialSrc: sampler ? null : aerialSource(), fkb: !!fkb, heightSrc: D.src === T.src ? D.src : "nhm", heightWhy: heightWhy(D, T),
  };
}

/* The aerial in words for the status text: which photo, how sharp, and why not a sharper one (CLAUDE.md: never settle silently). */
export function aerialMsg(a) {
  if (!a) return "eget bilde";
  const why = [a.z < a.maxZ ? `zoom ${a.maxZ} ville trengt for mange bildefliser` : "", a.maxZ < 19 ? "Esri har ikke skarpere bilde her" : "", "Kartverkets ortofoto er ikke åpent for oss ennå"].filter(Boolean).join("; ");
  return `Esri-flyfoto, ${String(a.mpp).replace(".", ",")} m per piksel (${why})`;
}
/* What the laser step left out or placed by the lot's context, in words for the status text. */
export function notesMsg(n) {
  if (!n) return "";
  const p = [];
  if (n.onRows) p.push(`${n.onRows} trær står på trerekker fra OpenStreetMap (hvor mange som står i en sammenvokst allé, kan ikke laseroverflaten skille)`);
  if (n.osmHedges) p.push(`${n.osmHedges} ${n.osmHedges === 1 ? "hekk" : "hekker"} fra OpenStreetMap`);
  if (n.skirts) p.push(`${n.skirts} kanter av trekroner er ikke regnet som busker`);
  if (n.poles) p.push(`${n.poles} ${n.poles === 1 ? "stolpe" : "stolper"} er ikke regnet som planter`);
  return p.length ? " · " + p.join(" · ") : "";
}

/* ---------- Building types ----------
   Matrikkelen's bygningstype (NS 3457) is the register, so it decides when a building point lies in the footprint; OSM's building tag
   comes next. An OSM tag for a small outbuilding (garage, shed, carport, greenhouse) is checked against the footprint and the laser:
   a "garage" with a ridge over SMALL_RIDGE_M or a footprint over SMALL_M2 is not one, and is called a building with the reason kept. */
export function codeToType(code) {
  if (!code) return "yes";
  if (code >= 111 && code <= 159) return "house";
  if (code >= 161 && code <= 172) return "cabin";
  if (code === 181 || code === 182) return "outbuilding";
  if (code === 183) return "boathouse";
  if (code === 431 || code === 439) return "garage";
  if (code === 671) return "church";
  if (code === 673) return "chapel";
  if (code >= 672 && code <= 679) return "religious";
  return "yes";
}
export const SMALL_TYPES = new Set(["garage", "garages", "shed", "carport", "greenhouse", "outbuilding", "hut"]), SMALL_RIDGE_M = 8, SMALL_M2 = 250;
export function buildingType({ tag = null, code = null, ridge = null, area = null } = {}) {
  const reg = codeToType(code);
  if (reg !== "yes") return { type: reg, src: "matrikkel", why: "" };
  const t = tag && tag !== "yes" ? tag : null;
  if (!t) return { type: "yes", src: null, why: "" };
  if (SMALL_TYPES.has(t) && ((ridge ?? 0) > SMALL_RIDGE_M || (area ?? 0) > SMALL_M2))
    return { type: "yes", src: "osm", why: `OpenStreetMap kaller den «${t}», men den er ${ridge > SMALL_RIDGE_M ? `${Math.round(ridge)} m høy` : `${Math.round(area)} m²`}` };
  return { type: t, src: "osm", why: "" };
}

/* Aerial photo of the lot with the property line drawn in red, for the optional
   vision model. Returns the image and a mapper from image fractions to [lng, lat]. */
export async function captureAerial(ringLngLat, maxPx = 1024, marks = []) {
  const lons = ringLngLat.map(p => p[0]), lats = ringLngLat.map(p => p[1]);
  const padLon = (Math.max(...lons) - Math.min(...lons)) * 0.12, padLat = (Math.max(...lats) - Math.min(...lats)) * 0.12;
  const sw = [Math.min(...lons) - padLon, Math.min(...lats) - padLat], ne = [Math.max(...lons) + padLon, Math.max(...lats) + padLat];
  let z = (await realZoom([(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2])) + 1, a, b;
  do { z--; a = lngLatToTile([sw[0], ne[1]], z); b = lngLatToTile([ne[0], sw[1]], z); } while ((b[0] - a[0] > maxPx || b[1] - a[1] > maxPx) && z > 15);
  const w = Math.ceil(b[0] - a[0]), h = Math.ceil(b[1] - a[1]);
  /* Small lots come out a few hundred pixels wide; the model sees about one token per
     32 px, so scale up to ~1000 px or it barely sees the garden. */
  const k = Math.min(4, Math.max(1, 1000 / Math.max(w, h)));
  const cv = document.createElement("canvas"); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  const ctx = cv.getContext("2d"), url = TILE(z), jobs = [];
  ctx.imageSmoothingQuality = "high"; ctx.scale(k, k);
  for (let ty = Math.floor(a[1] / 256); ty <= Math.floor(b[1] / 256); ty++)
    for (let tx = Math.floor(a[0] / 256); tx <= Math.floor(b[0] / 256); tx++)
      jobs.push(loadImg(url(tx, ty)).then(img => ctx.drawImage(img, tx * 256 - a[0], ty * 256 - a[1])).catch(() => {}));
  await Promise.all(jobs);
  ctx.strokeStyle = "#ff1a1a"; ctx.lineWidth = Math.max(2, w / 300); ctx.beginPath();
  ringLngLat.forEach((p, i) => { const [X, Y] = lngLatToTile(p, z); ctx[i ? "lineTo" : "moveTo"](X - a[0], Y - a[1]); });
  ctx.closePath(); ctx.stroke();
  /* Set-of-Mark: outline our own regions and number them, so the model only has to name
     what is on the ground at each number instead of drawing polygons. */
  for (const m of marks) {
    ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(1, w / 600); ctx.beginPath();
    m.ring.forEach((p, i) => { const [X, Y] = lngLatToTile(p, z); ctx[i ? "lineTo" : "moveTo"](X - a[0], Y - a[1]); });
    ctx.closePath(); ctx.stroke();
    // @ts-ignore inferred too narrowly (tuples, growing objects)
    const [X, Y] = lngLatToTile(ringLabelPoint(m.ring), z), fs = Math.max(11, w / 70), t = String(m.n);
    ctx.font = `bold ${fs}px sans-serif`; const tw = ctx.measureText(t).width + 6;
    ctx.fillStyle = "rgba(0,0,0,.8)"; ctx.fillRect(X - a[0] - tw / 2, Y - a[1] - fs * 0.65, tw, fs * 1.3);
    ctx.fillStyle = "#ffe14a"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t, X - a[0], Y - a[1]);
  }
  const n = 2 ** z * 256;
  const fromFrac = (fx, fy) => {
    const X = a[0] + fx * w, Y = a[1] + fy * h;
    const lon = (X / n) * 360 - 180, lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * Y) / n))) * 180) / Math.PI;
    return [lon, lat];
  };
  const toFrac = p => { const [X, Y] = lngLatToTile(p, z); return [(X - a[0]) / w, (Y - a[1]) / h]; };
  return { dataUrl: cv.toDataURL("image/jpeg", 0.85), fromFrac, toFrac };
}
/* A point well inside a ring for its label: the vertex-average if that is inside, else the
   inside point nearest to it along a horizontal scan. */
function ringLabelPoint(ring) {
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  if (pointInRing([cx, cy], ring)) return [cx, cy];
  const xs = ring.map(p => p[0]), x0 = Math.min(...xs), x1 = Math.max(...xs); let best = null, bd = 1e9;
  for (let i = 0; i <= 60; i++) { const x = x0 + ((x1 - x0) * i) / 60; if (pointInRing([x, cy], ring) && Math.abs(x - cx) < bd) { bd = Math.abs(x - cx); best = [x, cy]; } }
  return best || [cx, cy];
}

/* ---------- Guided repaint: painted class map -> areas ---------- */
/* Is the model's repaint worth keeping? `foundM2` is the surface it traced, `guideM2` what the laser/colour detection had drawn in the guide.
   A photo handed back, a black frame or a wrong palette lands far from the guide; then the old areas stay. Pure, for tests. */
export function repaintVerdict(foundM2, guideM2) {
  if (!(foundM2 > 0)) return { ok: false, why: "svaret inneholdt ingen flater" };
  if (guideM2 > 0) { const q = foundM2 / guideM2; if (q < 0.5 || q > 1.6) return { ok: false, why: `svaret avvek for mye fra utgangspunktet (${Math.round(q * 100)} % av arealet)` }; }
  return { ok: true, why: "" };
}
/* Read a flat colour-coded map (the image model's answer) back into lawn/paving/bed/hedge rings.
   `pxOf(utm)` maps a UTM point to a pixel in `img`. Cells outside the lot, on buildings or on a
   known public road are dropped; a 3x3 majority kills speckle; rings are traced on a fine grid so
   the borders stay crisp. */
export const PAINT_CLASSES = { lawn: [0, 255, 0], paving: [255, 255, 255], hedge: [0, 90, 0], bed: [200, 90, 0], tree: [0, 0, 255], roof: [255, 0, 0], other: [0, 0, 0] };
export function areasFromPaint({ img, lotUtm, buildingsUtm = [], pxOf, known = null, minM2 = { lawn: 6, paving: 4, bed: 3, hedge: 4 } }) {
  const g = makeGrid(lotUtm, 2); g.res = g.res <= 0.5 ? 0.25 : g.res / 2; g.w = Math.round((g.x1 - g.x0) / g.res); g.h = Math.round((g.y1 - g.y0) / g.res);
  const cv = document.createElement("canvas"); cv.width = img.naturalWidth || img.width; cv.height = img.naturalHeight || img.height;
  const ctx = cv.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const names = Object.keys(PAINT_CLASSES), pal = names.map(n => PAINT_CLASSES[n]);
  const lot = rasterize(g, [lotUtm]), bld = dilate(g, rasterize(g, buildingsUtm), 1), kn = rasterKnown(g, known);
  const cls = new Uint8Array(g.w * g.h);
  for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) {
    const i = r * g.w + c; if (!lot[i] || bld[i] || kn[i]) continue;
    const [x, y] = pxOf(cellXY(g, c, r)), X = Math.round(x), Y = Math.round(y);
    if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) continue;
    const o = (Y * cv.width + X) * 4; let best = 0, bd = 1e9;
    for (let k = 0; k < pal.length; k++) { const d = (px[o] - pal[k][0]) ** 2 + (px[o + 1] - pal[k][1]) ** 2 + (px[o + 2] - pal[k][2]) ** 2; if (d < bd) { bd = d; best = k; } }
    cls[i] = best + 1;
  }
  /* Tree crowns, roof overhang and "other" take the ground class next to them, so the lawn
     continues under the trees like everywhere else in the app (up to ~4 m in). */
  const ground = new Set([1, 2, 3, 4].map(k => k));   // lawn, paving, hedge, bed in palette order
  for (let step = 0; step < Math.round(4 / g.res); step++) {
    const next = cls.slice(); let changed = 0;
    for (let r = 1; r < g.h - 1; r++) for (let c = 1; c < g.w - 1; c++) {
      const i = r * g.w + c; if (!lot[i] || bld[i] || kn[i] || ground.has(cls[i])) continue;
      const votes = [0, 0, 0, 0, 0];
      for (const j of [i - 1, i + 1, i - g.w, i + g.w]) if (ground.has(cls[j])) votes[cls[j]]++;
      let best = 0; for (let k = 1; k <= 4; k++) if (votes[k] > votes[best]) best = k;
      if (best) { next[i] = best; changed++; }
    }
    cls.set(next); if (!changed) break;
  }
  {
    const N = cls.length, open = new Uint8Array(N), stop = new Uint8Array(N);
    for (let i = 0; i < N; i++) { open[i] = lot[i] && !bld[i] && !kn[i] && !ground.has(cls[i]) ? 1 : 0; stop[i] = bld[i] || kn[i] ? 1 : 0; }
    fillGaps(g, cls, open, stop);   // palette order lawn 1, paving 2, hedge 3, bed 4: the same classes spread as in classifyGround
  }
  const out = {};
  for (const name of ["lawn", "paving", "bed", "hedge"]) {
    const k = names.indexOf(name) + 1, mask = new Uint8Array(cls.length);
    for (let i = 0; i < cls.length; i++) mask[i] = cls[i] === k ? 1 : 0;
    const { lab, comps } = components(g, majority(g, mask)); out[name] = [];
    for (const cp of comps) {
      const area = cp.cells.length * g.res * g.res; if (area < minM2[name]) continue;
      const o = cellOutline(g, lab, cp.id, cp.cells);   // along cell sides, with holes: a bed in a lawn is a hole in it
      const snap = r => (known?.edges ? snapRing(r, known.edges, 2 * g.res) : r);
      if (o) out[name].push({ ring: snap(o.ring), holes: o.holes.map(snap), area: +area.toFixed(0) });
    }
  }
  return out;
}
