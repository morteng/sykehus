/* A picture of a site for an agent to look at (sykehus U3557, Morten 2026-10-25 20:50Z «does anton on sykehus have
   camera tools to get views it wants of its own work … like fab has?»; one copy for every app, U3559): drawn in Node
   without a browser or a GPU, so a tool can hand it back as MCP image content. Massing only: the terrain, the lot
   line, the buildings as their blocks or rings, the new volumes in their material's colour, the trees as cones; some
   picked out in orange. A z-buffer over flat-shaded triangles, drawn twice the size and halved for smooth edges, then
   dark edges on the buildings, a north arrow top right, a 50 m scale bar in plan; the PNG written with node:zlib.
   Node only (node:zlib, node:worker_threads); no three.js. An app's own viewer is the real picture; this one is for
   checking shapes and places.

   The site is fit.js's (terrain, buildings, wings, added, lot) and also:
     added[].parts  [{ axis: [[east, north], [east, north]], profile: [[across, kote], …], mat }]   a profile extruded
                    along the axis (across: metres to the left walking along it), or { tris: [[[e, n, kote] × 3], …], mat }
     trees          [[east, north, height?, crown radius?], …]
   mat: glass, concrete, steel, wood or brick.

   render(site, { target: [east, north, kote], from (degrees, 0 = the camera north of the target), tilt (degrees
     above the ground), dist (m), plan (straight down, north up), focus: [ids picked out], width, height }) → PNG Buffer
   picture(site, opts): the same in a worker thread, one at a time → Promise<Buffer>
   aimAt(site, what): a wing (id or name), a building id, or an added one (id or name) → { name, ids, target, size } | null
   VIEWS: the named views (as FreeCAD's get_view): isometrisk, plan, N, Ø, S, V, NØ, SØ, SV, NV → { from, tilt } | { plan } */
import { deflateSync } from "node:zlib";

const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const C = {
  sky: hex("#e6ecef"), ground: hex("#b3c58a"), lot: hex("#c8312b"), own: hex("#ddd2bd"), other: hex("#bdb9b1"), tree: hex("#6f8d4f"), edge: hex("#4a463f"), focus: hex("#ff7a00"),
  glass: hex("#a8d8cf"), concrete: hex("#cfcac0"), steel: hex("#9fa8b2"), wood: hex("#bf9163"), brick: hex("#b7684c"), north: hex("#23211e"),
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const SUN = norm([-0.45, -0.65, 0.75]);   // from the south-west and high, as the page's afternoon

/* a polygon's triangles by ear clipping (rings are a few dozen points) */
function earcut(pts) {
  const n = pts.length; if (n < 3) return [];
  const area = pts.reduce((a, p, i) => { const q = pts[(i + 1) % n]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
  const idx = [...Array(n).keys()]; if (area < 0) idx.reverse();
  const tris = [], inside = (p, a, b, c) => { const s = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]); return s(a, b, p) >= 0 && s(b, c, p) >= 0 && s(c, a, p) >= 0; };
  let guard = 0;
  while (idx.length > 3 && guard++ < 5000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const [ia, ib, ic] = [idx[(i + idx.length - 1) % idx.length], idx[i], idx[(i + 1) % idx.length]], a = pts[ia], b = pts[ib], c = pts[ic];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 0) continue;
      if (idx.some(j => j !== ia && j !== ib && j !== ic && inside(pts[j], a, b, c))) continue;
      tris.push([ia, ib, ic]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) tris.push(idx.slice());
  return tris;
}

/* the scene as triangles [[p, p, p], colour, focus?] and edges [p, p, colour, width] */
function scene(site, focusIds) {
  const tris = [], edges = [], t = site.terrain;
  const zAt = (x, y) => { const i = Math.max(0, Math.min(t.w - 1, Math.round((x - t.x0) / t.res))), j = Math.max(0, Math.min(t.h - 1, Math.round((t.y1 - y) / t.res))); return t.z[j * t.w + i] ?? 0; };
  const S = 2;   // every second terrain point: 4 m
  for (let j = 0; j + S < t.h; j += S) for (let i = 0; i + S < t.w; i += S) {
    const p = (ii, jj) => [t.x0 + ii * t.res, t.y1 - jj * t.res, t.z[jj * t.w + ii] ?? 0];
    const a = p(i, j), b = p(i + S, j), c = p(i + S, j + S), d = p(i, j + S);
    tris.push([[a, d, b], C.ground], [[b, d, c], C.ground]);
  }
  const lot = site.lot?.ring || [];
  for (let k = 0; k + 1 < lot.length; k++) { const [a, b] = [lot[k], lot[k + 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 3));
    for (let s = 0; s < n; s += 2) { const f = q => [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q]; const [p, q] = [f(s / n), f(Math.min(1, (s + 1) / n))]; edges.push([[...p, zAt(...p) + 0.3], [...q, zAt(...q) + 0.3], C.lot, 1.5]); } }
  const prism = (ring, z0, z1, col, foc) => {
    const r = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
    for (const [a, b, c] of earcut(r)) tris.push([[[...r[a], z1], [...r[b], z1], [...r[c], z1]], col, foc]);
    for (let k = 0; k < r.length; k++) { const p = r[k], q = r[(k + 1) % r.length];
      tris.push([[[...p, z0], [...q, z0], [...q, z1]], col, foc], [[[...p, z0], [...q, z1], [...p, z1]], col, foc]);
      edges.push([[...p, z1], [...q, z1], foc ? C.focus : C.edge, foc ? 2.5 : 1], [[...p, z0], [...p, z1], foc ? C.focus : C.edge, foc ? 2.5 : 1]); }
  };
  for (const b of site.buildings || []) {
    const foc = focusIds.has(b.id), col = b.own ? C.own : C.other, top = b.top ?? b.base + 8;
    if (b.blocks?.length) for (const k of b.blocks) prism(k.p, b.base, k.top, col, foc); else prism(b.ring, b.base, top, col, foc);
  }
  for (const a of site.added || []) {
    const foc = focusIds.has(a.id);
    for (const p of a.parts || []) {
      const ec = foc ? C.focus : C.edge, ew = foc ? 2.5 : 1;
      if (p.tris) { for (const t of p.tris) { tris.push([t, C[p.mat] || C.concrete, foc]); for (let k = 0; k < 3; k++) edges.push([t[k], t[(k + 1) % 3], ec, ew]); } continue; }
      const [[x0, y0], [x1, y1]] = p.axis, L = Math.hypot(x1 - x0, y1 - y0); if (L < 0.01) continue;
      const d = [(x1 - x0) / L, (y1 - y0) / L], n = [-d[1], d[0]], col = C[p.mat] || C.concrete;
      const at = (s, z, end) => [x0 + n[0] * s + (end ? x1 - x0 : 0), y0 + n[1] * s + (end ? y1 - y0 : 0), z];
      const pr = p.profile, A = pr.map(([s, z]) => at(s, z, false)), B = pr.map(([s, z]) => at(s, z, true));
      for (const [i, j, k] of earcut(pr)) tris.push([[A[i], A[j], A[k]], col, foc], [[B[i], B[k], B[j]], col, foc]);
      for (let k = 0; k < pr.length; k++) { const m = (k + 1) % pr.length;
        tris.push([[A[k], A[m], B[m]], col, foc], [[A[k], B[m], B[k]], col, foc]);
        edges.push([A[k], A[m], foc ? C.focus : C.edge, foc ? 2.5 : 1], [B[k], B[m], foc ? C.focus : C.edge, foc ? 2.5 : 1], [A[k], B[k], foc ? C.focus : C.edge, foc ? 2.5 : 1]); }
    }
  }
  /* the ground under a new building is not drawn over it; only what has a footprint (from, to, width): balconies hang
     on a wall and have none (sykehus 2026-10-25 22:09Z: «Cannot read properties of undefined (reading '0')») */
  const feet = (site.added || []).filter(a => a.from && a.to).flatMap(a => (a.parts || []).filter(p => p.profile || p.tris).slice(0, 1).map(() => { const d = [a.to[0] - a.from[0], a.to[1] - a.from[1]], L = Math.hypot(...d) || 1, n = [-d[1] / L, d[0] / L];
    return p => { const v = [p[0] - a.from[0], p[1] - a.from[1]], along = (v[0] * d[0] + v[1] * d[1]) / L, across = v[0] * n[0] + v[1] * n[1]; return along > -1 && along < L + 1 && Math.abs(across) < (a.width || 0) / 2 + 1; }; }));
  for (const [x, y, h = 8, r = 3] of site.trees || []) {
    if (feet.some(f => f([x, y]))) continue;   // a new building takes the trees where it stands
    const z = zAt(x, y), top = [x, y, z + h], ring = [0, 1, 2, 3, 4, 5].map(k => [x + Math.cos(k * Math.PI / 3) * r, y + Math.sin(k * Math.PI / 3) * r, z + h * 0.3]);
    for (let k = 0; k < 6; k++) tris.push([[ring[k], ring[(k + 1) % 6], top], C.tree]);
  }
  return { tris, edges, zAt };
}

/* the camera: stands at `from` degrees (0 north, 90 east), `tilt` above the ground, `dist` from the target; plan looks
   straight down with north up */
function camera({ target, from = 200, tilt = 35, dist = 300, plan = false, W, H, fov = 38 }) {
  if (plan) {
    const half = dist * Math.tan(fov * Math.PI / 360), k = (H / 2) / half;
    return { plan: true, scale: k, proj: p => [W / 2 + (p[0] - target[0]) * k, H / 2 - (p[1] - target[1]) * k, 1000 - p[2]] };
  }
  const a = from * Math.PI / 180, e = tilt * Math.PI / 180;
  const eye = [target[0] + Math.sin(a) * Math.cos(e) * dist, target[1] + Math.cos(a) * Math.cos(e) * dist, target[2] + Math.sin(e) * dist];
  const f = norm(sub(target, eye)), r = norm(cross(f, [0, 0, 1])), u = cross(r, f), F = (H / 2) / Math.tan(fov * Math.PI / 360);
  return { eye, proj: p => { const v = sub(p, eye), z = dot(v, f); return z < 0.5 ? null : [W / 2 + dot(v, r) / z * F, H / 2 - dot(v, u) / z * F, z]; } };
}

/* draws the scene into an RGB buffer, twice the size, then halves it */
export function render(site, { focus = [], from, tilt, dist, plan, target, width = 1024, height = 640 } = {}) {
  const W = width * 2, H = height * 2, rgb = new Uint8Array(W * H * 3), zb = new Float32Array(W * H).fill(Infinity);
  for (let i = 0; i < W * H; i++) rgb.set(C.sky, i * 3);
  const focusIds = new Set(focus), { tris, edges } = scene(site, focusIds), cam = camera({ target, from, tilt, dist, plan, W, H });
  const toEye = cam.plan ? () => [0, 0, 1] : p => norm(sub(cam.eye, p));
  for (const [[a, b, c], col, foc] of tris) {
    const pa = cam.proj(a), pb = cam.proj(b), pc = cam.proj(c); if (!pa || !pb || !pc) continue;
    let n = norm(cross(sub(b, a), sub(c, a))); if (dot(n, toEye(a)) < 0) n = n.map(v => -v);
    const lit = 0.58 + 0.42 * Math.max(0, dot(n, SUN)), tint = foc ? 0.82 : 1, shade = col.map((v, i) => Math.min(255, v * lit * tint + (foc ? C.focus[i] * 0.18 : 0)));
    const x0 = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(pa[0], pb[0], pc[0])));
    const y0 = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(pa[1], pb[1], pc[1])));
    const area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]); if (Math.abs(area) < 1e-9 || x0 > x1 || y0 > y1) continue;
    const iz = [1 / pa[2], 1 / pb[2], 1 / pc[2]];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((pb[0] - px) * (pc[1] - py) - (pb[1] - py) * (pc[0] - px)) / area, w1 = ((pc[0] - px) * (pa[1] - py) - (pc[1] - py) * (pa[0] - px)) / area, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = cam.plan ? w0 * pa[2] + w1 * pb[2] + w2 * pc[2] : 1 / (w0 * iz[0] + w1 * iz[1] + w2 * iz[2]), k = y * W + x;
      if (z >= zb[k]) continue; zb[k] = z; rgb[k * 3] = shade[0]; rgb[k * 3 + 1] = shade[1]; rgb[k * 3 + 2] = shade[2];
    }
  }
  /* the edges, where nothing nearer hides them */
  for (const [a, b, col, w] of edges) {
    const pa = cam.proj(a), pb = cam.proj(b); if (!pa || !pb) continue;
    const L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]), n = Math.max(1, Math.ceil(L)), r = w;   // w in halved pixels: twice that here
    for (let s = 0; s <= n; s++) {
      const q = s / n, x = pa[0] + (pb[0] - pa[0]) * q, y = pa[1] + (pb[1] - pa[1]) * q, z = cam.plan ? pa[2] + (pb[2] - pa[2]) * q : 1 / ((1 - q) / pa[2] + q / pb[2]);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 0.5) continue;
        const X = Math.round(x + dx), Y = Math.round(y + dy); if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const k = Y * W + X; if (z > zb[k] * (cam.plan ? 1 : 1.004) + (cam.plan ? 0.6 : 0.15)) continue;
        rgb[k * 3] = col[0]; rgb[k * 3 + 1] = col[1]; rgb[k * 3 + 2] = col[2];
      }
    }
  }
  /* halved */
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
    const i = (y * 2 * W + x * 2) * 3 + c; out[(y * width + x) * 3 + c] = (rgb[i] + rgb[i + 3] + rgb[i + W * 3] + rgb[i + W * 3 + 3]) >> 2;
  }
  /* north on the screen: where a point north of the target lands */
  const t0 = cam.proj(target), t1 = cam.proj([target[0], target[1] + 10, target[2]]);
  marks(out, width, height, cam, t0 && t1 ? Math.atan2(t1[0] - t0[0], -(t1[1] - t0[1])) : 0);
  return png(out, width, height);
}

/* the north arrow, top right; in plan a 50 m bar, bottom left */
function marks(px, W, H, cam, ang) {
  const put = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; px.set(c, (y * W + x) * 3); };
  const tri = (pts, c) => { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.max(...ys); y++) for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x++) {
      const s = (a, b) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]), [a, b, d] = pts, s1 = s(a, b), s2 = s(b, d), s3 = s(d, a);
      if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) put(x, y, c); } };
  const cx = W - 34, cy = 34, R = 20, rot = ([x, y]) => [cx + x * Math.cos(ang) - y * Math.sin(ang), cy + x * Math.sin(ang) + y * Math.cos(ang)];
  for (let y = -R - 4; y <= R + 4; y++) for (let x = -R - 4; x <= R + 4; x++) if (x * x + y * y <= (R + 4) ** 2) put(cx + x, cy + y, [255, 255, 255]);
  tri([rot([0, -R]), rot([R * 0.6, R * 0.75]), rot([0, R * 0.4])], C.north); tri([rot([0, -R]), rot([0, R * 0.4]), rot([-R * 0.6, R * 0.75])], C.north);
  if (cam.plan) { const L = Math.round(50 * cam.scale / 2); for (let y = H - 22; y < H - 16; y++) for (let x = 20; x < 20 + L; x++) put(x, y, Math.floor((x - 20) / (L / 5)) % 2 ? [255, 255, 255] : C.north);
    for (let y = H - 23; y < H - 15; y++) { put(19, y, C.north); put(20 + L, y, C.north); } }
}

/* RGB to PNG: filter 0 on every row, one IDAT */
function png(px, W, H) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(px.buffer, px.byteOffset + y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

/* what a look is aimed at: a wing (by id or name), a building, a new building (by id or name); its middle, its size,
   and the ids to pick out */
export function aimAt(site, what) {
  const low = String(what || "").toLowerCase();
  const w = (site.wings || []).find(x => x.id === what || x.name.toLowerCase() === low);
  const bs = w ? site.buildings.filter(b => b.wing === w.id) : site.buildings.filter(b => b.id === what);
  const a = (site.added || []).find(x => x.id === what || String(x.name).toLowerCase() === low);
  const pts = [...bs.flatMap(b => b.ring.map(p => [...p, b.base, b.top ?? b.base + 8])), ...(a ? a.parts.flatMap(p => p.tris ? p.tris.flat().map(q => [q[0], q[1], q[2], q[2]]) : p.axis.flatMap(q => p.profile.map(([s, z]) => [q[0], q[1], z, z]))) : [])];
  if (!pts.length) return null;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), lo = Math.min(...pts.map(p => p[2])), hi = Math.max(...pts.map(p => p[3]));
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), hi - lo);
  return { name: w ? w.name : a ? a.name : bs[0]?.name || "bygningen", ids: [...bs.map(b => b.id), ...(a ? [a.id] : [])],
    target: [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, lo + (hi - lo) * 0.4], size };
}

/* named views, as FreeCAD's get_view: the corners and sides by compass, and plan */
export const VIEWS = { isometrisk: { from: 225, tilt: 35 }, plan: { plan: true }, N: { from: 0, tilt: 12 }, Ø: { from: 90, tilt: 12 }, S: { from: 180, tilt: 12 }, V: { from: 270, tilt: 12 },
  NØ: { from: 45, tilt: 30 }, SØ: { from: 135, tilt: 30 }, SV: { from: 225, tilt: 30 }, NV: { from: 315, tilt: 30 } };

/* drawn off the server's thread (a look takes a second or two of arithmetic): one worker at a time, each picture in
   its own; `picture(site, opts)` resolves to the PNG */
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
if (!isMainThread && workerData?.sykehusRender) parentPort.postMessage(render(workerData.site, workerData.opts));
let queue = Promise.resolve();
export function picture(site, opts) {
  const run = () => new Promise((ok, no) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { sykehusRender: true, site, opts } });
    const t = setTimeout(() => { w.terminate(); no(new Error("Bildet tok for lang tid.")); }, 20000);
    w.once("message", png => { clearTimeout(t); ok(Buffer.from(png)); w.terminate(); }); w.once("error", e => { clearTimeout(t); no(e); });
  });
  const p = queue.then(run, run); queue = p.catch(() => {}); return p;
}
