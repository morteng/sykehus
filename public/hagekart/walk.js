/* Photo walk: the phone's camera inside the app, with where you stand (GPS) and which way
   the camera points (compass). Each photo is tied to the tree, hedge, bed or house the camera
   was pointing at, so the photos can later name what the aerial view only outlines.

   Photos are private to the browser that took them (api/images is owner-scoped, and the
   server strips doc.photos for everyone else). */
import { toUtm, toLngLat } from "./detect.js";
import { theTable } from "./catalog.js";
import { planPose, ghost3, ghostScreen, lineUpVerdict, steadyFor, flowInit, runFlow, flowSpot, shutterKind, keepRun, flowNote, coverMap } from "./anchor.js";
import { solvePose6, edgeMap, edgeScore, runBias, closeLoop, poseToDoc, framePose, framePrior, reposeRun, closureText } from "./pose.js";

const RAD = Math.PI / 180;
const BACKGROUND = new Set(["lawn", "paving", "driveway"]);   // the ray passes over these

/* Heading of the rear camera from a deviceorientation event (W3C spec formula; needs an
   absolute alpha). iOS gives it directly as webkitCompassHeading. */
export function cameraHeading(e) {
  if (typeof e.webkitCompassHeading === "number" && e.webkitCompassHeading >= 0) return e.webkitCompassHeading;
  if (!e.absolute || e.alpha == null || e.beta == null || e.gamma == null) return null;
  const a = e.alpha * RAD, b = e.beta * RAD, g = e.gamma * RAD;
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  const rA = -cA * sG - sA * sB * cG, rB = -sA * sG + cA * sB * cG;
  let h = Math.atan(rA / rB);
  if (rB < 0) h += Math.PI; else if (rA < 0) h += 2 * Math.PI;
  return h / RAD;
}

function inPoly([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* What the camera points at: the nearest tree or shrub whose crown the view line passes
   (with some slack for aim), or the first hedge, bed or house it enters. Up to 40 m. */
export function rayTarget(d, [lng, lat], heading, { radius = it => it.crown || 1, max = 40, slackDeg = 10, utm = toUtm } = {}) {
  if (heading == null) return null;
  const p = utm([lng, lat]), dir = [Math.sin(heading * RAD), Math.cos(heading * RAD)], slack = Math.tan(slackDeg * RAD);
  let best = null;
  const take = (type, id, t) => { if (!best || t < best.dist) best = { type, id, dist: +t.toFixed(1) }; };
  for (const it of d.items || []) {
    const c = utm([it.lng, it.lat]), v = [c[0] - p[0], c[1] - p[1]];
    const t = v[0] * dir[0] + v[1] * dir[1]; if (t < 0.5 || t > max) continue;
    const off = Math.abs(v[0] * dir[1] - v[1] * dir[0]);
    if (off <= radius(it) + Math.max(0.8, t * slack)) take("item", it.id, Math.max(0.5, t - radius(it)));
  }
  const shapes = [...(d.areas || []).filter(a => !BACKGROUND.has(a.kind)).map(a => ["area", a]), ...(d.buildings || []).map(b => ["building", b])];
  for (const [type, s] of shapes) {
    const ring = s.ring.map(utm);
    if (inPoly(p, ring)) continue;   // GPS put you inside it: look past it
    for (let t = 0.5; t <= Math.min(max, best ? best.dist : max); t += 0.5) {
      if (inPoly([p[0] + dir[0] * t, p[1] + dir[1] * t], ring)) { take(type, s.id, t); break; }
    }
  }
  return best;
}

/* A photo with a position but no compass: the thing nearest to where it was taken, as a guess. Trees, shrubs
   and the like within itemR m of their crown edge; beds, hedges and houses when you stand inside or within areaR m.
   Two near-equal candidates (less than 1 m apart) give no guess at all. Marked guess:true, so nothing built on a
   certain target (AI naming, quest spots) takes it for one. */
export function guessTarget(d, [lng, lat], { itemR = 6, areaR = 3, tie = 1, utm = toUtm } = {}) {
  const p = utm([lng, lat]), cands = [];
  for (const it of d.items || []) {
    const c = utm([it.lng, it.lat]), r = Math.max(0, Math.hypot(c[0] - p[0], c[1] - p[1]) - (it.crown || 0));
    if (r <= itemR) cands.push({ type: "item", id: it.id, dist: r });
  }
  const shapes = [...(d.areas || []).filter(a => !BACKGROUND.has(a.kind)).map(a => ["area", a]), ...(d.buildings || []).map(b => ["building", b])];
  for (const [type, s] of shapes) {
    const ring = s.ring.map(utm);
    let r = 0;
    if (!inPoly(p, ring)) {
      r = Infinity;
      for (let k = 0; k < ring.length - 1; k++) {
        const [ax, ay] = ring[k], [bx, by] = ring[k + 1], vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - ax) * vx + (p[1] - ay) * vy) / l2));
        r = Math.min(r, Math.hypot(p[0] - ax - vx * t, p[1] - ay - vy * t));
      }
    }
    if (r <= areaR) cands.push({ type, id: s.id, dist: r });
  }
  cands.sort((a, b) => a.dist - b.dist);
  if (!cands.length || (cands[1] && cands[1].dist - cands[0].dist < tie)) return null;
  return { type: cands[0].type, id: cands[0].id, dist: +cands[0].dist.toFixed(1), guess: true };
}

/* ---------- Photo pose: where a photo was taken, which way it looks, how wide ----------
   Each of position and heading carries where it came from (ph.posSrc, ph.dirSrc): "gps" / "compass" (the phone's own
   sensors on a walk), "exif" (the picture file's own tags), "manual" (the owner pinned or aimed it: never replaced by
   a guess or a merge default), "guess" or "none". Photos from before this had no source: photoSrc() infers it. */
export const DEFAULT_FOV = 65;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const norm360 = h => ((h % 360) + 360) % 360;
export const photoFov = ph => (Number.isFinite(ph?.fov) ? clamp(ph.fov, 10, 150) : DEFAULT_FOV);
export function photoSrc(ph, what) {
  if (what === "pos") return ph.posSrc || (ph.lng == null ? "none" : ph.acc != null ? "gps" : "manual");
  return ph.dirSrc || (ph.heading == null ? "none" : "compass");
}
/* What a photo still lacks. */
export const photoNeeds = ph => ({ pos: ph.lng == null, dir: ph.heading == null, any: ph.lng == null || ph.heading == null });

/* Local flat-earth helpers for drawing (fine over a garden): a point a distance and bearing away, and the bearing between two points. */
export function offsetLL([lng, lat], bearing, m) {
  const h = bearing * RAD;
  return [lng + (Math.sin(h) * m) / (111320 * Math.cos(lat * RAD)), lat + (Math.cos(h) * m) / 111320];
}
export function bearingLL([lng0, lat0], [lng1, lat1]) {
  return norm360(Math.atan2((lng1 - lng0) * Math.cos(lat0 * RAD), lat1 - lat0) / RAD);
}
/* The camera cone as a closed lng/lat ring: the position, the left edge, an arc, the right edge. */
export function coneRing(at, heading, fov, len, steps = 8) {
  const ring = [at];
  for (let k = 0; k <= steps; k++) ring.push(offsetLL(at, heading - fov / 2 + (fov * k) / steps, len));
  ring.push(at);
  return ring;
}

/* Phase-2 hooks: the photo as a ray and as a ground frustum in EPSG:25833 (metres, x east, y north), for 3D billboards,
   projecting the model into the picture, and segmentation. null while position or heading is missing.
   hfov is the horizontal field of view in degrees (the long side of a landscape picture); vfov follows from the pixel shape;
   pitch is the camera's tilt above level in degrees when the phone reported one (else 0). */
export function photoRay(ph, utm = toUtm) {
  if (ph?.lng == null || ph.heading == null) return null;
  const hfov = photoFov(ph), w = ph.w || 4, h = ph.h || 3;
  return {
    origin: utm([ph.lng, ph.lat]), heading: ph.heading, dir: [Math.sin(ph.heading * RAD), Math.cos(ph.heading * RAD)],
    hfov, vfov: +(2 * Math.atan(Math.tan((hfov * RAD) / 2) * (h / w)) / RAD).toFixed(2),
    pitch: photoPitch(ph.tilt), src: { pos: photoSrc(ph, "pos"), dir: photoSrc(ph, "dir") },
  };
}
export function photoFrustum(ph, { far = 30, steps = 8, utm = toUtm } = {}) {
  const r = photoRay(ph, utm); if (!r) return null;
  const [x, y] = r.origin, pts = [];
  for (let k = 0; k <= steps; k++) { const a = (r.heading - r.hfov / 2 + (r.hfov * k) / steps) * RAD; pts.push([x + Math.sin(a) * far, y + Math.cos(a) * far]); }
  return { ...r, far, left: pts[0], right: pts[steps], ring: [r.origin, ...pts, r.origin] };
}

/* ---------- Photo geometry: where a pixel lands on the ground, and the pose from taps on known corners ----------
   A pose is { x, y, z (metres, UTM and height above sea level), heading (deg clockwise from north), pitch (deg, down is
   negative), roll (deg), hfov (deg), w, h (pixels) }. Measured on real laser data by tools/bench/e1-photo-projection.mjs. */
function poseAxes(p) {
  const h = p.heading * RAD, t = p.pitch * RAD, r = (p.roll || 0) * RAD;
  const f = [Math.sin(h) * Math.cos(t), Math.cos(h) * Math.cos(t), Math.sin(t)], r0 = [Math.cos(h), -Math.sin(h), 0], u0 = [-Math.sin(h) * Math.sin(t), -Math.cos(h) * Math.sin(t), Math.cos(t)];
  const right = r0.map((v, i) => v * Math.cos(r) + u0[i] * Math.sin(r)), up = u0.map((v, i) => v * Math.cos(r) - r0[i] * Math.sin(r));
  return { f, right, up, focal: p.w / 2 / Math.tan((p.hfov * RAD) / 2) };
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/* A 3D point [x, y, z] in the photo: [u, v, depth] in pixels, or null when it is behind the camera. */
export function projectToPhoto(pose, P) {
  const { f, right, up, focal } = poseAxes(pose), d = [P[0] - pose.x, P[1] - pose.y, P[2] - pose.z], zc = dot3(d, f);
  if (zc <= 0.05) return null;
  return [pose.w / 2 + (focal * dot3(d, right)) / zc, pose.h / 2 - (focal * dot3(d, up)) / zc, zc];
}

/* Where the ray through pixel (u, v) first goes below a height field `heightAt(x, y)` (NaN outside it): { x, y, z, dist }
   (dist: horizontal metres from the camera), or null when it never does within `max` metres or leaves the field.
   Give it the terrain (DTM) for ground, or the laser surface (DOM) to stop on hedges, trees and walls. */
export function pixelToGround(pose, u, v, heightAt, { max = 120, step = 0.25 } = {}) {
  const { f, right, up, focal } = poseAxes(pose), a = (u - pose.w / 2) / focal, b = (v - pose.h / 2) / focal;
  let dx = f[0] + a * right[0] - b * up[0], dy = f[1] + a * right[1] - b * up[1], dz = f[2] + a * right[2] - b * up[2];
  const n = Math.hypot(dx, dy, dz); dx /= n; dy /= n; dz /= n;
  if (!(pose.z - heightAt(pose.x, pose.y) > 0)) return null;
  let t0 = 0;
  for (let t = step; t <= max; t += step) {
    const x = pose.x + dx * t, y = pose.y + dy * t, z = pose.z + dz * t, h = heightAt(x, y);
    if (Number.isNaN(h)) return null;
    if (z <= h) {
      let lo = t0, hi = t;
      for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (pose.z + dz * m <= heightAt(pose.x + dx * m, pose.y + dy * m)) hi = m; else lo = m; }
      const t1 = (lo + hi) / 2;
      return { x: pose.x + dx * t1, y: pose.y + dy * t1, z: pose.z + dz * t1, dist: Math.hypot(dx * t1, dy * t1) };
    }
    t0 = t;
  }
  return null;
}

/* Fix a photo's pose from taps on corners whose position is known: ties = [{ P: [x, y, z], uv: [u, v] }].
   Gauss-Newton with damping on x, y, heading and pitch (height, roll and field of view stay as given), where the
   sensor values act as a prior so that 2 taps (4 numbers for 4 unknowns) stay stable. Returns { pose, rms (pixels over the
   taps), sigma: { pos, heading, pitch } after the fix, iters }. */
export function solvePose(pose0, ties, { sigTap = 15, prior = { pos: 5, heading: 12, pitch: 3 }, iters = 40 } = {}) {
  const at = q => ({ ...pose0, x: q[0], y: q[1], heading: q[2], pitch: q[3] }), q0 = [pose0.x, pose0.y, pose0.heading, pose0.pitch];
  const sc = [prior.pos, prior.pos, prior.heading, prior.pitch];
  const res = q => {
    const p = at(q), r = [];
    for (const t of ties) { const pr = projectToPhoto(p, t.P); r.push(pr ? (pr[0] - t.uv[0]) / sigTap : 1000, pr ? (pr[1] - t.uv[1]) / sigTap : 1000); }
    for (let k = 0; k < 4; k++) r.push((q[k] - q0[k]) / sc[k]);
    return r;
  };
  const cost = r => r.reduce((s, v) => s + v * v, 0), eps = [0.01, 0.01, 0.01, 0.01];
  let q = q0.slice(), r = res(q), c = cost(r), lambda = 1e-3, it = 0, H = null;
  for (; it < iters; it++) {
    const J = q.map((_, k) => { const qq = q.slice(); qq[k] += eps[k]; return res(qq).map((v, i) => (v - r[i]) / eps[k]); });   // J[k][i]
    H = [0, 1, 2, 3].map(a => [0, 1, 2, 3].map(b => J[a].reduce((s, v, i) => s + v * J[b][i], 0)));
    const g = [0, 1, 2, 3].map(a => J[a].reduce((s, v, i) => s + v * r[i], 0));
    let accepted = false;
    for (let tries = 0; tries < 8 && !accepted; tries++) {
      const A = H.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) : v)));
      const d = solve4(A, g.map(v => -v)); if (!d) { lambda *= 10; continue; }
      const qn = q.map((v, k) => v + d[k]), rn = res(qn), cn = cost(rn);
      if (cn < c) { const done = c - cn < 1e-9 * (1 + c); q = qn; r = rn; c = cn; lambda = Math.max(1e-7, lambda / 5); accepted = true; if (done) it = iters; } else lambda *= 5;
    }
    if (!accepted) break;
  }
  const cov = H && invert4(H), sd = k => (cov && cov[k][k] > 0 ? Math.sqrt(cov[k][k]) * 1 : null);
  const m = ties.length * 2, rms = Math.sqrt(r.slice(0, m).reduce((s, v) => s + v * v, 0) / m) * sigTap;
  return { pose: at(q), rms, sigma: { pos: sd(0) != null ? Math.hypot(sd(0), sd(1)) : null, heading: sd(2), pitch: sd(3) }, iters: it };
}
function solve4(A, b) {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < 4; i++) {
    let p = i; for (let k = i + 1; k < 4; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    if (Math.abs(M[p][i]) < 1e-12) return null;
    [M[i], M[p]] = [M[p], M[i]];
    for (let k = i + 1; k < 4; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j < 5; j++) M[k][j] -= f * M[i][j]; }
  }
  const x = [0, 0, 0, 0];
  for (let i = 3; i >= 0; i--) { let s = M[i][4]; for (let j = i + 1; j < 4; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}
function invert4(A) {
  const cols = [0, 1, 2, 3].map(k => solve4(A, [0, 1, 2, 3].map(i => (i === k ? 1 : 0))));
  return cols.every(Boolean) ? [0, 1, 2, 3].map(i => [0, 1, 2, 3].map(j => cols[j][i])) : null;
}

/* How far off (metres, 1 sigma) a ground pixel lands, from the pose sigmas { pos, height, heading, pitch, roll (deg), fov
   (relative) }, on level ground `groundZ` (default 1.5 m under the camera). Linear propagation through the flat-ground
   intersection: { sigma (radial rms), range (along the view line), across }, or null when the pixel looks at or above the horizon. */
export function groundSigma(pose, u, v, sig, { groundZ = pose.z - 1.5 } = {}) {
  const base = [pose.x, pose.y, pose.z, pose.heading, pose.pitch, pose.roll || 0, pose.hfov];
  const sd = [sig.pos, sig.pos, sig.height, sig.heading, sig.pitch, sig.roll ?? 0, (sig.fov ?? 0) * pose.hfov];
  const at = q => {
    const p = { ...pose, x: q[0], y: q[1], z: q[2], heading: q[3], pitch: q[4], roll: q[5], hfov: q[6] }, { f, right, up, focal } = poseAxes(p);
    const a = (u - p.w / 2) / focal, b = (v - p.h / 2) / focal, d = [0, 1, 2].map(i => f[i] + a * right[i] - b * up[i]);
    if (d[2] >= -1e-3) return null;
    const t = (groundZ - p.z) / d[2];
    return [p.x + d[0] * t, p.y + d[1] * t];
  };
  const g0 = at(base); if (!g0) return null;
  const cov = [[0, 0], [0, 0]], eps = [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01];
  for (let k = 0; k < 7; k++) {
    if (!sd[k]) continue;
    const q = base.slice(); q[k] += eps[k]; const g1 = at(q); if (!g1) return null;
    const j = [(g1[0] - g0[0]) / eps[k], (g1[1] - g0[1]) / eps[k]];
    cov[0][0] += j[0] * j[0] * sd[k] ** 2; cov[0][1] += j[0] * j[1] * sd[k] ** 2; cov[1][1] += j[1] * j[1] * sd[k] ** 2;
  }
  const dx = g0[0] - pose.x, dy = g0[1] - pose.y, n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n;
  const range = ux * ux * cov[0][0] + 2 * ux * uy * cov[0][1] + uy * uy * cov[1][1], across = uy * uy * cov[0][0] - 2 * ux * uy * cov[0][1] + ux * ux * cov[1][1];
  return { sigma: Math.sqrt(cov[0][0] + cov[1][1]), range: Math.sqrt(range), across: Math.sqrt(across) };
}

/* Set where a photo was taken and/or which way it looks, as the owner did: patch is {lng, lat, heading, fov} (any of
   them; heading null clears it). The values become "manual", and the target is worked out again: the thing the ray now
   hits replaces the old ray or guess (never a target the owner chose by hand, ph.target.manual); no heading yet gives a
   nearest-thing guess instead. */
export function applyPose(d, ph, patch, { utm = toUtm } = {}) {
  if (patch.lng != null && patch.lat != null) { ph.lng = patch.lng; ph.lat = patch.lat; ph.acc = null; ph.posSrc = "manual"; }
  if ("heading" in patch) {
    if (patch.heading == null) { ph.heading = null; ph.dirSrc = "none"; }
    else { ph.heading = Math.round(norm360(patch.heading)); ph.dirSrc = "manual"; delete ph.guessed; }
  }
  if (patch.fov != null) ph.fov = Math.round(clamp(patch.fov, 20, 120));
  if (ph.lng == null) return ph;
  const mine = ph.target && !ph.target.guess && ph.target.manual;
  if (ph.heading != null) {
    const ray = rayTarget(d, [ph.lng, ph.lat], ph.heading, { utm });
    if (ray && !mine) ph.target = ray; else if (!ray && ph.target?.guess) delete ph.target;
  } else if (!ph.target || ph.target.guess) {
    const g = guessTarget(d, [ph.lng, ph.lat], { utm });
    if (g) ph.target = g; else delete ph.target;
    ph.guessed = true;
  }
  return ph;
}

/* ---------- EXIF: a small reader for the tags a garden photo can use ----------
   Position (GPS lat/lng), compass direction (GPSImgDirection), the position error (GPSHorizontalPositioningError),
   DateTimeOriginal, orientation and focal length, plus the pixel size from the JPEG header. Nothing else is kept, and the
   downscaled picture we upload carries none of it. Returns {} for anything that is not a JPEG with Exif; never throws. */
export function parseExif(input) {
  const out = {};
  try {
    const u = input instanceof Uint8Array ? input : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
    if (u[0] !== 0xff || u[1] !== 0xd8) return out;
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    let p = 2;
    while (p + 4 <= u.length && u[p] === 0xff) {
      const m = u[p + 1];
      if (m === 0xff) { p++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
      const len = dv.getUint16(p + 2);
      if (m === 0xe1 && u[p + 4] === 0x45 && u[p + 5] === 0x78 && u[p + 6] === 0x69 && u[p + 7] === 0x66) readTiff(dv, p + 10, p + 2 + len, out);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { out.ph = dv.getUint16(p + 5); out.pw = dv.getUint16(p + 7); break; }
      if (m === 0xda) break;
      p += 2 + len;
    }
  } catch { /* a damaged tag: keep what was read */ }
  return out;
}
function readTiff(dv, base, end, out) {
  const le = dv.getUint16(base) === 0x4949;
  if (dv.getUint16(base + 2, le) !== 42) return;
  const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const ifd = off => {
    const tags = new Map(), at = base + off, n = dv.getUint16(at, le);
    for (let k = 0; k < n && at + 2 + k * 12 + 12 <= end; k++) {
      const e = at + 2 + k * 12, type = dv.getUint16(e + 2, le), count = dv.getUint32(e + 4, le), size = (SZ[type] || 1) * count;
      tags.set(dv.getUint16(e, le), { type, count, at: size <= 4 ? e + 8 : base + dv.getUint32(e + 8, le), size, e });
    }
    return tags;
  };
  const num = (t, i = 0) => {
    if (!t) return null;
    if (t.type === 3) return dv.getUint16(t.at + 2 * i, le);
    if (t.type === 4) return dv.getUint32(t.at + 4 * i, le);
    if (t.type === 5) { const den = dv.getUint32(t.at + 8 * i + 4, le); return den ? dv.getUint32(t.at + 8 * i, le) / den : null; }
    if (t.type === 1) return dv.getUint8(t.at + i);
    return null;
  };
  const str = t => { if (!t || t.type !== 2) return null; let s = ""; for (let i = 0; i < t.count && dv.getUint8(t.at + i); i++) s += String.fromCharCode(dv.getUint8(t.at + i)); return s; };
  const t0 = ifd(dv.getUint32(base + 4, le));
  const o = num(t0.get(0x112)); if (o >= 1 && o <= 8) out.orientation = o;
  const ex = t0.get(0x8769) && ifd(num(t0.get(0x8769)));
  if (ex) {
    const taken = str(ex.get(0x9003)), m = taken && /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(taken);
    if (m) { const dt = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]); if (!Number.isNaN(+dt)) out.taken = dt.toISOString(); }
    const f = num(ex.get(0x920a)); if (f > 0) out.focal = +f.toFixed(2);
    const f35 = num(ex.get(0xa405)); if (f35 > 0) out.focal35 = f35;
  }
  const gp = t0.get(0x8825) && ifd(num(t0.get(0x8825)));
  if (gp) {
    const dms = t => t && t.type === 5 && t.count >= 3 ? num(t, 0) + num(t, 1) / 60 + num(t, 2) / 3600 : null;
    let lat = dms(gp.get(2)), lng = dms(gp.get(4));
    if (lat != null && lng != null) {
      if (str(gp.get(1))?.[0] === "S") lat = -lat;
      if (str(gp.get(3))?.[0] === "W") lng = -lng;
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)) { out.lat = lat; out.lng = lng; }
    }
    const dir = num(gp.get(0x11)); if (dir != null && dir >= 0 && dir <= 360) { out.heading = norm360(dir); out.headingRef = str(gp.get(0x10))?.[0] === "M" ? "M" : "T"; }
    const acc = num(gp.get(0x1f)); if (acc != null && acc >= 0) out.acc = +acc.toFixed(1);
  }
}
/* The canvas transform that draws an upright picture from stored pixels with EXIF orientation o (1-8); w and h are the
   stored size. Returns the upright size and the matrix for ctx.setTransform(...m). */
export function exifTransform(o, w, h) {
  const M = { 1: [1, 0, 0, 1, 0, 0], 2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h], 5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, h, 0], 7: [0, -1, -1, 0, h, w], 8: [0, -1, 1, 0, 0, w] };
  const k = M[o] ? o : 1;
  return k >= 5 ? { w: h, h: w, m: M[k] } : { w, h, m: M[k] };
}
/* How to draw a decoded picture upright. Browsers differ: most already turn a JPEG by its Exif orientation when they
   decode it (naturalWidth/Height are then the upright size), a few do not. The JPEG header's own size tells which, for
   the turned-by-90° cases; for the rest the browser's feature (CSS image-orientation) decides. Never turns twice. */
export function orientPlan(o, nw, nh, ex = {}, autoSupported = true) {
  const k = o >= 2 && o <= 8 ? o : 1;
  if (k === 1) return { w: nw, h: nh, m: [1, 0, 0, 1, 0, 0], manual: false };
  let auto = autoSupported;
  if (k >= 5 && ex.pw && ex.ph && ex.pw !== ex.ph) auto = nw === ex.ph && nh === ex.pw;
  return auto ? { w: nw, h: nh, m: [1, 0, 0, 1, 0, 0], manual: false } : { ...exifTransform(k, nw, nh), manual: true };
}
/* Horizontal field of view in degrees from the 35 mm equivalent focal length: the picture's long side is 36 mm wide, the short 24 mm.
   w and h are the upright pixel size. null without a focal length. */
export function fovFromExif(ex, w, h) {
  const f = ex?.focal35 > 0 ? ex.focal35 : null; if (!f) return null;
  const side = (w || 4) >= (h || 3) ? 36 : 24;
  return Math.round(clamp((2 * Math.atan(side / 2 / f)) / RAD, 20, 120));
}

/* ---------- Photos that wait for coverage ----------
   A shot is kept in the phone first (IndexedDB, else memory) and sits in the project under a provisional id with
   pending:true; the upload runs in the background and swaps in the server's id. */
export const pendingId = () => "pending-" + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));

/* The server's id in place of the provisional one: on the photo, and on quest spots it completed. The old id is kept
   as `was`, so a copy of the project that still has the provisional one (the desktop, merge.js) can be tidied. */
export function swapPhotoId(d, from, to) {
  const ph = (d.photos || []).find(p => p.id === from); if (!ph) return false;
  ph.was = from; ph.id = to; delete ph.pending; delete ph.lost;
  for (const q of d.quest?.items || []) if (q.done === from) q.done = to;
  for (const r of d.runs || []) for (const k of ["start", "end"]) if (r[k]?.photo === from) r[k] = { ...r[k], photo: to };   // the run's anchor frames
  return true;
}
/* The server refused the picture for good (not an image, too big): the record must not go on saying "uploading". It is
   marked lost, so the gallery shows "mangler bildet" and the owner can delete it. */
export function markPhotoLost(d, id) {
  const ph = (d.photos || []).find(p => p.id === id); if (!ph) return false;
  delete ph.pending; ph.lost = true;
  return true;
}

export function memStore() {
  const m = new Map();
  return { put: async e => { m.set(e.id, e); }, all: async () => [...m.values()], del: async id => { m.delete(id); } };
}
/* IndexedDB with a memory fallback when it is missing or fails (private mode): the queue then lives until the page closes. */
export function idbStore(name = "hagekart-uploads") {
  const mem = memStore();
  let dbp = null;
  const open = () => dbp ||= new Promise((ok, no) => {
    try {
      const rq = indexedDB.open(name, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("q", { keyPath: "id" });
      rq.onsuccess = () => ok(rq.result); rq.onerror = () => no(rq.error); rq.onblocked = () => no(new Error("blocked"));
    } catch (e) { no(e); }
  });
  const run = (mode, f) => open().then(db => new Promise((ok, no) => { const t = db.transaction("q", mode), r = f(t.objectStore("q")); t.oncomplete = () => ok(r?.result); t.onerror = t.onabort = () => no(t.error); }));
  return {
    put: async e => { await mem.put(e); try { await run("readwrite", st => st.put(e)); } catch (x) { console.warn("IndexedDB", x); } },
    all: async () => { try { const a = await run("readonly", st => st.getAll()); for (const e of a || []) await mem.put(e); } catch (x) { console.warn("IndexedDB", x); } return mem.all(); },
    del: async id => { await mem.del(id); try { await run("readwrite", st => st.delete(id)); } catch (x) { console.warn("IndexedDB", x); } },
  };
}

/* The queue itself: store {put, all, del} and upload(dataUrl) → {id} are injected. Entries are {id, project, image}.
   flush(id) tries one at once; drain() goes through all of them, stopping at the first network or server failure.
   A 4xx (not 408/429) is the server refusing the picture for good (415 not an image, 413 too big, 400, 422): the entry is set
   aside and onRefused hears why. A full store is "later", never "never": 409 with code images_cap, 507, 408 and 429 keep the
   entry (also in the store) and drain stops; blocked() says so, so the page can tell the user. A 409 without that code is
   something else and is treated as a refusal too. */
export const isCapped = err => err?.status === 507 || (err?.status === 409 && (err.code === "images_cap" || err.body?.code === "images_cap")) || err?.code === "storage_full" || err?.body?.code === "storage_full";
export function createUploadQueue({ store = memStore(), upload, canUpload = () => true, onUploaded, onRefused, concurrency = 3, timeoutMs = size => 25e3 + size / 20, backoffMs = n => Math.min(300e3, 4e3 * 2 ** n), now = () => Date.now() }) {
  const mem = new Map(), inflight = new Map(), dead = new Set();
  let capped = false, running = null, holdUntil = 0;
  let loaded = null;
  const load = () => loaded ||= store.all().then(a => { for (const e of a) if (!mem.has(e.id)) mem.set(e.id, e); }, () => {});
  /* One try, never longer than the timeout: a request that hangs on a weak connection is aborted (and, for an upload
     that ignores the signal, simply given up on) so it fails as a 408 and the entry is retried later. */
  const tryUpload = e => new Promise((ok, no) => {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const t = setTimeout(() => { ctl?.abort(); no(Object.assign(new Error("Opplastingen tok for lang tid"), { status: 408 })); }, typeof timeoutMs === "function" ? timeoutMs(String(e.image).length * 0.75) : timeoutMs);
    Promise.resolve().then(() => upload(e.image, ctl?.signal)).then(r => { clearTimeout(t); ok(r); }, x => { clearTimeout(t); no(x); });
  });
  const attempt = e => {
    if (inflight.has(e.id)) return inflight.get(e.id);
    const run = (async () => {
      try {
        const out = await tryUpload(e);
        if (!out?.id) throw new Error("no id");
        capped = false;
        mem.delete(e.id);
        try { await store.del(e.id); } catch { /* the entry may come back and upload twice: harmless */ }
        onUploaded?.(e, out.id);
        return { id: out.id };
      } catch (err) {
        const st = err?.status;
        if (isCapped(err)) { capped = true; return { error: err, capped: true }; }
        if (st === 429) {   // the server says how long to wait (rate_limited, retryAfter seconds): the whole queue waits exactly that, no hammering
          const ra = +(err.body?.retryAfter ?? err.retryAfter) || 60;
          holdUntil = Math.max(holdUntil, now() + ra * 1000); e.next = holdUntil;
          return { error: err, limited: true };
        }
        if (st >= 400 && st < 500 && st !== 408 && st !== 429) { dead.add(e.id); try { await store.del(e.id); } catch { /* it would only be refused again at the next start */ } onRefused?.(e, err); return { refused: true }; }
        e.fails = (e.fails || 0) + 1; e.next = now() + backoffMs(e.fails - 1);   // in memory only: a new page load tries at once
        return { error: err };
      } finally { inflight.delete(e.id); }
    })();
    inflight.set(e.id, run); return run;
  };
  /* up to `concurrency` uploads at once; an entry that failed waits out its own backoff (unless force) and does not hold up the
     others; the run stops early after 3 failures in a row (no network at all) or when the store is full */
  async function work(force) {
    await load(); let n = 0, bad = 0;
    if (now() < holdUntil) return 0;
    const todo = [...mem.values()].filter(e => !dead.has(e.id) && !inflight.has(e.id) && canUpload(e) && (force || !(e.next > now())));
    const worker = async () => {
      while (todo.length && bad < 3 && !capped && now() >= holdUntil) {
        const r = await attempt(todo.shift());
        if (r.id) { n++; bad = 0; } else if (r.error) bad++;
      }
    };
    capped = false;
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
    return n;
  }
  return {
    async add(e) { mem.set(e.id, e); try { await store.put(e); } catch (x) { console.warn("kø", x); } },
    async load() { await load(); },
    count: (project) => [...mem.values()].filter(e => !dead.has(e.id) && (project == null || e.project === project)).length,
    get: id => mem.get(id),
    blocked: () => capped,
    holdSeconds: () => Math.max(0, Math.ceil((holdUntil - now()) / 1000)),
    async flush(id) { const e = mem.get(id); if (!e) return null; const r = await attempt(e); return r.id || null; },
    /* drain({force}) ignores the per-entry backoff ("Prøv igjen" button). Two calls at once share one run. */
    drain({ force = false } = {}) { return running ||= work(force).finally(() => { running = null; }); },
  };
}

/* What the walk says when it is closed: the pictures are in the project; those not on the server yet stay on the phone. */
export function closeNote(count, waiting) {
  if (!count) return waiting ? `${waiting} bilde${waiting === 1 ? "" : "r"} venter på nett, åpne appen med dekning for å laste dem opp.` : "";
  const base = `${count} bilde${count === 1 ? "" : "r"} lagret i prosjektet.`;
  return waiting ? `${base} ${waiting} av dem venter på nett: åpne appen med dekning for å laste dem opp. De er trygt lagret på telefonen.` : `${base} På PC-en finner du dem under Utforsk → Bilder fra hagen, og som kamera i kartet.`;
}

/* Map features for the photo spots: a dot where you stood and a short line where you looked. The chosen photo also gets
   its camera cone (kind "cone") and a handle at the tip of the cone to drag the direction (kind "handle", set:false while there is no heading yet). */
export function photoFeatures(photos = [], { selectedId = null, len = 12 } = {}) {
  const out = [];
  for (const ph of photos) {
    out.push({ type: "Feature", properties: { id: ph.id, kind: "pt" }, geometry: { type: "Point", coordinates: [ph.lng, ph.lat] } });
    const at = [ph.lng, ph.lat], sel = ph.id === selectedId;
    if (sel) {
      if (ph.heading != null) out.push({ type: "Feature", properties: { id: ph.id, kind: "cone" }, geometry: { type: "Polygon", coordinates: [coneRing(at, ph.heading, photoFov(ph), len)] } });
      out.push({ type: "Feature", properties: { id: ph.id, kind: "handle", set: ph.heading != null }, geometry: { type: "Point", coordinates: offsetLL(at, ph.heading ?? 0, len) } });
    }
    if (ph.heading == null) continue;
    out.push({ type: "Feature", properties: { id: ph.id, kind: "look" }, geometry: { type: "LineString", coordinates: [at, offsetLL(at, ph.heading, sel ? len : 4)] } });
  }
  return out;
}

/* ---------- The camera screen ---------- */
/* ---------- photo quest: the pictures the app still needs ----------
   Worked out from the project each time, so the list grows and shrinks with what we know:
   - every unnamed tree or bush of some size, until a photo shows it (plants close together
     share one spot); if the AI then could not name it, a close-up of leaves or flowers;
   - the edges between different surfaces on the lot (lawn against bed, paving, ...), sampled
     every ~10 m, until a photo looks at each sample; edges along the lot line or walls are
     already known from the maps and are left out;
   - the strip along each house wall that faces the garden, every ~5 m (beds against walls are
     too narrow for the laser and aerial photo to see), and one shot of each small bed;
   - two wide shots with the house in them, from places 8 m apart (to work out where photos
     were taken).
   A photo "sees" a point when it was taken within 12 m of it, looking within 30° of it. */
const UNNAMED = new Set(["tre", "busk"]);
const bearing = ([x0, y0], [x1, y1]) => (Math.atan2(x1 - x0, y1 - y0) / RAD + 360) % 360;
const angleOff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
export function sees(ph, pt, { utm = toUtm, maxD = 12, halfFov = 30 } = {}) {
  if (ph.lng == null || ph.heading == null) return false;
  const at = utm([ph.lng, ph.lat]), d = Math.hypot(pt[0] - at[0], pt[1] - at[1]);
  return d <= maxD && (d < 1 || angleOff(bearing(at, pt), ph.heading) <= halfFov);
}
export function planQuest(d, { utm = toUtm, lngLat } = {}) {
  const lot = d.lot.ring.map(utm), blds = d.buildings.map(b => b.ring.map(utm)), photos = (d.photos || []).filter(ph => ph.lng != null).map(ph => ph.target?.guess ? { ...ph, target: null } : ph);   // a guessed target does not count
  const n = lot.length - 1, cx = lot.slice(0, n).reduce((a, p) => a + p[0], 0) / n, cy = lot.slice(0, n).reduce((a, p) => a + p[1], 0) / n;
  const segDist = (p, ring) => { let m = Infinity; for (let k = 0; k < ring.length - 1; k++) { const [ax, ay] = ring[k], [bx, by] = ring[k + 1], vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((p[0] - ax) * vx + (p[1] - ay) * vy) / (vx * vx + vy * vy || 1))); m = Math.min(m, Math.hypot(p[0] - ax - t * vx, p[1] - ay - t * vy)); } return m; };
  const standable = p => inPoly(p, lot) && !blds.some(b => inPoly(p, b));
  const standFor = (t, r) => {
    const a0 = Math.atan2(cy - t[1], cx - t[0]);
    for (let k = 0; k < 8; k++) { const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 4, p = [t[0] + Math.cos(a) * r, t[1] + Math.sin(a) * r]; if (standable(p)) return p; }
    return null;
  };
  const area = r => Math.abs(r.reduce((s2, p, k) => { const q = r[(k + 1) % r.length]; return s2 + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
  const out = [], add = (key, kind, stand, look, target, text, prio) => out.push({ key, kind, stand, heading: Math.round(bearing(stand, look)), target, text, prio });

  /* plants */
  const aiOf = i => photos.filter(ph => ph.target?.id === i.id && ph.ai?.result);
  const plants = d.items.filter(i => UNNAMED.has(i.pid) && i.st !== "planned" && (i.pid === "tre" ? (i.h || 0) >= 2.5 : (i.crown || 0) >= 1.2 || (i.h || 0) >= 1.5))
    .map(i => ({ i, p: utm([i.lng, i.lat]) })).sort((a, b) => (b.i.h || 0) * (b.i.crown || 1) - (a.i.h || 0) * (a.i.crown || 1));
  const grouped = new Set();
  for (const { i, p } of plants) {
    if (grouped.has(i.id)) continue;
    const shots = photos.filter(ph => ph.target?.id === i.id || sees(ph, p, { utm }));
    if (!shots.length) {
      const near = plants.filter(o => !grouped.has(o.i.id) && Math.hypot(o.p[0] - p[0], o.p[1] - p[1]) < 8 && !photos.some(ph => ph.target?.id === o.i.id || sees(ph, o.p, { utm })));
      near.forEach(o => grouped.add(o.i.id));
      const mid = [near.reduce((a, o) => a + o.p[0], 0) / near.length, near.reduce((a, o) => a + o.p[1], 0) / near.length];
      const st = standFor(mid, Math.max(3, (i.crown || 1) * 1.5 + 1)); if (!st) continue;
      const trees = near.filter(o => o.i.pid === "tre").length, what = near.length === 1 ? (trees ? `treet${i.h ? ` (${Math.round(i.h)} m)` : ""}` : "busken") : `de ${near.length} ${trees === near.length ? "trærne" : trees ? "plantene" : "buskene"}`;
      add("s:" + near.map(o => o.i.id).sort().join(","), "species", st, mid, { type: "item", id: i.id }, `Ta bilde av ${what} så vi kan artsbestemme ${near.length === 1 ? (trees ? "det" : "den") : "dem"}`, 50 + Math.min(40, (i.h || 1) * (i.crown || 1)));
      continue;
    }
    /* photographed, and the AI looked but was unsure: ask for a close-up (at most twice) */
    const tried = aiOf(i);
    if (tried.length && tried.length < 3 && !tried.some(ph => (ph.ai.result.species?.confidence || 0) >= 0.6)) {
      const st = standFor(p, Math.max(1.5, (i.crown || 1) * 0.6 + 0.5)); if (!st) continue;
      add("c:" + i.id + ":" + tried.length, "closeup", st, p, { type: "item", id: i.id }, `Ta et nærbilde av blader, blomster eller bark på ${i.pid === "tre" ? "treet" : "busken"}, så KI-en ser bedre hva det er`, 80);
    }
  }

  /* edges between surfaces inside the lot */
  const NAME = theTable();
  for (const a of d.areas) {
    if (!NAME[a.kind] || a.st === "planned") continue;
    const r = a.ring.map(utm), samples = [];
    if (area(r) < 15) {
      if (a.kind !== "bed" || area(r) < 1 || photos.some(ph => ph.target?.id === a.id)) continue;
      const m = r.length - 1, c = [r.slice(0, m).reduce((s2, q) => s2 + q[0], 0) / m, r.slice(0, m).reduce((s2, q) => s2 + q[1], 0) / m];
      if (photos.some(ph => sees(ph, c, { utm, maxD: 8, halfFov: 35 }))) continue;
      const st = standFor(c, 3); if (st) add("b:" + a.id, "bed", st, c, { type: "area", id: a.id }, "Ta bilde av bedet, så ser vi hva som vokser der", 45);
      continue;
    }
    let next = 5;                                                   // metres along the outline to the next sample
    for (let k = 0; k < r.length - 1; k++) {
      const A = r[k], B = r[k + 1], L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 1e-6) continue;
      const nx = (B[1] - A[1]) / L, ny = -(B[0] - A[0]) / L;
      let t = next;
      for (; t < L; t += 20) {
        const p = [A[0] + (B[0] - A[0]) * t / L, A[1] + (B[1] - A[1]) * t / L];
        let q = [p[0] + nx * 1.5, p[1] + ny * 1.5]; if (inPoly(q, r)) q = [p[0] - nx * 1.5, p[1] - ny * 1.5];
        if (segDist(p, lot) > 1.5 && blds.every(bd => segDist(p, bd) > 1.5) && standable(q)) samples.push({ p, k });
      }
      next = t - L;
    }
    const open = samples.filter(sm => !photos.some(ph => sees(ph, sm.p, { utm, maxD: 15, halfFov: 35 })));
    while (open.length) {
      const sm = open.shift(), st = standFor(sm.p, 7); if (!st) continue;
      const h = bearing(st, sm.p);
      for (let j = open.length - 1; j >= 0; j--) { const o = open[j].p, dd = Math.hypot(o[0] - st[0], o[1] - st[1]); if (dd <= 15 && angleOff(bearing(st, o), h) <= 35) open.splice(j, 1); }
      add(`e:${a.id}:${Math.round(sm.p[0])},${Math.round(sm.p[1])}`, "edge", st, sm.p, { type: "area", id: a.id }, `Ta bilde av kanten av ${NAME[a.kind]}, så tegner vi den mer nøyaktig`, 10 + Math.min(35, area(r) / 50));
    }
  }

  /* the strip along house walls: stand 3 m out (2.2 m if tight), face the wall */
  blds.forEach((b, bi) => {
    const inB = q => inPoly(q, b);
    for (let k = 0; k < b.length - 1; k++) {
      const A = b[k], B = b[k + 1], L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 2) continue;
      let nx = (B[1] - A[1]) / L, ny = -(B[0] - A[0]) / L;
      const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]; if (inB([mid[0] + nx * 0.5, mid[1] + ny * 0.5])) { nx = -nx; ny = -ny; }
      const cnt = Math.max(1, Math.round(L / 5));
      for (let j = 0; j < cnt; j++) {
        const t = (j + 0.5) / cnt, p = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t], strip = [p[0] + nx * 0.8, p[1] + ny * 0.8];
        if (!standable(strip) || photos.some(ph => sees(ph, strip, { utm, maxD: 8, halfFov: 35 }))) continue;
        const st = [3, 2.2].map(r => [p[0] + nx * r, p[1] + ny * r]).find(standable); if (!st) continue;
        add(`v:${d.buildings[bi].id}:${Math.round(strip[0])},${Math.round(strip[1])}`, "wall", st, strip, { type: "building", id: d.buildings[bi].id }, "Ta bilde av stripen langs husveggen, så ser vi bed og planter der", 40);
      }
    }
  });

  /* wide shots with the house */
  const house = blds.map((b, k) => ({ b, k, A: area(b) })).sort((x, y) => y.A - x.A)[0];
  if (house) {
    const m = house.b.length - 1, hc = [house.b.slice(0, m).reduce((s2, p) => s2 + p[0], 0) / m, house.b.slice(0, m).reduce((s2, p) => s2 + p[1], 0) / m];
    const wides = []; for (const ph of photos) { const at = utm([ph.lng, ph.lat]); if (Math.hypot(at[0] - hc[0], at[1] - hc[1]) >= 6 && sees(ph, hc, { utm, maxD: 45 }) && wides.every(w => Math.hypot(w[0] - at[0], w[1] - at[1]) > 8)) wides.push(at); }
    const corners = lot.slice(0, n).map(p => { const v = [cx - p[0], cy - p[1]], L = Math.hypot(...v) || 1; return [p[0] + v[0] / L * 2, p[1] + v[1] / L * 2]; })
      .filter(standable).filter(c => wides.every(w => Math.hypot(w[0] - c[0], w[1] - c[1]) > 8))
      .sort((p, q) => Math.hypot(q[0] - hc[0], q[1] - hc[1]) - Math.hypot(p[0] - hc[0], p[1] - hc[1]));
    const picked = []; for (const c of corners) if (picked.length + wides.length < 2 && picked.every(p => Math.hypot(p[0] - c[0], p[1] - c[1]) > 8)) picked.push(c);
    picked.forEach((c, k) => add(`w:${wides.length + k}`, "wide", c, hc, { type: "building", id: d.buildings[house.k].id }, "Oversiktsbilde med huset og hagen", 100));
  }
  if (lngLat) for (const q of out) { [q.lng, q.lat] = lngLat(q.stand); delete q.stand; }
  return out;
}
/* The quest after new photos or names: spots still needed keep their place (and number),
   spots no longer needed are ticked off, new needs are added at the end. */
export function updateQuest(d, opts) {
  const needs = planQuest(d, opts), byKey = new Map(needs.map(q => [q.key, q]));
  const old = d.quest?.items || [], items = [], ticked = [];
  for (const q of old) {
    if (q.done || byKey.has(q.key)) { items.push(q); byKey.delete(q.key); continue; }
    q.done = q.done || "covered"; items.push(q); ticked.push(q);
  }
  let k = items.length; for (const q of [...byKey.values()].sort((a, b) => b.prio - a.prio)) items.push({ ...q, id: `q${++k}` });
  d.quest = { at: d.quest?.at || new Date().toISOString(), updated: new Date().toISOString(), items };
  return { ticked, added: byKey.size, open: items.filter(q => !q.done).length };
}
/* The spots shown now: the first open ones in list order, ten at a time. */
export const QUEST_BATCH = 10;
export const questNow = d => (d.quest?.items || []).filter(q => !q.done).slice(0, QUEST_BATCH);

/* Which quest spots a photo completes. */
export function questDone(q, ph, utm = toUtm) {
  if (ph.lng == null || ph.heading == null) return false;
  const [x0, y0] = utm([q.lng, q.lat]), [x1, y1] = utm([ph.lng, ph.lat]);
  const dh = Math.abs(((ph.heading - q.heading + 540) % 360) - 180);
  return Math.hypot(x1 - x0, y1 - y0) <= Math.max(5, Math.min(10, ph.acc || 5)) && dh <= 45;
}

/* ---------- Phone sensors: the pure parts (tests/walk.test.mjs) ----------
   Everything here takes its inputs as arguments (a geolocation object, a clock, an event), so it can be tested without a phone. */
export const GPS_FRESH_S = 30, GPS_USABLE_S = 60, GPS_POOR_M = 25, COMPASS_POOR_DEG = 25;

export function platformOf(ua = "", platform = "") {
  const s = `${ua} ${platform}`;
  return /iPhone|iPad|iPod/.test(s) ? "ios" : /Android/.test(s) ? "android" : "other";
}
/* A short, anonymous device summary: the kinds of OS and browser, never the user-agent string or any id. */
export function deviceInfo(ua = "", platform = "", touch = false) {
  const os = platformOf(ua, platform) !== "other" ? platformOf(ua, platform) : /Mac/.test(`${ua} ${platform}`) ? "mac" : /Win/.test(`${ua} ${platform}`) ? "windows" : /Linux|X11/.test(`${ua} ${platform}`) ? "linux" : "other";
  const m = re => re.exec(ua)?.[1];
  const [browser, v] = /Edg\//.test(ua) ? ["edge", m(/Edg\/(\d+)/)] : /Firefox\/|FxiOS\//.test(ua) ? ["firefox", m(/(?:Firefox|FxiOS)\/(\d+)/)]
    : /CriOS\/|Chrome\//.test(ua) ? ["chrome", m(/(?:CriOS|Chrome)\/(\d+)/)] : /Safari\//.test(ua) ? ["safari", m(/Version\/(\d+)/)] : ["other", null];
  return { os, browser, v: v ? +v : null, mobile: os === "ios" || os === "android" || !!touch };
}

/* What to tell the owner when the position is missing, per error code (1 denied, 2 unavailable, 3 timeout; 0 = no support). */
export function geoHelp(code, { platform = "other", secure = true, lastAge = null } = {}) {
  const settings = platform === "ios"
    ? "iPhone: Innstillinger › Personvern og sikkerhet › Stedstjenester › Safari-nettsteder (eller Nettleser) › velg «Når du bruker appen» og slå på Presis posisjon. Last siden på nytt."
    : platform === "android"
      ? "Android (Chrome): trykk på ikonet ved adressefeltet › Innstillinger for nettstedet › Posisjon › Tillat. Slå også på Posisjon og Presis posisjon i telefonens innstillinger. Last siden på nytt."
      : "Tillat posisjon for denne siden i nettleserens innstillinger, og last siden på nytt.";
  if (code === 0) return { head: "Denne nettleseren kan ikke gi posisjon.", fix: "Prøv Safari på iPhone eller Chrome på Android." };
  if (code === 1) return { head: "Posisjon er blokkert for denne siden.", fix: (secure ? "" : "Siden må åpnes med https. ") + settings };
  if (code === 2) return { head: "Telefonen får ikke tak i noen posisjon.", fix: "Gå ut i det fri og se at Stedstjenester / Posisjon og Presis posisjon er slått på. Slå av og på flymodus om det ikke hjelper." };
  if (code === 3) return { head: lastAge != null ? `GPS-en svarer ikke. Bruker siste posisjon (${Math.round(lastAge)} s gammel).` : "GPS-en svarer ikke i tide.", fix: "Gå ut i det fri og vent noen sekunder. Slå på Presis posisjon om den er av." };
  return { head: "Ukjent feil med posisjonen.", fix: settings };
}

/* The geolocation side of a walk. `geo` is navigator.geolocation (or a stand-in), `now` the clock in ms.
   - Asks for the position at once with getCurrentPosition (that is what raises the permission prompt), then watches it.
   - A failure (any error code) is remembered, and never wipes the last good fix: that stays usable for 60 s,
     marked "gps" while younger than 30 s and "gps-stale" after that. Older than that, or none at all: "none".
   - A phone that stands still may stop sending updates, so tick() asks again when it has been quiet for 10 s. */
export function createGeoTracker({ geo, now = Date.now, onChange = () => {}, poll = 10_000 } = {}) {
  let last = null, error = null, watch = null, startedAt = 0, lastEvent = 0, secure = true;
  const ok = p => {
    const c = p.coords || {}, t = now();
    last = { lng: c.longitude, lat: c.latitude, acc: c.accuracy, alt: Number.isFinite(c.altitude) ? c.altitude : null, altAcc: Number.isFinite(c.altitudeAccuracy) ? c.altitudeAccuracy : null,
      speed: Number.isFinite(c.speed) ? c.speed : null, ts: Number.isFinite(p.timestamp) ? p.timestamp : t, at: t };
    error = null; lastEvent = t; onChange();
  };
  const fail = e => { error = { code: e?.code === 1 || e?.code === 2 || e?.code === 3 ? e.code : 2, message: e?.message || "" }; lastEvent = now(); onChange(); };
  const request = () => { try { geo.getCurrentPosition(ok, fail, { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }); } catch (e) { fail(e); } };
  const age = () => (last ? Math.max(0, (now() - last.at) / 1000) : null);
  return {
    start({ isSecure = true } = {}) {
      secure = isSecure; startedAt = lastEvent = now();
      if (!geo) { error = { code: 0, message: "unsupported" }; onChange(); return; }
      request();
      try { watch = geo.watchPosition(ok, fail, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 }); } catch (e) { fail(e); }
    },
    stop() { try { if (watch != null) geo?.clearWatch(watch); } catch { /* gone */ } watch = null; },
    retry() { if (geo) request(); },
    tick() { if (geo && error?.code !== 1 && error?.code !== 0 && now() - lastEvent >= poll) { lastEvent = now(); request(); } },
    last: () => last, error: () => error,
    /* the fix a photo may use right now: {src: "gps" | "gps-stale" | "none", fix, age (s)} */
    use() {
      const a = age();
      if (!last || a > GPS_USABLE_S) return { src: "none", fix: null, age: a };
      return { src: a <= GPS_FRESH_S ? "gps" : "gps-stale", fix: last, age: a };
    },
    /* for the chip: level ok/warn/bad, a state word, and the help text when something is wrong */
    status() {
      const a = age(), platform = tracker_platform();
      const help = code => geoHelp(code, { platform, secure, lastAge: a });
      if (error?.code === 0) return { level: "bad", state: "unsupported", acc: null, age: null, error, ...help(0) };
      if (last && a <= GPS_FRESH_S) {
        return last.acc > GPS_POOR_M
          ? { level: "warn", state: "weak", acc: last.acc, age: a, error, head: `Svak posisjon (±${Math.round(last.acc)} m).`, fix: "Gå ut i det åpne, bort fra bygninger og trær, og slå på Presis posisjon. Bildene får dårligere plassering." }
          : { level: "ok", state: "ok", acc: last.acc, age: a, error };
      }
      if (last && a <= GPS_USABLE_S) return { level: "warn", state: "stale", acc: last.acc, age: a, error, ...(error ? help(error.code) : { head: `Siste posisjon er ${Math.round(a)} s gammel.`, fix: "Vent noen sekunder på ny posisjon." }) };
      if (error?.code === 1) return { level: "bad", state: "denied", acc: null, age: a, error, ...help(1) };
      if (error) return { level: "bad", state: "none", acc: null, age: a, error, ...help(error.code) };
      if (now() - startedAt < 20_000) return { level: "warn", state: "waiting", acc: null, age: null, error: null, head: "Venter på første posisjon …", fix: "Gå ut i det fri. Si ja om telefonen spør om å bruke posisjonen din." };
      return { level: "bad", state: "none", acc: null, age: null, error: null, ...help(3) };
    },
  };
  function tracker_platform() { return platformOf(globalThis.navigator?.userAgent, globalThis.navigator?.platform); }
}

/* Phone tilt to camera pitch. DeviceOrientation gives beta (front-back tilt, -180..180) and gamma (left-right, -90..90);
   the rear camera looks along the device's -z axis, whose height above level is -cos(beta)·cos(gamma). Upright portrait
   (beta 90) looks level, flat on its back (beta 0) looks straight down, leaning back (beta 120) looks 30° up. The older
   `beta - 90` is the same only when gamma is 0: held in landscape (gamma ±90) beta swings anywhere (the -156..92 seen on
   the first walk) while the camera is in fact level. */
export function tiltToPitch(beta, gamma = 0) {
  if (!Number.isFinite(beta)) return null;
  const s = -Math.cos(beta * RAD) * Math.cos((Number.isFinite(gamma) ? gamma : 0) * RAD);
  return +(Math.asin(Math.max(-1, Math.min(1, s))) / RAD).toFixed(1) + 0;
}
/* Is a tilt reading believable for a hand-held garden photo? null when fine, else why not. */
export function tiltCheck(t) {
  if (!t || !Number.isFinite(t.beta)) return null;
  if (Math.abs(t.beta) > 180 || (Number.isFinite(t.gamma) && Math.abs(t.gamma) > 90)) return "range";
  const p = tiltToPitch(t.beta, t.gamma);
  return Math.abs(p) > 75 ? "extreme" : null;   // looking almost straight up or down: no garden photo is taken so
}
const r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
export function tiltRecord(e) {
  const t = { alpha: r1(e.alpha), beta: r1(e.beta), gamma: r1(e.gamma) };
  t.pitch = tiltToPitch(t.beta, t.gamma);
  const flag = tiltCheck(t); if (flag) t.flag = flag;
  return t;
}
/* The pitch of a stored photo: from beta and gamma (also for photos from before `pitch` was stored). */
export const photoPitch = tilt => (tilt?.beta == null ? 0 : tiltToPitch(tilt.beta, tilt.gamma) ?? 0);

/* One photo's record from what the phone knew at the moment of the shot. use = tracker.use(); ori = {heading, src, acc, abs,
   screen, tilt}; cam = the camera track's settings. No ids of the person or the phone, only kinds. */
export function buildPhotoRecord({ id, pending, use, ori = {}, cam = null, dev = null, size, at = new Date(), mode = "shutter" }) {
  const f = use?.fix, pos = f && use.src !== "none";
  const ph = { id, ...(pending ? { pending: true } : {}),
    lng: pos ? f.lng : null, lat: pos ? f.lat : null, acc: pos ? Math.round(f.acc) : null, posSrc: pos ? use.src : "none" };
  if (pos) ph.gps = { alt: r1(f.alt), altAcc: r1(f.altAcc), speed: r1(f.speed), ts: new Date(f.ts).toISOString(), age: r1(use.age) };
  const h = ori.heading;
  ph.heading = h == null ? null : Math.round(h) % 360; ph.dirSrc = h == null ? "none" : "compass";
  ph.compass = { src: h == null ? null : ori.src || null, acc: ori.acc != null && ori.acc >= 0 ? Math.round(ori.acc) : null, abs: h == null ? null : !!ori.abs, screen: ori.screen ?? 0 };
  ph.tilt = ori.tilt ? { ...ori.tilt } : null;
  if (cam) ph.cam = cam;
  if (dev) ph.dev = dev;
  Object.assign(ph, { at: at.toISOString(), w: size.w, h: size.h, origin: "walk", mode });
  return ph;
}

/* ---- Film while you walk: choosing frames from the live camera ---- */
/* Luma (0-255) of an RGBA pixel buffer into `out` (w*h bytes). */
export function lumaInto(rgba, out) { for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8; return out; }
/* Sharpness: the variance of the Laplacian (4-neighbour) of a grey picture. Blurred or shaken frames score low. */
export function laplacianVar(g, w, h) {
  let n = 0, s = 0, s2 = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
    s += v; s2 += v * v; n++;
  }
  return n ? s2 / n - (s / n) ** 2 : 0;
}
/* How fast the phone is turning, in °/s, from [{t (ms), h (heading or null), p (pitch or null)}] over the last `win` ms. */
export function turnRate(hist, t, win = 500) {
  const w = hist.filter(o => t - o.t <= win); if (w.length < 2) return 0;
  const a = w[0], b = w.at(-1), dt = (b.t - a.t) / 1000; if (dt <= 0) return 0;
  const dh = a.h != null && b.h != null ? Math.abs(((b.h - a.h + 540) % 360) - 180) : 0, dp = a.p != null && b.p != null ? Math.abs(b.p - a.p) : 0;
  return Math.hypot(dh, dp) / dt;
}
/* Frame selection. consider({t (ms), rate (°/s), xy ([x, y] metres or null), heading, sharp () → number}) → {keep, why}.
   A frame is kept when the phone is turning slowly, the picture is sharp (above `minSharp` and above ~60 % of the recent median:
   the threshold is learnt from the walk), and it is new: first frame; or >= moveM m from the last kept; or turned >= turnDeg; or
   >= maxGapMs since the last. Never closer in time than minGapMs, and at most `cap` per session. */
export function createFramePicker({ cap = 40, minSharp = 25, maxRate = 30, moveM = 2, turnDeg = 25, maxGapMs = 6000, minGapMs = 1500 } = {}) {
  let n = 0, lastT = null, lastXY = null, lastH = null; const recent = [];
  const median = () => { const s = [...recent].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
  return {
    get count() { return n; }, cap,
    consider({ t, rate = 0, xy = null, heading = null, sharp }) {
      if (n >= cap) return { keep: false, why: "cap" };
      if (lastT != null && t - lastT < minGapMs) return { keep: false, why: "soon" };
      if (rate > maxRate) return { keep: false, why: "turning" };
      const fresh = lastT == null || t - lastT >= maxGapMs || (xy && lastXY && Math.hypot(xy[0] - lastXY[0], xy[1] - lastXY[1]) >= moveM)
        || (heading != null && lastH != null && Math.abs(((heading - lastH + 540) % 360) - 180) >= turnDeg);
      if (!fresh) return { keep: false, why: "same" };
      const sh = sharp(); recent.push(sh); if (recent.length > 30) recent.shift();
      if (sh < minSharp || sh < 0.6 * median()) return { keep: false, why: "blurry", sharp: sh };
      n++; lastT = t; lastXY = xy; lastH = heading;
      return { keep: true, why: "ok", sharp: sh, seq: n };
    },
  };
}

/* Compact sensor trace of a walk for later calibration (compass and GPS error against pins): a row every `every` ms, at most
   `max` rows; when full every other row is dropped and the spacing doubles, so a long walk still fits. */
export function createTrace({ every = 2000, max = 300 } = {}) {
  let step = every, rows = [], t0 = null, lastT = -Infinity;
  return {
    add(t, row) {
      if (t0 == null) t0 = t;
      const dt = t - t0; if (dt - lastT < step) return false;
      lastT = dt; rows.push([Math.round(dt / 100) / 10, ...row]);
      if (rows.length > max) { rows = rows.filter((_, i) => i % 2 === 0); step *= 2; }
      return true;
    },
    rows: () => rows, every: () => step,
  };
}
export const TRACE_COLS = ["t", "lng", "lat", "acc", "hdg", "pitch"];

/* "Sjekk utstyret": three rows (Kamera, Posisjon, Kompass/tilt), each ok/warn/bad with what to do.
   cam {state: "wait" | "ok" | "denied" | "none", w, h}, geo = tracker.status(), ori {seen, heading, acc, flag, denied, waitedMs}.
   The walk may start when none of the rows is red; otherwise the owner must choose "Fortsett uten". */
export function gearVerdict({ cam, geo, ori, platform = "other", anchor = null }) {
  const rows = [];
  rows.push(cam.state === "ok" ? { key: "cam", label: "Kamera", level: "ok", text: `Kameraet virker${cam.w ? ` (${cam.w}×${cam.h})` : ""}.` }
    : cam.state === "wait" ? { key: "cam", label: "Kamera", level: "warn", text: "Starter kameraet …", help: "Si ja om telefonen spør om å bruke kameraet." }
    : { key: "cam", label: "Kamera", level: "bad", text: cam.state === "denied" ? "Kameraet er blokkert for denne siden." : "Fant ikke noe kamera.",
      help: platform === "ios" ? "iPhone: Innstillinger › Safari › Kamera › Spør eller Tillat. Last siden på nytt." : "Android: trykk på ikonet ved adressefeltet › Innstillinger for nettstedet › Kamera › Tillat. Last siden på nytt." });
  rows.push({ key: "geo", label: "Posisjon", level: geo.level, text: geo.state === "ok" ? `Posisjon funnet, ±${Math.round(geo.acc)} m.` : geo.head, help: geo.state === "ok" ? null : geo.fix });
  const o = ori;
  rows.push(o.denied ? { key: "ori", label: "Kompass/tilt", level: "bad", text: "Tilgang til kompass og bevegelse ble nektet.", help: "iPhone: lukk siden, åpne den på nytt og trykk Tillat når den spør om bevegelse og retning (Innstillinger › Safari › Avansert › Nettsteddata kan nullstilles)." }
    : !o.seen ? (o.waitedMs < 3000 ? { key: "ori", label: "Kompass/tilt", level: "warn", text: "Venter på kompasset …", help: "Hold mobilen oppreist og beveg den litt." }
      : { key: "ori", label: "Kompass/tilt", level: "bad", text: "Ingen kompass eller tiltsensor svarer.", help: "Bildene får ikke retning. iPhone: tillat bevegelse og retning når siden spør. Android: bruk Chrome og sjekk at sensorer er tillatt for nettstedet." })
    : o.heading == null ? { key: "ori", label: "Kompass/tilt", level: "warn", text: "Tilt virker, men kompasset mangler.", help: "Bildene får ikke retning før kompasset kommer. Beveg mobilen i en åttetall." }
    : o.flag ? { key: "ori", label: "Kompass/tilt", level: "warn", text: "Tilt-avlesningen virker rar.", help: "Hold mobilen oppreist foran deg, ikke flat eller på tvers." }
    : o.acc != null && o.acc > COMPASS_POOR_DEG ? { key: "ori", label: "Kompass/tilt", level: "warn", text: `Kompasset er upresist (±${Math.round(o.acc)}°).`, help: "Beveg mobilen i en åttetall og hold den unna metall og magneter." }
    : { key: "ori", label: "Kompass/tilt", level: "ok", text: `Kompass og tilt virker (${Math.round(o.heading)}°).` });
  /* the start anchor: never blocks the run (a run without one works as before), but says what it will be */
  if (anchor) rows.push(anchor.state === "ok" ? { key: "anchor", label: "Kalibrering: ankerbilde", level: "ok", text: `Startpunkt klart: ${anchor.why || "taklinjer synlige"}.`, help: "Du blir vist dit. Legg huset i omrisset, så tas startbildet, og det retter kompass og GPS for hele runden." }
    : anchor.state === "wait" ? { key: "anchor", label: "Kalibrering: ankerbilde", level: "warn", text: "Leter etter et startpunkt i høydedataene …", help: "Starter du før det er klart, blir runden uten ankerbilde." }
    : { key: "anchor", label: "Kalibrering: ankerbilde", level: "warn", text: anchor.state === "none" ? "Fant ikke noe godt startpunkt: runden blir uten ankerbilde." : `Startpunktet kunne ikke planlegges${anchor.msg ? ` (${anchor.msg})` : ""}: runden blir uten ankerbilde.`, help: "Plasser og pek det første bildet i kartet etterpå (Bilder fra hagen), så rettes resten av runden etter det." });
  return { rows, canStart: rows.every(r => r.level !== "bad") };
}

/* ---------- Coverage: what the walk has seen ("fog of war") ----------
   A grid of 1 m cells over the lot plus a 10 m margin, in EPSG:25833 (typed arrays, nothing allocated per frame). Each kept
   frame paints the wedge the camera saw, 2-12 m ahead of where you stood. A cell stores how many views reached it (n), a mask
   of the 8 compass sectors (45° bins of the viewing direction) it was seen along (sec), and the worst position error among
   those views in metres (worst, 0 = never seen). States: 0 fog, 1 thin (one view, or all from nearly one side), 2 good
   (two or more views from sectors at least 90° apart), 3 uncertain (some view had GPS error 15-25 m). Frames with a GPS error
   above 25 m, or a position older than 30 s, paint nothing. */
export const COV_GOOD_M = 15, COV_MAX_M = 25;
export const sectorOf = h => Math.floor((((h % 360) + 360) % 360 + 22.5) / 45) % 8;   // 0 = north (337.5-22.5°), 2 = east ...
const SPREAD = new Uint8Array(256), BITS = new Uint8Array(256);
for (let m = 0; m < 256; m++) {
  const on = []; for (let k = 0; k < 8; k++) if (m & (1 << k)) on.push(k);
  BITS[m] = on.length;
  SPREAD[m] = on.some(a => on.some(b => { const d = Math.abs(a - b); return Math.min(d, 8 - d) >= 2; })) ? 1 : 0;
}
export const bitCount = m => BITS[m & 255];
export const cellState = (n, sec, worst) => (n === 0 ? 0 : worst > COV_GOOD_M ? 3 : n >= 2 && SPREAD[sec] ? 2 : 1);
/* Horizontal field of view of a frame of w x h pixels, when `fov` is the long side's (photoFov): a portrait frame sees less sideways. */
export const frameHfov = (w, h, fov = DEFAULT_FOV) => (w && h && h > w ? +((2 * Math.atan(Math.tan((fov * RAD) / 2) * (w / h))) / RAD).toFixed(1) : fov);

/* The things a walk aims to see from several sides: trees and bushes of some size, beds and hedges, buildings.
   `need` = how many different sides finish a ring (3 for trees and buildings, 2 for the rest). */
export function coverageThings(d, utm = toUtm, max = 150) {
  const out = [], mid = ring => { const r = ring.slice(0, -1).map(utm), n = r.length || 1, x = r.reduce((s, p) => s + p[0], 0) / n, y = r.reduce((s, p) => s + p[1], 0) / n; return { x, y, r: Math.sqrt(Math.max(1, Math.abs(r.reduce((s, p, k) => { const q = r[(k + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2)) / Math.PI) }; };
  for (const it of d.items || []) {
    if (it.st === "planned" || !((it.crown || 0) >= 1 || (it.h || 0) >= 2)) continue;
    const [x, y] = utm([it.lng, it.lat]); out.push({ id: it.id, type: "item", x, y, r: Math.max(0.5, it.crown || 0.5), need: it.pid === "tre" || (it.h || 0) >= 4 ? 3 : 2, mask: 0 });
  }
  for (const a of d.areas || []) { if (BACKGROUND.has(a.kind) || a.st === "planned" || !a.ring?.length) continue; out.push({ id: a.id, type: "area", ...mid(a.ring), need: 2, mask: 0 }); }
  for (const b of d.buildings || []) if (b.ring?.length) out.push({ id: b.id, type: "building", ...mid(b.ring), need: 3, mask: 0 });
  return out.slice(0, max);
}

export function createCoverage({ lot, utm = toUtm, margin = 10, things = [] }) {
  const ring = lot.map(utm), xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const x0 = Math.floor(Math.min(...xs) - margin), y0 = Math.floor(Math.min(...ys) - margin);
  const w = Math.ceil(Math.max(...xs) + margin) - x0, h = Math.ceil(Math.max(...ys) + margin) - y0;
  const n = new Uint8Array(w * h), sec = new Uint8Array(w * h), worst = new Uint8Array(w * h), inLot = new Uint8Array(w * h);
  let lotCells = 0, seen = 0, painted = 0, dirty = true;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (inPoly([x0 + i + 0.5, y0 + j + 0.5], ring)) { inLot[j * w + i] = 1; lotCells++; }
  const ids = new Map(things.map(t => [t.id, t]));
  const touch = (i, s, c, wo) => { if (n[i] === 0 && inLot[i]) seen++; if (n[i] < 255) n[i]++; sec[i] |= s; if (wo > worst[i]) worst[i] = wo; };
  const api = {
    x0, y0, w, h, n, sec, worst, inLot, things, lotCells,
    get seen() { return seen; }, get painted() { return painted; },
    get dirty() { return dirty; }, set dirty(v) { dirty = v; },
    pct: () => (lotCells ? Math.round((100 * seen) / lotCells) : 0),
    pctText: () => { const p = lotCells ? (100 * seen) / lotCells : 0; return p < 10 ? p.toFixed(1).replace(".", ",") : String(Math.round(p)); },
    state: i => cellState(n[i], sec[i], worst[i]),
    /* paint one frame: {x, y} metres, heading° (looking direction), hfov°, acc m (GPS error). Returns null when it does not count,
       else {cells, done: [ids of things whose ring this frame completed]}. */
    paint({ x, y, heading, hfov = DEFAULT_FOV, acc, dmin = 2, dmax = 12 }) {
      if (heading == null || !(acc <= COV_MAX_M) || !Number.isFinite(x)) return null;
      const hr = heading * RAD, sh = Math.sin(hr), ch = Math.cos(hr), tn = Math.tan((Math.min(150, hfov) / 2) * RAD), s = 1 << sectorOf(heading), wo = Math.min(255, Math.max(1, Math.ceil(acc)));
      const ia = Math.max(0, Math.floor(x - dmax - x0)), ib = Math.min(w - 1, Math.floor(x + dmax - x0)), ja = Math.max(0, Math.floor(y - dmax - y0)), jb = Math.min(h - 1, Math.floor(y + dmax - y0));
      let cells = 0;
      for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
        const dx = x0 + i + 0.5 - x, dy = y0 + j + 0.5 - y, d2 = dx * dx + dy * dy;
        if (d2 < dmin * dmin || d2 > dmax * dmax) continue;
        const fw = dx * sh + dy * ch; if (fw <= 0 || Math.abs(dx * ch - dy * sh) > fw * tn) continue;
        touch(j * w + i, s, 0, wo); cells++;
      }
      const done = [];
      for (const t of things) {
        const dx = t.x - x, dy = t.y - y, d = Math.hypot(dx, dy), fw = dx * sh + dy * ch;
        if (d - t.r > dmax || d + t.r < dmin || (fw <= 0 && d > t.r) || Math.abs(dx * ch - dy * sh) > Math.max(0, fw) * tn + t.r) continue;
        const before = BITS[t.mask] >= t.need; t.mask |= 1 << sectorOf((Math.atan2(x - t.x, y - t.y) / RAD + 360) % 360);   // the side of the thing you stood on
        if (!before && BITS[t.mask] >= t.need) done.push(t.id);
      }
      if (cells || done.length) { painted++; dirty = true; }
      return { cells, done };
    },
    ringsDone: () => things.filter(t => BITS[t.mask] >= t.need).length,
    /* the unfinished things nearest to [x, y]: [{thing, dist, bearing}] */
    nearest(x, y, k = 3) {
      return things.filter(t => BITS[t.mask] < t.need).map(t => ({ thing: t, dist: Math.max(0, Math.hypot(t.x - x, t.y - y) - t.r), bearing: (Math.atan2(t.x - x, t.y - y) / RAD + 360) % 360 })).sort((a, b) => a.dist - b.dist).slice(0, k);
    },
    encode: () => encodeCells(cellsOfGrid(api), Object.fromEntries(things.filter(t => t.mask).map(t => [t.id, t.mask]))),
    /* union in a stored coverage (OR the sectors, max of counts and errors) */
    merge(enc) {
      if (!enc) return;
      for (const [gx, gy, c] of cellsOf(enc)) {
        const i = (gy - y0) * w + (gx - x0); if (gx < x0 || gy < y0 || gx >= x0 + w || gy >= y0 + h) continue;
        if (n[i] === 0 && inLot[i]) seen++; n[i] = Math.max(n[i], c[1]); sec[i] |= c[0]; worst[i] = Math.max(worst[i], c[2]);
      }
      for (const [id, m] of Object.entries(enc.t || {})) { const t = ids.get(id); if (t) t.mask |= m; }
      dirty = true;
    },
  };
  return api;
}
function* cellsOfGrid(g) { for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) { const k = j * g.w + i; if (g.n[k]) yield [g.x0 + i, g.y0 + j, [g.sec[k], g.n[k], g.worst[k]]]; } }
/* Compact form: runs along rows of touched cells with equal values: {o: [x, y] origin, r: [dy, dx, len, sec, n, worst, ...], t: {thingId: sector mask}}. */
export function encodeCells(cells, t = {}) {
  const list = [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (!list.length) return { o: [0, 0], r: [], t };
  const ox = Math.min(...list.map(c => c[0])), oy = list[0][1], r = [];
  let run = null;
  for (const [x, y, c] of list) {
    if (run && run.y === y && run.x + run.len === x && run.c[0] === c[0] && run.c[1] === c[1] && run.c[2] === c[2]) { run.len++; continue; }
    if (run) r.push(run.y - oy, run.x - ox, run.len, ...run.c);
    run = { x, y, len: 1, c };
  }
  r.push(run.y - oy, run.x - ox, run.len, ...run.c);
  return { o: [ox, oy], r, t };
}
export function* cellsOf(enc) {
  const [ox, oy] = enc?.o || [0, 0], r = enc?.r || [];
  for (let k = 0; k + 5 < r.length + 0; k += 6) for (let q = 0; q < r[k + 2]; q++) yield [ox + r[k + 1] + q, oy + r[k], [r[k + 3], r[k + 4], r[k + 5]]];
}
/* Two stored coverages as one: sectors OR-ed, counts and errors the larger. Order does not matter. */
export function mergeCoverage(a, b) {
  if (!a) return b || null; if (!b) return a;
  const m = new Map(), put = ([x, y, c]) => { const k = y * 4194304 + x, p = m.get(k); m.set(k, p ? [x, y, [p[2][0] | c[0], Math.max(p[2][1], c[1]), Math.max(p[2][2], c[2])]] : [x, y, [...c]]); };
  for (const e of [a, b]) for (const c of cellsOf(e)) put(c);
  const t = { ...(a.t || {}) }; for (const [id, v] of Object.entries(b.t || {})) t[id] = (t[id] || 0) | v;
  return encodeCells(m.values(), t);
}
/* Map polygons for the stored coverage (one rectangle per run), for the desktop layer "Bildedekning". state: 1 thin, 2 good, 3 uncertain. */
export function coverageFeatures(enc, toLL = toLngLat) {
  const out = [], [ox, oy] = enc?.o || [0, 0], r = enc?.r || [];
  for (let k = 0; k + 5 < r.length; k += 6) {
    const x = ox + r[k + 1], y = oy + r[k], len = r[k + 2], st = cellState(r[k + 4], r[k + 3], r[k + 5]);
    if (!st) continue;
    out.push({ type: "Feature", properties: { state: st }, geometry: { type: "Polygon", coordinates: [[toLL([x, y]), toLL([x + len, y]), toLL([x + len, y + 1]), toLL([x, y + 1]), toLL([x, y])]] } });
  }
  return { type: "FeatureCollection", features: out };
}
export const unionWalks = walks => (walks || []).reduce((a, w) => mergeCoverage(a, w.coverage), null);

export function createWalk({ doc, uploadImage, onShot, onUploaded, onLost, onWalk, onRun, planAnchors = null, projectId = () => null, store = idbStore(), labelOf, toast }) {
  const localUrls = new Map(), blobUrl = async dataUrl => URL.createObjectURL(await (await fetch(dataUrl)).blob());
  const queue = createUploadQueue({
    store, upload: uploadImage,
    canUpload: e => e.project === projectId(),
    onUploaded: (e, id) => {
      const u = localUrls.get(e.id); if (u) localUrls.set(id, u);   // the picture stays on screen without a new download
      if (swapPhotoId(doc(), e.id, id)) onUploaded?.(id);
    },
    onRefused: (e, err) => { if (markPhotoLost(doc(), e.id)) onLost?.(e.id); toast?.("Et bilde kunne ikke lastes opp: " + err.message); },
  });
  /* back on line, back in view, next shot, and every 20 s: send what waits */
  async function drain(force = false) {
    try { const n = await queue.drain({ force: force === true }); if (n) toast?.(`${n} bilde${n === 1 ? "" : "r"} lastet opp fra køen`); } catch (e) { console.warn(e); }
    const w = queue.count(projectId());
    if (w && Date.now() - cappedToast > 300e3 && root?.hidden !== false) { cappedToast = Date.now(); toast?.(queue.blocked() ? `${waitText(w)}. Bildene er trygt lagret på telefonen og sendes når det blir plass.` : `${waitText(w)}. Åpne appen med dekning for å laste dem opp.`, () => drain(true), "Prøv nå"); }
    if (root && !root.hidden) waiting();
  }
  let cappedToast = 0;
  const waitText = n => queue.holdSeconds() > 0 ? `${n} bilde${n === 1 ? "" : "r"} venter: serveren ber oss vente (${Math.max(1, Math.round(queue.holdSeconds() / 60))} min)` : queue.blocked() ? `${n} bilde${n === 1 ? "" : "r"} venter: lagringsgrensen er nådd` : `${n} bilde${n === 1 ? "" : "r"} venter på nett`;
  const waiting = () => {
    const n = queue.count(projectId());
    if (root) { root.querySelector(".wcount").textContent = `${count} bilde${count === 1 ? "" : "r"}${n ? ` · ${waitText(n)}` : ""}`; root.classList.toggle("offq", n > 0); const rb = root.querySelector(".wretry"); rb.hidden = !n; rb.onclick = () => drain(true); }
    return n;
  };
  addEventListener("online", drain);
  document.addEventListener("visibilitychange", () => drain());   // visible: catch up; hidden: use the moments the platform still gives us
  addEventListener("pagehide", () => drain());
  setInterval(drain, 20e3); setTimeout(drain, 3e3);   // the project is usually open a moment after this module loads
  queue.load().then(async () => {
    for (const e of await store.all().catch(() => [])) if (!localUrls.has(e.id)) localUrls.set(e.id, await blobUrl(e.image).catch(() => null));
    drain(); onUploaded?.(null);
  }).catch(() => {});
  let auto = true, hold = 0, lastShot = 0, recent = [];
  let root, video, mini, ar, stream, fix = null, heading = null, tilt = null, busy = false, count = 0;
  /* sensors and session */
  let geo = null, oriAt = 0, oriOpen = 0, hdgSrc = null, hdgAbs = false, hdgAcc = null, oriDenied = false, camState = { state: "wait" };
  let started = false, gearOk = true, film = null, trace = null, session = null, wake = null, askDone = null, lastGear = 0, hist = [];
  let cov = null, fogOn = false, covCv = null, covImg = null, lastCov = 0, goalsSig = "";
  let gearAt = 0, shotCv = null, smallCv = null, smallPx = null;
  /* the run's start spot and anchors (anchor.js runFlow): the plan's state for the gear check, the live line-up */
  let flow = flowInit(), anc = { state: "wait", why: null, msg: null }, line = null, ancHist = [], edgeAt = 0, edgeCv = null, edgePx = null, note = "", noteUntil = 0, lastAnc = 0;
  const tune = () => globalThis.__hkWalkTune || {};   // tests set it (sharpness floor, spacing); nothing in the page does
  const dev = deviceInfo(navigator.userAgent, navigator.platform, navigator.maxTouchPoints > 0);
  const platform = platformOf(navigator.userAgent, navigator.platform);

  function build() {
    root = document.createElement("div");
    root.className = "walk"; root.hidden = true;
    root.innerHTML = `<video playsinline muted autoplay></video><canvas class="ar" aria-hidden="true"></canvas>
      <div class="wtop"><span class="wgps" data-level="warn" role="status">GPS …</span><span class="wstat" aria-live="polite"></span><button class="wfilm" aria-pressed="false" title="Velger skarpe bilder fra kameraet mens du går (ingen video lagres)">Film mens du går</button><button class="wauto" aria-pressed="true" title="Tar bildet selv når du står og peker riktig">Auto</button><button class="wclose">Ferdig</button></div>
      <div class="wmsg" hidden><span class="wmsgt"></span> <button class="wgeoretry">Prøv GPS igjen</button></div>
      <canvas class="mini" width="320" height="320" aria-label="Minikart: der du står og hvor kameraet peker"></canvas>
      <div class="wbot"><span class="wleft"><span class="wcount"></span><button class="wretry" hidden>Prøv igjen</button><button class="wspot" hidden>Kan ikke stå her</button></span><button class="shutter" aria-label="Ta bilde"></button><span class="whint">Pek på et tre, en hekk eller et bed</span></div>
      <div class="wgoals" hidden aria-live="polite"><b class="wpct"></b> <span class="wrings"></span><ol class="wnear"></ol><small class="wleg">Mørk = ikke sett · lys = sett én gang · grønn = godt dekket · stripet oransje = usikker GPS</small></div>
      <div class="wask" hidden role="alertdialog" aria-label="Ingen posisjon"><div><b>Ingen posisjon: ta bildet likevel?</b><p>Bildet blir lagret, men havner under «mangler plassering» til du plasserer det i kartet.</p><div class="wacts"><button class="wagain">Prøv igjen</button><button class="wanyway">Ta bildet likevel</button></div></div></div>
      <div class="wcheck" role="dialog" aria-label="Sjekk utstyret"><div><h2>Sjekk utstyret</h2><ul class="wrows"></ul><div class="wacts"><button class="wcheckretry">Prøv igjen</button><button class="wskip">Fortsett uten</button><button class="wgo">Start runden</button></div></div></div>`;
    document.body.append(root);
    video = root.querySelector("video"); mini = root.querySelector(".mini"); ar = root.querySelector(".ar");
    root.querySelector(".wclose").onclick = close;
    root.querySelector(".shutter").onclick = () => shoot();
    root.querySelector(".wauto").onclick = e => { auto = !auto; e.currentTarget.setAttribute("aria-pressed", String(auto)); hold = 0; };
    root.querySelector(".wfilm").onclick = () => (film ? stopFilm() : startFilm());
    root.querySelector(".wgeoretry").onclick = () => geo?.retry();
    root.querySelector(".wcheckretry").onclick = retryAll;
    root.querySelector(".wgo").onclick = () => begin(true);
    root.querySelector(".wskip").onclick = () => begin(false);
    root.querySelector(".wspot").onclick = skipSpot;
  }

  /* Heading and tilt from the phone. Heading of the rear camera: iOS gives webkitCompassHeading (of the top edge, so the
     screen angle is added); elsewhere it is worked out from an absolute alpha/beta/gamma, which already is the direction of
     the camera (the device's -z axis) in any screen orientation, so nothing is added. The tilt record carries pitch,
     computed from beta and gamma (see tiltToPitch). */
  const onOri = e => {
    if (e.beta == null && e.alpha == null && e.webkitCompassHeading == null) return;   // desktop browsers fire one empty event
    oriAt = performance.now(); if (!oriOpen) oriOpen = oriAt;
    const h = cameraHeading(e), angle = screen.orientation?.angle || 0;
    if (h != null) {
      const webkit = typeof e.webkitCompassHeading === "number" && e.webkitCompassHeading >= 0;
      heading = webkit ? (h + angle + 360) % 360 : h; hdgSrc = webkit ? "webkit" : "absolute"; hdgAbs = true;
      hdgAcc = typeof e.webkitCompassAccuracy === "number" && e.webkitCompassAccuracy >= 0 ? e.webkitCompassAccuracy : null;
    }
    if (e.beta != null) tilt = tiltRecord(e);
  };
  const oriNow = () => ({ heading, src: hdgSrc, acc: hdgAcc, abs: hdgAbs, screen: screen.orientation?.angle || 0, tilt: tilt && { ...tilt } });
  const camNow = () => {
    const t = stream?.getVideoTracks?.()[0]; if (!t) return null;
    const s = t.getSettings?.() || {};
    return { w: s.width ?? null, h: s.height ?? null, facing: s.facingMode ?? null, zoom: s.zoom ?? null, fps: s.frameRate != null ? Math.round(s.frameRate) : null };
  };

  async function startCamera() {
    camState = { state: "wait" };
    try {
      stream?.getTracks().forEach(t => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
      video.srcObject = stream; const c = camNow(); camState = { state: "ok", w: c?.w, h: c?.h };
    } catch (e) { console.warn(e); camState = { state: e.name === "NotFoundError" ? "none" : "denied" }; }
  }
  async function askOrientation() {
    try {
      const R = globalThis.DeviceOrientationEvent?.requestPermission;   // iOS: only from a tap
      if (typeof R === "function") oriDenied = (await globalThis.DeviceOrientationEvent.requestPermission()) !== "granted"; else oriDenied = false;
    } catch { oriDenied = true; }
  }

  /* The tap that opens the walk: the position is asked for first (that raises its permission prompt), the motion
     permission in the same tap, then the camera. Nothing is captured until the equipment check is passed. */
  async function open() {
    if (!root) build();
    count = 0; started = false; gearOk = true; film = null; trace = null; hist = []; oriOpen = 0; oriAt = 0; heading = null; tilt = null; hdgSrc = null; hdgAcc = null; oriDenied = false;
    flow = flowInit(); line = null; ancHist = []; note = ""; noteUntil = 0; syncPhase();
    anc = { state: "wait", why: null, msg: null };
    const fromDoc = () => { const p = doc().anchorPlan; anc = Array.isArray(p) ? { state: p.length ? "ok" : "none", why: p[0]?.why || null, msg: null } : { state: "fail", why: null, msg: "ikke planlagt" }; };
    if (planAnchors) Promise.resolve().then(planAnchors).then(r => { anc = { state: r.plan.length ? "ok" : "none", why: r.plan[0]?.why || null, msg: r.msg }; }, e => { console.warn("startpunkt", e); anc = { state: "fail", why: null, msg: navigator.onLine === false ? "uten nett" : "høydedata svarte ikke" }; if (Array.isArray(doc().anchorPlan) && doc().anchorPlan.length) fromDoc(); });
    else fromDoc();
    root.querySelector(".wfilm").setAttribute("aria-pressed", "false"); root.querySelector(".wfilm").textContent = "Film mens du går";
    root.hidden = false; document.body.classList.add("walking"); root.querySelector(".wcheck").hidden = false; root.querySelector(".wask").hidden = true;
    geo?.stop(); geo = createGeoTracker({ geo: navigator.geolocation, now: () => Date.now() + (tune().skewMs || 0) }); geo.start({ isSecure: globalThis.isSecureContext !== false });
    const oriP = askOrientation();
    addEventListener("deviceorientationabsolute", onOri); addEventListener("deviceorientation", onOri);
    try { wake = await navigator.wakeLock?.request("screen"); } catch { wake = null; }
    gearAt = performance.now();
    session = { id: "w-" + Date.now().toString(36), start: new Date().toISOString() };
    loop();
    await Promise.all([startCamera(), oriP]);
  }
  function retryAll() { geo?.retry(); askOrientation(); if (camState.state !== "ok") startCamera(); }
  function begin(clean) {
    started = true; gearOk = clean;
    flow = runFlow(flow, { type: "go", plan: anc.state === "ok" && camState.state === "ok" ? doc().anchorPlan : [], id: "r-" + Date.now().toString(36), at: new Date().toISOString(), why: anc.state === "wait" ? "not-ready" : "no-plan" });
    if (flow.phase === "run") say(flowNote(flow));
    syncPhase();
    if (!clean) { auto = false; root.querySelector(".wauto").setAttribute("aria-pressed", "false"); }
    root.querySelector(".wcheck").hidden = true;
    { const d = doc(); cov = createCoverage({ lot: d.lot.ring, things: coverageThings(d) }); for (const w of d.walks || []) cov.merge(w.coverage); }
    fogOn = false; root.classList.remove("fog"); root.querySelector(".wgoals").hidden = true; goalsSig = "";
    trace = createTrace(); session.began = new Date().toISOString(); hold = 0;
  }
  /* Ferdig: a run anchored at its start goes to its end anchor first ("Avslutt ved startpunktet"); Ferdig there ends it as it is. */
  function close() {
    if (flow.phase === "run" || flow.phase === "end" || flow.phase === "start") {
      flow = runFlow(flow, { type: "finish" });
      if (flow.phase === "end") { stopFilm(true); line = null; syncPhase(); toast?.("Avslutt ved startpunktet: gå tilbake dit og legg huset i omrisset, så lukkes runden. Ferdig igjen avslutter uten."); return; }
      if (flow.note === "no-end") toast?.(flowNote(flow));
    }
    shut();
  }
  function shut() {
    if (keepRun(flow)) onRun?.({ ...flow.run });
    flow = { ...flow, phase: "done", run: null }; syncPhase();
    stopFilm(true);
    const rows = trace?.rows() || [];
    const covEnc = cov?.painted ? cov.encode() : null;
    if (started && session && (rows.length >= 3 || covEnc)) onWalk?.({ id: session.id, start: session.began || session.start, end: new Date().toISOString(), every: trace.every() / 1000, cols: TRACE_COLS, samples: rows, photos: count, dev, ...(covEnc ? { coverage: covEnc, pct: cov.pct(), rings: [cov.ringsDone(), cov.things.length] } : {}) });
    started = false; trace = null; cov = null; fogOn = false; root.classList.remove("fog"); root.querySelector(".wgoals").hidden = true;
    root.hidden = true; document.body.classList.remove("walking");
    stream?.getTracks().forEach(t => t.stop()); stream = null;
    geo?.stop(); try { wake?.release?.(); } catch { /* released */ } wake = null;
    removeEventListener("deviceorientationabsolute", onOri); removeEventListener("deviceorientation", onOri);
    const note = closeNote(count, queue.count(projectId())); if (note) toast?.(note);
    drain();
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const status = t => { root.querySelector(".wstat").textContent = t; };

  const pitchNow = () => tilt?.pitch ?? null;
  function loop() {
    if (root.hidden) return;
    const t = performance.now();
    if (t - oriAt > 3000) { heading = null; tilt = null; }   // the sensor went quiet: do not keep an old direction
    geo.tick();
    const u = geo.use(); fix = u.fix;
    const st = geo.status(), chip = root.querySelector(".wgps");
    chip.dataset.level = st.level;
    chip.textContent = st.state === "ok" ? `GPS ±${Math.round(st.acc)} m · ${Math.round(st.age)} s` : st.state === "weak" ? `GPS svak ±${Math.round(st.acc)} m` : st.state === "stale" ? `GPS ${Math.round(st.age)} s gammel` : st.state === "waiting" ? "Venter på GPS …" : "Ingen posisjon";
    const msg = root.querySelector(".wmsg"); msg.hidden = st.level === "ok" || !!(root.querySelector(".wcheck") && !root.querySelector(".wcheck").hidden);
    if (!msg.hidden) { root.querySelector(".wmsgt").textContent = `${st.head} ${st.fix}`; }
    const comp = heading == null ? "ingen kompass" : `${Math.round(heading)}°`;
    const tgt = fix && rayTarget(doc(), [fix.lng, fix.lat], heading);
    const wq = queue.count(projectId());
    status(note && Date.now() < noteUntil ? note : `${comp}${tilt?.flag ? " · tilt virker rar" : ""}${tgt ? ` · peker på ${labelOf(tgt)}, ${Math.round(tgt.dist)} m` : ""}${wq ? ` · ${waitText(wq)}` : ""}`);
    hist.push({ t, h: heading, p: pitchNow() }); while (hist.length && t - hist[0].t > 800) hist.shift();
    if (!root.querySelector(".wcheck").hidden && t - lastGear > 400) { lastGear = t; renderGear(t, st); }
    if (started && trace && fix) trace.add(t, [+fix.lng.toFixed(6), +fix.lat.toFixed(6), Math.round(fix.acc), heading == null ? null : Math.round(heading), pitchNow() == null ? null : Math.round(pitchNow())]);
    const lining = flow.phase === "start" || flow.phase === "end";
    if (lining) lineUp(t); else questHint();
    drawMini(tgt);
    if (lining) drawGhost(); else drawAR(fogOn ? nearThing() : nextSpot());
    if (!lining) autoShot();
    if (film) filmTick(t);
    if (cov && fogOn && t - lastCov > 500) { lastCov = t; coverageTick(); }
    requestAnimationFrame(loop);
  }

  /* the equipment check: three rows, each green, amber or red, with what to do */
  function renderGear(t, st) {
    const v = gearVerdict({ cam: camState, geo: st, platform, anchor: anc, ori: { seen: t - oriAt < 3000 && oriOpen > 0, heading, acc: hdgAcc, flag: tilt?.flag, denied: oriDenied, waitedMs: t - gearAt } });
    root.querySelector(".wgo").textContent = anc.state === "ok" ? "Gå til startpunktet" : "Start runden";
    root.querySelector(".wrows").innerHTML = v.rows.map(r => `<li data-level="${r.level}" data-row="${r.key}"><i></i><div><b>${r.label}</b><span>${esc(r.text)}</span>${r.help ? `<small>${esc(r.help)}</small>` : ""}</div></li>`).join("");
    root.querySelector(".wgo").disabled = !v.canStart; root.querySelector(".wgo").hidden = !v.canStart;
    root.querySelector(".wskip").hidden = v.canStart; root.querySelector(".wcheckretry").hidden = v.rows.every(r => r.level === "ok");
  }

  /* The nearest open quest spot: walk there, then turn the way it asks. */
  const DIRS = ["nord", "nordøst", "øst", "sørøst", "sør", "sørvest", "vest", "nordvest"];
  const dirName = b => DIRS[Math.round(b / 45) % 8];
  function nextSpot() {
    const qs = questNow(doc()); if (!qs.length) return null;
    if (!fix) return qs[0];
    const me = toUtm([fix.lng, fix.lat]);
    return qs.map(q => ({ q, d: Math.hypot(...toUtm([q.lng, q.lat]).map((v, k) => v - me[k])) })).sort((a, b) => a.d - b.d)[0].q;
  }
  function questHint() {
    const all = doc().quest?.items || [], q = nextSpot(), el = root.querySelector(".whint");
    if (fogOn && cov) { const n = fix && cov.nearest(...toUtm([fix.lng, fix.lat]), 1)[0]; el.textContent = !fix ? "Venter på GPS …" : n ? goalText(n) : "Alle ringene er fullført. Takk!"; return; }
    if (!all.length) { el.textContent = "Pek på et tre, en hekk eller et bed"; return; }
    if (!q) { el.textContent = `Alle ${all.length} bildene på fototuren er tatt. Takk!`; return; }
    const left = questNow(doc()).length, head = `${q.text}${left > 1 ? ` (nærmeste av ${left})` : ""}`;
    if (!fix) { el.textContent = head; return; }
    const me = toUtm([fix.lng, fix.lat]), at = toUtm([q.lng, q.lat]), dist = Math.hypot(at[0] - me[0], at[1] - me[1]);
    if (dist > Math.max(5, fix.acc)) { el.textContent = `${head} · gå ${Math.round(dist)} m mot ${dirName(bearing(me, at))}`; return; }
    const turn = heading == null ? null : ((q.heading - heading + 540) % 360) - 180;
    el.textContent = `${head} · du er på plass, ` + (turn == null ? `se mot ${dirName(q.heading)}` : Math.abs(turn) <= 20 ? "ta bildet nå" : `snu deg ${Math.round(Math.abs(turn))}° mot ${turn > 0 ? "høyre" : "venstre"}`);
  }

  /* What the next quest spot is about, drawn as a simple wire model over the camera picture
     from GPS, compass and the phone's tilt: a tree as trunk and crown rings, an edge as the
     line on the ground, the house as a box. GPS and compass are off by metres and degrees,
     so it is a guide for aiming, not an exact overlay. */
  function drawAR(q) {
    const W = ar.clientWidth, H = ar.clientHeight;
    if (ar.width !== W * devicePixelRatio) { ar.width = W * devicePixelRatio; ar.height = H * devicePixelRatio; }
    const ctx = ar.getContext("2d"); ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!q || !fix || heading == null || !tilt) return;
    const d = doc(), me = toUtm([fix.lng, fix.lat]), eye = 1.5;
    const h = heading * RAD, p = (tilt.pitch ?? 0) * RAD;                            // pitch: 0 looking level, − looking down
    const f = [Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)], r = [Math.cos(h), -Math.sin(h), 0];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    /* the video fills the screen (cover); its vertical field of view is about 62° upright */
    const F = (Math.max(H, W * (video.videoHeight / (video.videoWidth || 1) || 1.33)) / 2) / Math.tan(31 * RAD);
    const P = ([x, y, z]) => { const v = [x - me[0], y - me[1], z - eye], zc = v[0] * f[0] + v[1] * f[1] + v[2] * f[2]; if (zc < 0.5) return null; return [W / 2 + (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / zc * F, H / 2 - (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / zc * F]; };
    const line = pts => { ctx.beginPath(); let pen = false; for (const pt of pts) { const s2 = P(pt); if (!s2) { pen = false; continue; } pen ? ctx.lineTo(...s2) : ctx.moveTo(...s2); pen = true; } ctx.stroke(); };
    const ring = (x, y, z, rad, n = 20) => Array.from({ length: n + 1 }, (_, k) => [x + Math.cos(k / n * 2 * Math.PI) * rad, y + Math.sin(k / n * 2 * Math.PI) * rad, z]);
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(232,89,12,.95)"; ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 3;
    const t = q.target;
    if (t.type === "item") {
      const it = d.items.find(i => i.id === t.id); if (!it) return;
      const [x, y] = toUtm([it.lng, it.lat]), ht = it.h || 3, cr = it.crown || 1, base = it.pid === "tre" ? ht * 0.35 : 0;
      line([[x, y, 0], [x, y, base]]);
      for (const k of [0, 0.5, 1]) line(ring(x, y, base + (ht - base) * (0.15 + 0.7 * k), cr * (k === 0.5 ? 1 : 0.75)));
      line([[x - cr, y, base + (ht - base) / 2], [x, y, ht], [x + cr, y, base + (ht - base) / 2]]);
    } else if (t.type === "area") {
      const a = d.areas.find(x => x.id === t.id); if (!a) return;
      ctx.setLineDash([10, 6]); line(a.ring.map(toUtm).map(([x, y]) => [x, y, 0])); ctx.setLineDash([]);
    } else if (t.type === "building") {
      const b = d.buildings.find(x => x.id === t.id); if (!b) return;
      const rg = b.ring.map(toUtm), top = b.h || 7;
      line(rg.map(([x, y]) => [x, y, 0])); line(rg.map(([x, y]) => [x, y, top]));
      for (const [x, y] of rg.slice(0, -1)) line([[x, y, 0], [x, y, top]]);
    }
    /* level hint: quest photos want the phone upright */
    if (Math.abs(tilt.pitch ?? 0) > 25) { ctx.shadowBlur = 0; ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(W / 2 - 120, H * 0.18, 240, 30); ctx.fillStyle = "#fff"; ctx.font = "600 14px system-ui"; ctx.textAlign = "center"; ctx.fillText(tilt.pitch < 0 ? "Løft mobilen litt" : "Senk mobilen litt", W / 2, H * 0.18 + 20); }
  }

  /* Auto: when you stand at an open spot, face its way within ~12° and hold the phone upright
     and still for 0.8 s, the photo is taken for you. A ring round the shutter shows it filling. */
  function autoShot() {
    const now = performance.now(), sh = root.querySelector(".shutter");
    if (heading != null && tilt) { recent.push({ t: now, h: heading, b: tilt.pitch ?? 0 }); while (recent.length && now - recent[0].t > 700) recent.shift(); }
    const q = auto && gearOk && started && flow.phase === "run" && !busy && geo.use().src === "gps" && heading != null && tilt && now - lastShot > 3000 ? readySpot() : null;
    const steady = recent.length > 5 && recent.every(o => angleOff(o.h, heading) < 4 && Math.abs(o.b - (tilt.pitch ?? 0)) < 4);
    if (q && steady && fix.acc <= 12) {
      hold = hold || now;
      const f = Math.min(1, (now - hold) / 800);
      sh.style.background = `conic-gradient(#e8590c ${f * 360}deg, rgba(255,255,255,.35) 0)`;
      root.querySelector(".whint").textContent = `Hold stille … ${q.text}`;
      if (f >= 1) { hold = 0; lastShot = now; sh.style.background = ""; shoot(); }
    } else if (hold) { hold = 0; sh.style.background = ""; }
  }
  /* An open spot of the current batch you are at and facing (a bit stricter than questDone). */
  function readySpot() {
    const me = toUtm([fix.lng, fix.lat]);
    return questNow(doc()).find(q => { const at = toUtm([q.lng, q.lat]); return Math.hypot(at[0] - me[0], at[1] - me[1]) <= Math.max(3, Math.min(8, fix.acc)) && angleOff(heading, q.heading) <= 12 && Math.abs(tilt.pitch ?? 0) <= 22; }) || null;
  }

  /* ---------- Coverage on the walk: the fog on the minimap, goal rings, the percentage ---------- */
  const goalText = n => `Gå mot ${labelOf({ type: n.thing.type, id: n.thing.id })}, ${Math.round(n.dist)} m${n.dist > 3 ? ` (${dirName(n.bearing)})` : ""}`;
  const nearThing = () => { if (!cov || !fix) return null; const n = cov.nearest(...toUtm([fix.lng, fix.lat]), 1)[0]; return n && { target: { type: n.thing.type, id: n.thing.id } }; };
  function paintPhoto(ph) {
    const p = ph.pose && ph.pose.src !== "sensors" && ph.pose.heading != null && ph.pose.sigma?.pos != null ? ph.pose : null;   // anchored: the corrected pose and its sigma
    if (!cov || (!p && (ph.posSrc !== "gps" || ph.heading == null))) return;   // stale or missing position paints nothing
    const [x, y] = toUtm(p ? [p.lng, p.lat] : [ph.lng, ph.lat]);
    const r = cov.paint({ x, y, heading: p ? p.heading : ph.heading, hfov: frameHfov(ph.w, ph.h, photoFov(ph)), acc: p ? Math.max(1, p.sigma.pos) : ph.acc });
    if (r?.done.length) reward(r.done);
  }
  /* a ring completed: a short pulse (not with reduced motion), a buzz where the phone has one, and a line of text */
  function reward(ids) {
    const el = root.querySelector(".wgoals");
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) { el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }
    try { navigator.vibrate?.(60); } catch { /* no vibration */ }
    const t = cov.things.find(x => x.id === ids[0]);
    toast?.(`Ring fullført: ${t ? labelOf({ type: t.type, id: t.id }) : "ett til"} (${cov.ringsDone()}/${cov.things.length})`);
  }
  /* about twice a second: the panel text and, if something was painted, the fog picture */
  function coverageTick() {
    const el = root.querySelector(".wgoals"); el.hidden = false;
    const near = fix ? cov.nearest(...toUtm([fix.lng, fix.lat]), 3) : [], sig = `${cov.pctText()}|${cov.ringsDone()}|${near.map(n => n.thing.id + Math.round(n.dist)).join()}`;
    if (sig !== goalsSig) {
      goalsSig = sig;
      el.querySelector(".wpct").textContent = `${cov.pctText()} % dekket`; el.querySelector(".wrings").textContent = `· ringer fullført ${cov.ringsDone()}/${cov.things.length}`;
      el.querySelector(".wnear").innerHTML = near.map(n => `<li>${esc(goalText(n))}</li>`).join("") + (flow.run?.anchorSrc === "start-frame" ? "<li>Avslutt ved startpunktet (Ferdig)</li>" : "");
    }
    if (cov.dirty) { renderFog(); cov.dirty = false; }
  }
  /* the grid as a small picture (one pixel per 1 m cell), redrawn only when something changed */
  function renderFog() {
    covCv ||= document.createElement("canvas");
    if (covCv.width !== cov.w || covCv.height !== cov.h) { covCv.width = cov.w; covCv.height = cov.h; covImg = null; }
    const c = covCv.getContext("2d"); covImg ||= c.createImageData(cov.w, cov.h);
    const px = covImg.data;
    for (let j = 0; j < cov.h; j++) for (let i = 0; i < cov.w; i++) {
      const k = j * cov.w + i, o = k * 4, st = cov.state(k), alt = (i + j) & 1;
      let r = 0, g = 0, b = 0, a = 0;
      if (st === 0) { if (cov.inLot[k]) { r = 12; g = 22; b = 16; a = alt ? 170 : 215; } }          // fog: dark, fine checker
      else if (st === 1) { r = 255; g = 236; b = 150; a = 55; }                                       // thin: pale haze
      else if (st === 2) { r = 60; g = 210; b = 100; a = 120; }                                       // good: clear green
      else { r = 255; g = 140; b = 20; a = (i + 2 * j) % 4 < 2 ? 170 : 40; }                           // uncertain: orange stripes
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a;
    }
    c.putImageData(covImg, 0, 0);
  }
  function drawFog(ctx, P, k) {
    if (!covCv) renderFog();
    const [x, y] = P([cov.x0, cov.y0 + cov.h]);
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(covCv, x, y, cov.w * k, cov.h * k); ctx.restore();
  }
  /* a ring per thing, filling by the sides it was seen from; complete = a green dot with a tick */
  function drawRings(ctx, P) {
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const t of cov.things) {
      const [a, b] = P([t.x, t.y]), done = bitCount(t.mask) >= t.need;
      if (done) { ctx.beginPath(); ctx.arc(a, b, 7, 0, 7); ctx.fillStyle = "#2f9d4a"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = "#fff"; ctx.font = "bold 10px system-ui"; ctx.fillText("✓", a, b + 0.5); continue; }
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.beginPath(); ctx.arc(a, b, 7, 0, 7); ctx.stroke();
      ctx.strokeStyle = "#e8590c";
      for (let s = 0; s < 8; s++) if (t.mask & (1 << s)) { const c = (s * 45 - 90) * RAD; ctx.beginPath(); ctx.arc(a, b, 7, c - 0.38, c + 0.38); ctx.stroke(); }
    }
    ctx.restore();
  }

  /* North-up sketch of the lot with you on it. */
  function drawMini(tgt) {
    const d = doc(), ctx = mini.getContext("2d"), W = mini.width, lot = d.lot.ring.map(toUtm);
    const xs = lot.map(p => p[0]), ys = lot.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.25 + 8, k = W / span;
    const P = ([x, y]) => [W / 2 + (x - cx) * k, W / 2 - (y - cy) * k];
    const path = ring => { ctx.beginPath(); ring.forEach((q, i) => { const [a, b] = P(q); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.closePath(); };
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = "rgba(223,232,207,.92)"; path(lot); ctx.fill();
    ctx.strokeStyle = "#C8102E"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
    for (const b of d.buildings) { ctx.fillStyle = tgt?.id === b.id ? "#ffd23f" : "#e4dccf"; path(b.ring.map(toUtm)); ctx.fill(); ctx.strokeStyle = "#9a8e7c"; ctx.lineWidth = 1; ctx.stroke(); }
    for (const a of d.areas) if (!BACKGROUND.has(a.kind)) { ctx.fillStyle = tgt?.id === a.id ? "#ffd23f" : a.kind === "hedge" ? "#3f6b35" : "#b98a5e"; path(a.ring.map(toUtm)); ctx.fill(); }
    for (const it of d.items) { const [a, b] = P(toUtm([it.lng, it.lat])); ctx.beginPath(); ctx.arc(a, b, Math.max(3, (it.crown || 1) * k), 0, 7); ctx.fillStyle = tgt?.id === it.id ? "#ffd23f" : "rgba(80,130,60,.85)"; ctx.fill(); }
    if (cov && fogOn) drawFog(ctx, P, k);
    for (const ph of d.photos || []) { if (ph.lng == null) continue; const [a, b] = P(toUtm([ph.lng, ph.lat])); ctx.beginPath(); ctx.arc(a, b, 4, 0, 7); ctx.fillStyle = "#2f7fd8"; ctx.fill(); }
    if (cov && fogOn) drawRings(ctx, P);
    /* quest spots: numbered, with the way to look; the next one highlighted */
    const nx = nextSpot();
    const now = new Set(questNow(d)), spot = flowSpot(flow);
    if (spot) {   /* the start (or end) spot: a ring where to stand, an arrow the way to look */
      const [a, b] = P(toUtm(spot.spot)), h = spot.heading * RAD, r = Math.max(10, 3 * k);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(a, b, r, 0, 7); ctx.stroke();
      ctx.strokeStyle = "#e8590c"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(a, b, r, 0, 7); ctx.stroke();
      const tip = [a + Math.sin(h) * (r + 26), b - Math.cos(h) * (r + 26)];
      ctx.beginPath(); ctx.moveTo(a + Math.sin(h) * r, b - Math.cos(h) * r); ctx.lineTo(...tip); ctx.stroke();
      ctx.fillStyle = "#e8590c"; ctx.beginPath(); ctx.moveTo(...tip); ctx.lineTo(tip[0] - Math.sin(h - 0.5) * 10, tip[1] + Math.cos(h - 0.5) * 10); ctx.lineTo(tip[0] - Math.sin(h + 0.5) * 10, tip[1] + Math.cos(h + 0.5) * 10); ctx.closePath(); ctx.fill();
    }
    if (!fogOn && !spot) (d.quest?.items || []).forEach((q, k) => {
      if (!q.done && !now.has(q)) return;
      const [a, b] = P(toUtm([q.lng, q.lat])), h = q.heading * RAD;
      ctx.strokeStyle = q.done ? "#8a8a8a" : "#e8590c"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(a + Math.sin(h) * 22, b - Math.cos(h) * 22); ctx.stroke();
      ctx.beginPath(); ctx.arc(a, b, q === nx ? 11 : 9, 0, 7); ctx.fillStyle = q.done ? "#bdbdbd" : q === nx ? "#e8590c" : "#ffa94d"; ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 11px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(q.done ? "✓" : String(k + 1), a, b + 0.5);
    });
    if (!fix) return;
    const [ux, uy] = P(toUtm([fix.lng, fix.lat]));
    ctx.beginPath(); ctx.arc(ux, uy, Math.max(6, fix.acc * k), 0, 7); ctx.fillStyle = "rgba(47,127,216,.15)"; ctx.fill();
    if (heading != null) {
      const h = heading * RAD, r = 60;
      ctx.beginPath(); ctx.moveTo(ux, uy); ctx.arc(ux, uy, r, h - Math.PI / 2 - 0.4, h - Math.PI / 2 + 0.4); ctx.closePath();
      ctx.fillStyle = "rgba(47,127,216,.3)"; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(ux, uy, 7, 0, 7); ctx.fillStyle = "#2f7fd8"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.stroke();
    if (cov && fogOn) { const n = cov.nearest(...toUtm([fix.lng, fix.lat]), 1)[0]; if (n) { const a = n.bearing * RAD; ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ux + Math.sin(a) * 12, uy - Math.cos(a) * 12); ctx.lineTo(ux + Math.sin(a) * 34, uy - Math.cos(a) * 34); ctx.stroke(); ctx.fillStyle = "#e8590c"; ctx.beginPath(); ctx.arc(ux + Math.sin(a) * 36, uy - Math.cos(a) * 36, 4, 0, 7); ctx.fill(); } }
  }

  /* A picture into the upload queue: kept in the phone first (IndexedDB), so it is never lost, and given a few seconds to
     reach the server before it is called pending. Returns the id to use (the server's, or a provisional one that
     swapPhotoId replaces when the upload finally succeeds). Used by the camera and by "Legg til bilder". */
  async function addImage(image, { wait = true } = {}) {
    const entry = { id: pendingId(), project: projectId(), image, at: new Date().toISOString() };
    await queue.add(entry);
    localUrls.set(entry.id, await blobUrl(image).catch(() => null));
    const real = wait ? await Promise.race([queue.flush(entry.id), new Promise(ok => setTimeout(ok, navigator.onLine === false ? 0 : 4000, null))]) : null;
    if (real) localUrls.set(real, localUrls.get(entry.id));
    if (!real) setTimeout(drain, 0);
    return { id: real || entry.id, pending: !real };
  }

  /* ---------- Film while you walk ----------
     No video is recorded or uploaded. While it is on, a frame is taken from the live camera whenever it is sharp, the phone
     is not turning fast and it shows something new (createFramePicker); each frame gets the same record as a shutter photo,
     taken at that instant, and goes through the same upload queue. One canvas is reused; only the JPEG is kept. */
  function startFilm() {
    if (!started || flow.phase !== "run") return;
    const T = tune();
    film = { pick: createFramePicker({ cap: T.cap ?? 40, minSharp: T.minSharp ?? 25, minGapMs: T.minGapMs ?? 1500, maxGapMs: T.maxGapMs ?? 6000 }), last: 0, why: "" };
    fogOn = true; root.classList.add("fog"); if (cov) cov.dirty = true; lastCov = 0;
    const b = root.querySelector(".wfilm"); b.setAttribute("aria-pressed", "true"); filmLabel();
    toast?.("Filmer mens du går: går sakte, og peker mot det du vil ha med. Maks 40 bilder.");
  }
  function stopFilm(quiet) {
    if (!film) return;
    const n = film.pick.count; film = null;
    const b = root.querySelector(".wfilm"); b.setAttribute("aria-pressed", "false"); b.textContent = "Film mens du går";
    if (!quiet) toast?.(`Filmingen stoppet: ${n} bilde${n === 1 ? "" : "r"} valgt.`);
  }
  const filmLabel = () => { root.querySelector(".wfilm").textContent = `Stopp film · ${film.pick.count}/${film.pick.cap}`; };
  function sharpNow() {
    const W = 160, H = Math.max(8, Math.round(160 * (video.videoHeight / video.videoWidth)));
    if (!smallCv) { smallCv = document.createElement("canvas"); }
    if (smallCv.width !== W || smallCv.height !== H) { smallCv.width = W; smallCv.height = H; smallPx = new Uint8Array(W * H); }
    const c = smallCv.getContext("2d", { willReadFrequently: true }); c.drawImage(video, 0, 0, W, H);
    return laplacianVar(lumaInto(c.getImageData(0, 0, W, H).data, smallPx), W, H);
  }
  function filmTick(t) {
    if (busy || t - film.last < 200 || !video.videoWidth || document.hidden) return;
    film.last = t;
    const u = geo.use(); if (u.src === "none") return;   // a frame without a position is not worth keeping
    const xy = toUtm([u.fix.lng, u.fix.lat]), T = tune();
    const r = film.pick.consider({ t, rate: turnRate(hist, t), xy, heading, sharp: () => T.sharp ?? sharpNow() });
    film.why = r.why;
    if (r.keep) keepFrame(r);
  }
  async function keepFrame(r) {
    busy = true;
    try {
      const frame = grab(), use = geo.use(), ori = oriNow();
      await keep(frame, use, ori, "film", { seq: r.seq, sharp: Math.round(r.sharp) }, false);
      filmLabel();
      if (film && film.pick.count >= film.pick.cap) { stopFilm(true); toast?.("Filmingen er ferdig: 40 bilder er valgt."); }
    } catch (e) { console.warn(e); }
    busy = false;
  }
  /* the picture now on screen as a 1600 px JPEG (the one reused canvas) */
  function grab() {
    const s = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    shotCv ||= document.createElement("canvas");
    shotCv.width = Math.round(video.videoWidth * s); shotCv.height = Math.round(video.videoHeight * s);
    shotCv.getContext("2d").drawImage(video, 0, 0, shotCv.width, shotCv.height);
    return { image: shotCv.toDataURL("image/jpeg", 0.82), w: shotCv.width, h: shotCv.height };
  }

  /* ---------- The start spot and the anchors of a run (anchor.js, pose.js) ----------
     Start phase: the minimap shows the spot (ring, arrow the way to look), the camera shows the ghost of the roof lines drawn
     from the PLANNED pose with this camera's lens, and the hint walks you there (lineUpVerdict). The edge score of the live
     picture turns the ghost green; green, on the spot, tilted right and still fires the shutter by itself (Auto). The shutter
     ("Start runden") takes the start anchor: solvePose6 from the planned pose with the edge cost, the run's bias from it
     (runBias), and recording begins. Ferdig sends you back to the start spot for the end anchor (closeLoop). */
  const ANCHOR_PRIOR = { pos: 2, z: 0.3, heading: 6, pitch: 4, roll: 2 };
  const fmtM = m => `${(Math.round(m * 10) / 10).toString().replace(".", ",")} m`;
  function say(text) { if (!text) return; note = text; noteUntil = Date.now() + 10_000; toast?.(text); }
  function syncPhase() {
    if (!root) return;
    const k = shutterKind(flow), lining = k === "start" || k === "end", sh = root.querySelector(".shutter");
    root.classList.toggle("anchoring", lining);
    root.querySelector(".wspot").hidden = !lining; root.querySelector(".wcount").hidden = lining; root.querySelector(".wfilm").hidden = lining;
    sh.setAttribute("aria-label", k === "start" ? "Start runden" : k === "end" ? "Ta sluttbildet" : "Ta bilde");
    sh.dataset.label = k === "start" ? "Start runden" : k === "end" ? "Ta sluttbildet" : "";
    line = null;
  }
  /* "Kan ikke stå her": the next spot; none left starts the run without an anchor (or ends it without an end anchor) */
  function skipSpot() {
    const was = flow.phase;
    flow = runFlow(flow, { type: "skip" }); syncPhase();
    if (was === "start" && flow.phase === "run") say(flowNote(flow));
    else if (was === "end" && flow.phase === "done") { toast?.(flowNote(flow)); shut(); }
    else toast?.(`Neste startpunkt: ${flowSpot(flow)?.why || "se minikartet"}`);
  }
  const liveCam = () => ({ w: video.videoWidth, h: video.videoHeight, hfov: frameHfov(video.videoWidth, video.videoHeight, DEFAULT_FOV) });
  /* the ghost of the spot asked for now, for this camera (worked out again only when the spot or the picture size changes) */
  function ghostNow() {
    const spot = flowSpot(flow); if (!spot || !video.videoWidth) return null;
    const cam = liveCam();
    if (!line || line.id !== spot.id || line.w !== cam.w || line.h !== cam.h) line = { id: spot.id, w: cam.w, h: cam.h, spot, cam, segs: ghostScreen(spot, cam, toUtm), pose: planPose(spot, toUtm, cam), g3: ghost3(spot, toUtm), edge: null, green: false };
    return line;
  }
  /* edges of a picture (the video or the frame just taken) from a 320 px grey copy, as sharpNow does */
  function edgesOf(src, w, h) {
    const W = 320, H = Math.max(8, Math.round((320 * h) / w));
    edgeCv ||= document.createElement("canvas");
    if (edgeCv.width !== W || edgeCv.height !== H) { edgeCv.width = W; edgeCv.height = H; edgePx = new Uint8Array(W * H); }
    const c = edgeCv.getContext("2d", { willReadFrequently: true }); c.drawImage(src, 0, 0, W, H);
    return edgeMap(lumaInto(c.getImageData(0, 0, W, H).data, edgePx), W, H, { scale: w / W });
  }
  function lineUp(t) {
    const g = ghostNow(), el = root.querySelector(".whint"), end = flow.phase === "end";
    ancHist.push({ t, heading, pitch: pitchNow() }); while (ancHist.length && t - ancHist[0].t > 2000) ancHist.shift();
    if (!g) { el.textContent = "Starter kameraet …"; return; }
    if (t - edgeAt > 350 && !busy && !document.hidden) { edgeAt = t; try { const e = edgeScore(g.pose, g.g3, edgesOf(video, g.w, g.h)).mean; g.edge = Number.isFinite(e) ? e : null; } catch { g.edge = null; } }
    const v = fix ? lineUpVerdict(g.spot, { lng: fix.lng, lat: fix.lat, acc: fix.acc, heading, pitch: pitchNow(), steadyMs: steadyFor(ancHist, t), edge: g.edge }, { utm: toUtm }) : null;
    g.green = g.edge != null && g.edge <= 2.5;
    const text = v ? v.say + (v.hint ? ` · ${v.hint}` : "") : "Venter på GPS … Legg huset i omrisset og trykk";
    el.textContent = (end ? "Avslutt ved startpunktet · " + text.replace("startbildet", "sluttbildet") : text);
    if (v?.auto && auto && !busy && t - lastAnc > 3000) { lastAnc = t; anchorShot(end ? "end" : "start"); }
  }
  function drawGhost() {
    const W = ar.clientWidth, H = ar.clientHeight;
    if (ar.width !== W * devicePixelRatio) { ar.width = W * devicePixelRatio; ar.height = H * devicePixelRatio; }
    const ctx = ar.getContext("2d"); ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); ctx.clearRect(0, 0, W, H);
    const g = ghostNow(); if (!g) return;
    const m = coverMap(g.w, g.h, W, H);
    ctx.lineCap = "round"; ctx.shadowBlur = 0;
    for (const pass of [0, 1]) for (const sg of g.segs) {
      ctx.setLineDash(sg.kind === "skyline" ? [9, 7] : []); ctx.beginPath(); ctx.moveTo(...m.to(sg.a)); ctx.lineTo(...m.to(sg.b));
      ctx.lineWidth = pass ? 3 : 7; ctx.strokeStyle = pass ? (g.green ? "#3ddc6e" : "#fff") : "rgba(0,0,0,.45)"; ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  /* The anchor frame: the picture, the pose solved from the planned one with the edge cost (or the planned pose with a wider
     sigma when the house did not sit in the ghost), and the run's bias (start) or its loop closure (end). */
  async function anchorShot(which) {
    if (busy || !video.videoWidth || shutterKind(flow) !== which) return;
    const g = ghostNow(); if (!g) return;
    busy = true; root.classList.add("flash"); setTimeout(() => root.classList.remove("flash"), 160);
    try {
      const frame = grab(), ori = oriNow(), use = geo.use(), cam = { w: frame.w, h: frame.h, hfov: g.cam.hfov };
      const plan = planPose(g.spot, toUtm, cam), sol = solvePose6(plan, { ghost: ghost3(g.spot, toUtm), edges: edgesOf(shotCv, frame.w, frame.h) }, { prior: ANCHOR_PRIOR, fov: "fixed" });
      const fit = sol.edge != null && sol.edge <= 4, pose = fit ? sol.pose : plan;
      const sigma = fit ? { pos: Math.max(0.3, sol.sigma.pos ?? 1), heading: Math.max(0.5, sol.sigma.heading ?? 2), pitch: Math.max(0.5, sol.sigma.pitch ?? 2) } : { pos: 1.5, heading: 4, pitch: 3 };
      const { id, pending } = await addImage(frame.image, { wait: true });
      const ph = buildPhotoRecord({ id, pending, use, ori, cam: camNow(), dev, size: frame, mode: "anchor" });
      const prior = framePrior(ph, toUtm) || { t: Date.parse(ph.at), x: pose.x, y: pose.y, acc: null, heading: ph.heading, pitch: ph.tilt?.pitch ?? null };
      ph.anchor = which; ph.run = { id: flow.run.id, t: which === "start" ? 0 : Math.max(0, Date.parse(ph.at) - Date.parse(flow.run.start?.at || flow.run.at)) };
      ph.pose = { ...poseToDoc(pose, toLngLat, { src: "anchor", sigma, at: ph.at }), plan: g.spot.id, ...(sol.edge != null ? { edge: +sol.edge.toFixed(1) } : {}) };
      ph.target = rayTarget(doc(), toLngLat([pose.x, pose.y]), pose.heading) || ph.target || null;
      if (which === "start") {
        const bias = runBias(pose, prior, sigma);
        flow = runFlow(flow, { type: "anchor", which, photo: ph.id, at: ph.at, bias, z: +pose.z.toFixed(2) });
        paintPhoto(ph); onShot(ph); count++; waiting(); syncPhase(); hold = 0; lastShot = performance.now();
        say(fit ? `Startbildet er tatt: kompasset rettet ${Math.round(Math.abs(bias.dHeading))}°, GPS ${fmtM(Math.hypot(bias.dx, bias.dy))}. Runden er i gang.`
          : "Startbildet er tatt, men huset lå ikke helt i omrisset, så runden får større usikkerhet. Rett det inn under Bilder fra hagen etterpå. Runden er i gang.");
      } else {
        const drift = closeLoop(flow.run.bias, pose, prior);
        flow = runFlow(flow, { type: "anchor", which, photo: ph.id, at: ph.at, drift });
        onShot(ph); count++; waiting();
        reposeRun(doc(), flow.run, { utm: toUtm, toLL: toLngLat });
        note = flowNote(flow, closureText(drift)); noteUntil = Date.now() + 5000; status(note); toast?.(note); syncPhase();
        setTimeout(() => { if (!root.hidden && flow.phase === "done" && flow.run) shut(); }, 2500);   // the closure stays readable a moment
      }
    } catch (e) { console.warn(e); toast?.("Fikk ikke tatt ankerbildet. Prøv igjen."); }
    busy = false;
  }
  /* every other frame of the run: where it belongs in the run, and its pose corrected by the run's bias (or the sensors) */
  function runFrame(ph) {
    const r = flow.run; if (!r || flow.phase !== "run") return;
    ph.run = { id: r.id, t: Math.max(0, Date.parse(ph.at) - Date.parse(r.start?.at || r.at)) };
    const prior = framePrior(ph, toUtm); if (!prior) return;
    ph.pose = framePose(prior, r, toLngLat, { z: r.z ?? null, hfov: frameHfov(ph.w, ph.h, photoFov(ph)), at: ph.at, w: ph.w, h: ph.h });
  }

  /* No position at all: ask, once, with a way to try again. The photo is kept either way. */
  const askNoFix = () => new Promise(ok => {
    const box = root.querySelector(".wask"); box.hidden = false;
    const done = v => { box.hidden = true; ok(v); };
    root.querySelector(".wanyway").onclick = () => done("anyway"); root.querySelector(".wagain").onclick = () => done("retry");
  });

  async function shoot(mode = "shutter") {
    const kind = shutterKind(flow);
    if (kind === "start" || kind === "end") return anchorShot(kind);
    if (busy || !started || !video.videoWidth || kind !== "frame") return;
    busy = true; root.classList.add("flash"); setTimeout(() => root.classList.remove("flash"), 160);
    try {
      const frame = grab(), ori = oriNow();
      let use = geo.use();
      if (use.src === "none") {
        if ((await askNoFix()) === "retry") { geo.retry(); toast?.("Prøver GPS på nytt. Vent til GPS-feltet blir grønt, og ta bildet på nytt."); busy = false; return; }
        use = geo.use();   // a position may have arrived while the question was up
      }
      await keep(frame, use, ori, mode, {}, true);
    } catch (e) { console.warn(e); toast?.("Fikk ikke lagret bildet."); }
    busy = false;
  }

  /* One picture, with what the phone knew when it was taken, into the project and the upload queue. */
  async function keep(frame, use, ori, mode, extra, say) {
    const { id, pending } = await addImage(frame.image, { wait: say });
    const ph = { ...buildPhotoRecord({ id, pending, use, ori, cam: camNow(), dev, size: frame, mode }), ...extra };
    runFrame(ph);
    flow = runFlow(flow, { type: "frame" });
    const at = ph.lng == null ? null : [ph.lng, ph.lat], head = ph.heading;
    ph.target = at ? rayTarget(doc(), at, head) || (head == null ? guessTarget(doc(), at) : null) : null;
    if (at && head == null) ph.guessed = true;
    const done = questNow(doc()).filter(q => questDone(q, ph));
    for (const q of done) q.done = ph.id;
    paintPhoto(ph);
    onShot(ph); count++;
    const wq = waiting();
    if (say) {
      toast?.((done.length ? `Fotostopp ${done.map(q => doc().quest.items.indexOf(q) + 1).join(" og ")} fullført` : ph.target?.guess ? `Gjetter: festet til ${labelOf(ph.target)}. Endre det i bildepanelet om det er feil.` : ph.target ? `Festet til ${labelOf(ph.target)}` : at ? "Lagret. Pek mot noe for å feste bildet til det." : "Lagret uten posisjon. Plasser det i kartet etterpå (Bilder fra hagen › mangler plassering).")
        + (ph.posSrc === "gps-stale" ? ` Brukte siste posisjon (${Math.round(use.age)} s gammel).` : "") + (wq ? ` Venter på nett (${wq}): lastes opp av seg selv.` : ""));
    }
    if (wq) drain();
    return ph;
  }

  return { open, close, addImage, localUrl: id => localUrls.get(id) || null, pendingCount: () => queue.count(projectId()), drain };
}
