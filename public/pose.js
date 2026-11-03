/* Camera pose for anchored photo runs: the 6-parameter fix of one photo from the ghost of known roof lines, and the
   per-run correction (compass and GPS bias from the start anchor, linear drift from an end anchor) applied to every
   frame of the run. Pure maths, no DOM, no network: tests/pose.test.mjs runs it in node.

   Units: poses in EPSG:25833 metres (x east, y north, z height above sea level), angles in degrees (heading clockwise
   from north, pitch up positive, roll), pixels with (0, 0) top left, as walk.js (projectToPhoto, solvePose).
   What is stored in the plan (ph.pose) is EPSG:4326 (lng, lat): poseToDoc / poseFromDoc convert. */

const RAD = Math.PI / 180;
const wrap180 = a => ((((a + 180) % 360) + 360) % 360) - 180;
const norm360 = h => ((h % 360) + 360) % 360;

/**
 * @typedef {{ x: number, y: number, z: number, heading: number, pitch: number, roll?: number, hfov: number, w: number, h: number }} Pose
 * @typedef {[number, number, number]} P3
 * @typedef {{ P: P3, uv: [number, number] }} PointTie          a tap on a known 3D point
 * @typedef {{ A: P3, B: P3, pts: [number, number][], kind?: string }} LineTie   image points that lie somewhere on the 3D line A-B
 *   (a roof edge dragged onto the photo, or points picked along it); only the distance across the line counts, so an
 *   end hidden behind a tree does not matter
 * @typedef {{ A: P3, B: P3, kind?: string }} Line3
 * @typedef {{ dt: Float32Array, w: number, h: number, scale: number }} EdgeMap   distance (in edge-map pixels) to the
 *   nearest image edge; `scale` = photo pixels per edge-map pixel
 * @typedef {{ pos?: number, z?: number, heading?: number, pitch?: number, roll?: number, fov?: number }} Sigmas
 */

/* The camera's axes (forward, right, up) and focal length in pixels, as walk.js does it. */
export function camAxes(p) {
  const h = p.heading * RAD, t = p.pitch * RAD, r = (p.roll || 0) * RAD;
  const f = [Math.sin(h) * Math.cos(t), Math.cos(h) * Math.cos(t), Math.sin(t)], r0 = [Math.cos(h), -Math.sin(h), 0], u0 = [-Math.sin(h) * Math.sin(t), -Math.cos(h) * Math.sin(t), Math.cos(t)];
  const right = r0.map((v, i) => v * Math.cos(r) + u0[i] * Math.sin(r)), up = u0.map((v, i) => v * Math.cos(r) - r0[i] * Math.sin(r));
  return { f, right, up, focal: p.w / 2 / Math.tan((p.hfov * RAD) / 2) };
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** A 3D point in the photo: [u, v, depth], or null behind the camera (the same as walk.js projectToPhoto, kept here so
 *  this file stands alone). @param {Pose} pose @param {number[]} P */
export function projectPoint(pose, P) {
  const { f, right, up, focal } = camAxes(pose), d = [P[0] - pose.x, P[1] - pose.y, P[2] - pose.z], zc = dot3(d, f);
  if (zc <= 0.05) return null;
  return [pose.w / 2 + (focal * dot3(d, right)) / zc, pose.h / 2 - (focal * dot3(d, up)) / zc, zc];
}

/** A 3D segment in the photo, cut where it passes behind the camera (`near` metres): { a, b } in pixels, or null when
 *  all of it is behind. Not cut to the picture frame: a canvas clips, and the edge cost skips samples outside.
 *  @param {Pose} pose @param {P3} A @param {P3} B */
export function projectSegment(pose, A, B, near = 0.3) {
  const ax = camAxes(pose), cam = P => { const d = [P[0] - pose.x, P[1] - pose.y, P[2] - pose.z]; return [dot3(d, ax.right), dot3(d, ax.up), dot3(d, ax.f)]; };
  let a = cam(A), b = cam(B);
  if (a[2] < near && b[2] < near) return null;
  const cut = (p, q) => { const t = (near - p[2]) / (q[2] - p[2]); return p.map((v, i) => v + (q[i] - v) * t); };
  if (a[2] < near) a = cut(a, b); else if (b[2] < near) b = cut(b, a);
  const px = c => [pose.w / 2 + (ax.focal * c[0]) / c[2], pose.h / 2 - (ax.focal * c[1]) / c[2]];
  return { a: px(a), b: px(b) };
}

/* ---------- Edges in the photo: Sobel, then a distance transform (the chamfer map the ghost lines are scored on) ---------- */

/** Exact Euclidean distance (pixels) from every cell to the nearest set cell of `mask` (Felzenszwalb and Huttenlocher, two 1D passes).
 *  @param {Uint8Array} mask @param {number} w @param {number} h */
export function distanceTransform(mask, w, h) {
  const INF = 1e12, g = new Float64Array(w * h), out = new Float32Array(w * h);
  const f = new Float64Array(Math.max(w, h)), d = new Float64Array(Math.max(w, h)), v = new Int32Array(Math.max(w, h)), z = new Float64Array(Math.max(w, h) + 1);
  const pass = n => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
  };
  for (let c = 0; c < w; c++) { for (let r = 0; r < h; r++) f[r] = mask[r * w + c] ? 0 : INF; pass(h); for (let r = 0; r < h; r++) g[r * w + c] = d[r]; }
  for (let r = 0; r < h; r++) { for (let c = 0; c < w; c++) f[c] = g[r * w + c]; pass(w); for (let c = 0; c < w; c++) out[r * w + c] = Math.sqrt(Math.min(d[c], INF)); }
  return out;
}

/** Edge map of a grey picture (one byte per pixel, as lumaInto in walk.js makes it), for the edge cost. Give it a small copy
 *  (about 320 px wide, as sharpNow uses); `scale` is photo pixels per pixel of that copy. Edges are Sobel magnitudes thinned
 *  to one pixel (kept only where they peak across the edge), above `minMag` and in the stronger half (`keep`) of those.
 *  @param {Uint8Array} gray @returns {EdgeMap} */
export function edgeMap(gray, w, h, { scale = 1, minMag = 60, keep = 0.5 } = {}) {
  const mag = new Float32Array(w * h), dir = new Uint8Array(w * h);
  for (let r = 1; r < h - 1; r++) for (let c = 1; c < w - 1; c++) {
    const i = r * w + c, g = k => gray[k];
    const gx = g(i - w + 1) + 2 * g(i + 1) + g(i + w + 1) - g(i - w - 1) - 2 * g(i - 1) - g(i + w - 1);
    const gy = g(i + w - 1) + 2 * g(i + w) + g(i + w + 1) - g(i - w - 1) - 2 * g(i - w) - g(i - w + 1);
    mag[i] = Math.hypot(gx, gy);
    const a = ((Math.atan2(gy, gx) / RAD) + 180) % 180;   // gradient direction, quantised to 0, 45, 90, 135
    dir[i] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
  }
  const step = [1, w + 1, w, w - 1], thin = new Float32Array(w * h);
  for (let i = w; i < w * (h - 1); i++) { const m = mag[i], s = step[dir[i]]; if (m > 0 && m >= mag[i - s] && m >= mag[i + s]) thin[i] = m; }
  const nz = Array.from(thin).filter(v => v > 0).sort((x, y) => x - y), thr = Math.max(minMag, nz.length ? nz[Math.floor((1 - keep) * (nz.length - 1))] : Infinity);
  const mask = new Uint8Array(w * h); for (let i = 0; i < mask.length; i++) mask[i] = thin[i] >= thr && thin[i] > 0 ? 1 : 0;
  return { dt: distanceTransform(mask, w, h), w, h, scale };
}

/* Distance to the nearest edge at a photo pixel (bilinear in the edge map), in edge-map pixels; NaN outside it. */
function dtAt(E, u, v) {
  const x = u / E.scale - 0.5, y = v / E.scale - 0.5, c = Math.floor(x), r = Math.floor(y);
  if (c < 0 || r < 0 || c >= E.w - 1 || r >= E.h - 1) return NaN;
  const a = x - c, b = y - r, i = r * E.w + c, d = E.dt;
  return d[i] * (1 - a) * (1 - b) + d[i + 1] * a * (1 - b) + d[i + E.w] * (1 - a) * b + d[i + E.w + 1] * a * b;
}

/** How well projected lines sit on image edges: mean distance (edge-map pixels, capped) over samples inside the photo,
 *  and how many samples that was. A ghost that sits on the house gives about 1-2.
 *  @param {Pose} pose @param {Line3[]} lines @param {EdgeMap} E */
export function edgeScore(pose, lines, E, { per = 16, cap = 12 } = {}) {
  let sum = 0, n = 0;
  for (const L of lines) {
    const s = projectSegment(pose, L.A, L.B); if (!s) continue;
    for (let k = 0; k < per; k++) { const t = (k + 0.5) / per, d = dtAt(E, s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t); if (!Number.isNaN(d)) { sum += Math.min(cap, d); n++; } }
  }
  return { mean: n ? sum / n : NaN, n };
}

/* ---------- Small dense linear algebra for the damped Gauss-Newton ---------- */
function solveN(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    if (Math.abs(M[p][i]) < 1e-12) return null;
    [M[i], M[p]] = [M[p], M[i]];
    for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}
function invertN(A) {
  const n = A.length, cols = [];
  for (let k = 0; k < n; k++) { const c = solveN(A, A.map((_, i) => (i === k ? 1 : 0))); if (!c) return null; cols.push(c); }
  return A.map((_, i) => A.map((_, j) => cols[j][i]));
}
/* Damped Gauss-Newton on residual function res(q) (numeric Jacobian). Returns { q, r, H, iters }. */
function lm(res, q0, eps, iters) {
  const cost = r => r.reduce((s, v) => s + v * v, 0), n = q0.length;
  let q = q0.slice(), r = res(q), c = cost(r), lambda = 1e-3, it = 0, H = null;
  for (; it < iters; it++) {
    const J = q.map((_, k) => { const qq = q.slice(); qq[k] += eps[k]; return res(qq).map((v, i) => (v - r[i]) / eps[k]); });
    H = J.map(a => J.map(b => a.reduce((s, v, i) => s + v * b[i], 0)));
    const g = J.map(a => a.reduce((s, v, i) => s + v * r[i], 0));
    let accepted = false;
    for (let tries = 0; tries < 10 && !accepted; tries++) {
      const A = H.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)));
      const d = solveN(A, g.map(v => -v)); if (!d) { lambda *= 10; continue; }
      const qn = q.map((v, k) => v + d[k]), rn = res(qn), cn = cost(rn);
      if (cn < c) { const done = c - cn < 1e-10 * (1 + c); q = qn; r = rn; c = cn; lambda = Math.max(1e-7, lambda / 5); accepted = true; if (done) it = iters; } else lambda *= 5;
    }
    if (!accepted) break;
  }
  if (n && !H) H = q.map(() => q.map(() => 0));
  return { q, r, H, iters: it };
}

export const POSE6_PRIOR = Object.freeze({ pos: 5, z: 0.2, heading: 12, pitch: 3, roll: 1, fov: 0.05 });

/**
 * The pose of one photo from a planned pose (the start spot it was lined up on, or the run-corrected sensor pose) and
 * what is seen in it: taps on known points, image points on known 3D lines (roof edges, ridge, skyline), and the
 * automatic edge cost of `ghost` lines against an edge map of the photo. Solves x, y, z, heading, pitch and roll; the
 * field of view too when there are 4 or more taps and lines together and `fov` is not "fixed". Each parameter is held to
 * the planned value by a prior (1 sigma: `prior`), so a single line still gives a stable answer.
 * @param {Pose} plan
 * @param {{ ties?: PointTie[], lines?: LineTie[], ghost?: Line3[], edges?: EdgeMap|null }} obs
 * @param {{ prior?: Sigmas, sigTap?: number, sigLine?: number, sigEdge?: number, fov?: "auto"|"fixed", iters?: number, per?: number, cap?: number }} [opts]
 * @returns {{ pose: Pose, rms: number|null, edge: number|null, sigma: Sigmas, iters: number, n: { ties: number, lines: number, edges: number }, fovSolved: boolean }}
 */
export function solvePose6(plan, { ties = [], lines = [], ghost = [], edges = null } = {}, { prior = POSE6_PRIOR, sigTap = 15, sigLine = 8, sigEdge = 3, fov = "auto", iters = 40, per = 16, cap = 12 } = {}) {
  const P = { ...POSE6_PRIOR, ...prior }, solveFov = fov !== "fixed" && ties.length + lines.length >= 4;
  const q0 = [plan.x, plan.y, plan.z, plan.heading, plan.pitch, plan.roll || 0, ...(solveFov ? [plan.hfov] : [])];
  const sc = [P.pos, P.pos, P.z, P.heading, P.pitch, P.roll, ...(solveFov ? [P.fov * plan.hfov] : [])];
  const at = q => ({ ...plan, x: q[0], y: q[1], z: q[2], heading: q[3], pitch: q[4], roll: q[5], hfov: solveFov ? q[6] : plan.hfov });
  const nLinePts = lines.reduce((s, L) => s + L.pts.length, 0), useEdges = edges && ghost.length;
  const wEdge = 1 / Math.sqrt(per);   // each ghost line weighs about as much as one tap
  const res = q => {
    const p = at(q), r = [];
    for (const t of ties) { const pr = projectPoint(p, t.P); r.push(pr ? (pr[0] - t.uv[0]) / sigTap : 1000, pr ? (pr[1] - t.uv[1]) / sigTap : 1000); }
    for (const L of lines) {
      const s = projectSegment(p, L.A, L.B), dx = s ? s.b[0] - s.a[0] : 0, dy = s ? s.b[1] - s.a[1] : 0, len = Math.hypot(dx, dy);
      for (const [u, v] of L.pts) r.push(s && len > 1e-6 ? ((u - s.a[0]) * dy - (v - s.a[1]) * dx) / len / sigLine : 1000);
    }
    if (useEdges) for (const L of ghost) {
      const s = projectSegment(p, L.A, L.B);
      for (let k = 0; k < per; k++) {
        const t = (k + 0.5) / per, d = s ? dtAt(edges, s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t) : NaN;
        r.push(((Number.isNaN(d) ? cap : Math.min(cap, d)) / sigEdge) * wEdge);
      }
    }
    for (let k = 0; k < q.length; k++) r.push((q[k] - q0[k]) / sc[k]);
    return r;
  };
  const { q, r, H, iters: it } = lm(res, q0, q0.map(() => 0.01), iters);
  const cov = invertN(H), sd = k => (cov && cov[k][k] > 0 ? Math.sqrt(cov[k][k]) : null);
  const mT = ties.length * 2, rmsT = mT + nLinePts ? Math.sqrt((r.slice(0, mT).reduce((s, v) => s + (v * sigTap) ** 2, 0) + r.slice(mT, mT + nLinePts).reduce((s, v) => s + (v * sigLine) ** 2, 0)) / (mT + nLinePts)) : null;
  const pose = at(q); pose.heading = norm360(pose.heading);
  const edge = useEdges ? edgeScore(pose, ghost, edges, { per, cap }).mean : null;
  return {
    pose, rms: rmsT, edge: edge != null && Number.isFinite(edge) ? edge : null, iters: it, fovSolved: solveFov,
    sigma: { pos: sd(0) != null && sd(1) != null ? Math.hypot(sd(0), sd(1)) : null, z: sd(2), heading: sd(3), pitch: sd(4), roll: sd(5), fov: solveFov && sd(6) != null ? sd(6) / pose.hfov : 0 },
    n: { ties: ties.length, lines: lines.length, edges: useEdges ? ghost.length : 0 },
  };
}

/* ---------- One run: bias from the start anchor, drift from the end anchor ----------
   A frame's sensor prior is { t (ms), x, y (GPS, UTM), acc (m), heading (compass), pitch }. */

/**
 * @typedef {{ t: number, x: number, y: number, acc?: number|null, heading: number|null, pitch?: number|null }} Prior
 * @typedef {{ dHeading: number, dx: number, dy: number, t0: number, sigma: { pos: number, heading: number } }} RunBias
 * @typedef {{ t1: number, closure_m: number, closure_deg: number, dHeadingPerMin: number, dxPerMin: number, dyPerMin: number, unreliable: boolean }} RunDrift
 */
export const DRIFT_RATE = Object.freeze({ heading: 2, pos: 1 });   // deg and m per minute since the nearest anchor [S, to measure in slice 1]
export const CLOSURE_MAX = Object.freeze({ m: 3, deg: 10 });

/** The run's bias at its start anchor: what the solved anchor pose says minus what the phone said for that frame.
 *  @param {Pose & { t?: number }} anchor the solved pose of the start frame @param {Prior} prior that frame's sensors
 *  @param {{ pos?: number, heading?: number }} [sigma] the anchor's own 1-sigma (solvePose6 sigma; defaults 0.4 m, 1°) @returns {RunBias} */
export function runBias(anchor, prior, sigma = {}) {
  return {
    dHeading: prior.heading == null ? 0 : +wrap180(anchor.heading - prior.heading).toFixed(2),
    dx: +(anchor.x - prior.x).toFixed(2), dy: +(anchor.y - prior.y).toFixed(2), t0: prior.t,
    sigma: { pos: sigma.pos ?? 0.4, heading: sigma.heading ?? 1 },
  };
}

/** Loop closure at the end anchor: the solved end pose against the end frame's sensors corrected by the start bias.
 *  Over CLOSURE_MAX (3 m or 10°) the drift is marked unreliable and no linear correction is made from it.
 *  @param {RunBias} bias @param {Pose} endAnchor @param {Prior} endPrior @returns {RunDrift} */
export function closeLoop(bias, endAnchor, endPrior, { max = CLOSURE_MAX } = {}) {
  const min = Math.max(1 / 60, (endPrior.t - bias.t0) / 60000);
  const dh = endPrior.heading == null ? 0 : wrap180(endAnchor.heading - (endPrior.heading + bias.dHeading));
  const dx = endAnchor.x - (endPrior.x + bias.dx), dy = endAnchor.y - (endPrior.y + bias.dy), m = Math.hypot(dx, dy);
  return {
    t1: endPrior.t, closure_m: +m.toFixed(2), closure_deg: +Math.abs(dh).toFixed(1),
    dHeadingPerMin: +(dh / min).toFixed(3), dxPerMin: +(dx / min).toFixed(3), dyPerMin: +(dy / min).toFixed(3),
    unreliable: m > max.m || Math.abs(dh) > max.deg,
  };
}

/** A frame's sensor prior corrected by the run: bias plus (when an end anchor closed the loop reliably) the linear drift
 *  at the frame's time. The sigma grows with the time to the nearest anchor (DRIFT_RATE); position keeps the raw GPS when
 *  the corrected sigma would be no better than the fix itself.
 *  @param {Prior} prior @param {RunBias} bias @param {RunDrift|null} [drift]
 *  @returns {{ x: number, y: number, heading: number|null, pitch: number|null, sigma: { pos: number, heading: number|null }, posFrom: "run-anchor"|"gps", src: "run-anchor" }} */
export function correctPrior(prior, bias, drift = null, { rate = DRIFT_RATE } = {}) {
  const m0 = Math.abs(prior.t - bias.t0) / 60000, good = drift && !drift.unreliable, m1 = good ? Math.abs(drift.t1 - prior.t) / 60000 : Infinity;
  const near = Math.min(m0, m1);
  /* minutes of drift to apply: none before the start anchor, the full end correction after the end anchor */
  const k = good ? Math.max(0, Math.min((prior.t - bias.t0) / 60000, (drift.t1 - bias.t0) / 60000)) : 0;
  const sh = Math.hypot(bias.sigma.heading, rate.heading * near, drift?.unreliable ? drift.closure_deg : 0);
  const sp = Math.hypot(bias.sigma.pos, rate.pos * near, drift?.unreliable ? drift.closure_m : 0);
  const heading = prior.heading == null ? null : norm360(prior.heading + bias.dHeading + (good ? drift.dHeadingPerMin * k : 0));
  const useBias = !(prior.acc != null && sp >= prior.acc);
  return {
    x: useBias ? prior.x + bias.dx + (good ? drift.dxPerMin * k : 0) : prior.x,
    y: useBias ? prior.y + bias.dy + (good ? drift.dyPerMin * k : 0) : prior.y,
    heading: heading == null ? null : +heading.toFixed(2), pitch: prior.pitch ?? null,
    sigma: { pos: +(useBias ? sp : prior.acc).toFixed(2), heading: heading == null ? null : +sh.toFixed(2) }, posFrom: useBias ? "run-anchor" : "gps", src: "run-anchor",
  };
}

/** "avvik ved retur: 1,2 m, 3°" (and a warning when it is too large to correct by). @param {RunDrift|null} drift */
export function closureText(drift) {
  if (!drift) return "ingen sluttanker: retningen er rettet fra startbildet alene";
  const t = `avvik ved retur: ${drift.closure_m.toFixed(1).replace(".", ",")} m, ${Math.round(drift.closure_deg)}°`;
  return drift.unreliable ? t + " (for stort til å rette etter, bildene får større usikkerhet)" : t;
}

/**
 * One photo run, kept in doc.runs[] (private: guards.mjs stripPrivate drops it; merge.js keeps the better-anchored side).
 * @typedef {{ id: string, at: string, plan: string|null, start: { photo: string, at: string }|null, end: { photo: string, at: string }|null,
 *   anchorSrc: "start-frame"|"start+end"|"pin-aim"|"none", bias: RunBias|null, drift: RunDrift|null, profile: "tur"|"skann", frames: number,
 *   skipped: string[], focal: { dev: string, px: number }|null, z?: number|null }} Run
 *   plan: the doc.anchorPlan spot id the run started on; skipped: spot ids the user said "Kan ikke stå her" to; z: the camera
 *   height of the start anchor (metres above sea level), used for the frames' poses
 */
/** A new run, before its start anchor is taken. @returns {Run}
 * @param {{ id: string, plan?: string|null, profile?: "tur"|"skann", at?: string }} o */
export function makeRun({ id, plan = null, profile = "tur", at = new Date().toISOString() }) {
  return { id, at, plan, start: null, end: null, anchorSrc: "none", bias: null, drift: null, profile, frames: 0, skipped: [], focal: null };
}

/** The source of a run's correction, for doc.runs[].anchorSrc. @param {{ start?: boolean, end?: boolean, pinAim?: boolean }} had */
export const anchorSrcOf = ({ start = false, end = false, pinAim = false } = {}) => (start && end ? "start+end" : start ? "start-frame" : pinAim ? "pin-aim" : "none");

/* ---------- ph.pose in the plan (EPSG:4326) ---------- */
export const POSE_SRC = Object.freeze(["sensors", "exif", "run-anchor", "sfm", "taps", "anchor"]);
/** Rank of a pose source when two devices disagree (merge.js): what a person lined up or tapped beats a solve, which
 *  beats a run correction, which beats raw sensors. */
export const poseRank = src => ({ none: 0, sensors: 1, exif: 1, "run-anchor": 2, sfm: 3, taps: 4, anchor: 4 })[src] ?? 0;

/** A solved pose as stored on a photo: { lng, lat, z, heading, pitch, roll, hfov, src, sigma, rms, at }.
 *  @param {Pose} pose @param {(p: number[]) => number[]} toLL EPSG:25833 → [lng, lat] */
export function poseToDoc(pose, toLL, { src = "anchor", sigma = null, rms = null, at = new Date().toISOString() } = {}) {
  const [lng, lat] = toLL([pose.x, pose.y]), r = (v, d) => (v == null ? null : +(+v).toFixed(d));
  return {
    lng: r(lng, 7), lat: r(lat, 7), z: r(pose.z, 2), heading: r(norm360(pose.heading), 2), pitch: r(pose.pitch, 2), roll: r(pose.roll || 0, 2), hfov: r(pose.hfov, 2), src,
    sigma: sigma ? { pos: r(sigma.pos, 2), heading: r(sigma.heading, 2), pitch: r(sigma.pitch, 2) } : null, rms: r(rms, 1), at,
  };
}
/** The stored pose back in metres, with the photo's pixel size. @param {(p: number[]) => number[]} utm @returns {Pose} */
export function poseFromDoc(p, utm, { w = 1200, h = 1600 } = {}) {
  const [x, y] = utm([p.lng, p.lat]);
  return { x, y, z: p.z, heading: p.heading, pitch: p.pitch ?? 0, roll: p.roll ?? 0, hfov: p.hfov, w, h };
}

/* ---------- The frames of a run in the plan ----------
   A run frame keeps what the phone said in its own fields (lng, lat, acc, heading, tilt: posSrc "gps", dirSrc "compass") and
   gets ph.pose: the run-corrected pose ("run-anchor") when the run has an anchor, else the sensors themselves ("sensors"),
   so a later pin and aim can still find the phone's own reading after the owner has moved the photo. */

/** A frame's sensor prior (EPSG:25833) for correctPrior: from a "sensors" pose when it has one, else from the photo's own
 *  fields while they are still the phone's (not moved or aimed by hand). null without a position.
 *  @param {any} ph @param {(p: number[]) => number[]} utm @returns {Prior|null} */
export function framePrior(ph, utm) {
  const t = Date.parse(ph.at);
  if (ph.pose?.src === "sensors" && ph.pose.lng != null) { const [x, y] = utm([ph.pose.lng, ph.pose.lat]); return { t, x, y, acc: ph.pose.sigma?.pos ?? null, heading: ph.pose.heading ?? null, pitch: ph.pose.pitch ?? null }; }
  if (ph.lng == null || ph.posSrc === "manual") return null;
  const [x, y] = utm([ph.lng, ph.lat]);
  return { t, x, y, acc: ph.acc ?? null, heading: ph.dirSrc === "manual" ? null : ph.heading ?? null, pitch: ph.tilt?.pitch ?? null };
}

/** ph.pose for one frame of a run: the prior corrected by the run's bias (and drift), or the raw sensors when the run has no
 *  anchor. `z` is the camera height (the anchor's, or the start spot's), `hfov` the frame's own.
 *  @param {Prior} prior @param {{ bias?: RunBias|null, drift?: RunDrift|null }} run @param {(p: number[]) => number[]} toLL
 *  @param {{ z?: number|null, hfov?: number, at?: string, w?: number, h?: number }} [o] */
export function framePose(prior, run, toLL, { z = null, hfov = 51, at = new Date().toISOString(), w = 1200, h = 1600 } = {}) {
  if (!run?.bias) {
    const d = poseToDoc({ x: prior.x, y: prior.y, z, heading: prior.heading ?? 0, pitch: prior.pitch ?? 0, roll: 0, hfov, w, h }, toLL, { src: "sensors", sigma: { pos: prior.acc ?? null, heading: null, pitch: null }, at });
    return prior.heading == null ? { ...d, heading: null } : d;
  }
  const c = correctPrior(prior, run.bias, run.drift || null);
  const d = poseToDoc({ x: c.x, y: c.y, z, heading: c.heading ?? 0, pitch: c.pitch ?? 0, roll: 0, hfov, w, h }, toLL, { src: "run-anchor", sigma: { pos: c.sigma.pos, heading: c.sigma.heading, pitch: 3 }, at });
  return c.heading == null ? { ...d, heading: null } : d;
}

const isAnchorFrame = (ph, run) => [run.start?.photo, run.end?.photo].some(id => id != null && (id === ph.id || id === ph.was));
/** Every frame of a run again, after its correction changed (the end anchor closed the loop, or a pin and aim gave it one):
 *  the anchor frames and frames the owner fixed himself (posed by taps or an anchor, or moved by hand) keep theirs.
 *  Returns how many frames got a new pose. @param {{ photos?: any[] }} doc */
export function reposeRun(doc, run, { utm, toLL, at = new Date().toISOString() }) {
  let n = 0;
  for (const ph of doc.photos || []) {
    if (ph.run?.id !== run.id || isAnchorFrame(ph, run) || poseRank(ph.pose?.src) >= poseRank("sfm")) continue;
    const prior = framePrior(ph, utm); if (!prior) continue;
    ph.pose = framePose(prior, run, toLL, { z: ph.pose?.z ?? run.z ?? null, hfov: ph.pose?.hfov ?? 51, at, w: ph.w, h: ph.h }); n++;
  }
  return n;
}

/** A run that started without an anchor gets one from a frame the owner has pinned and aimed (or lined up) by hand:
 *  the bias is that pose minus what the phone said for the frame (its prior, read before the photo was changed); the other
 *  frames are corrected by it. Only for a run with no better anchoring. Returns the run, or null when nothing changed.
 *  @param {{ photos?: any[], runs?: any[] }} doc @param {any} ph @param {Pose} pose @param {Prior} prior */
export function anchorRunFromPhoto(doc, ph, pose, prior, { utm, toLL, sigma = { pos: 1, heading: 5 }, at = new Date().toISOString() }) {
  const run = (doc.runs || []).find(r => r.id === ph.run?.id);
  if (!run || !prior || run.anchorSrc !== "none") return null;
  run.bias = runBias(pose, prior, sigma); run.anchorSrc = anchorSrcOf({ pinAim: true }); run.start = { photo: ph.id, at: ph.at, by: "pin-aim" };
  reposeRun(doc, run, { utm, toLL, at });
  return run;
}
