/* A drawn sheet, one copy: the drafting pieces a plan, a section or a part drawing is made of (sykehus' drawing.js moved here, U3943).
   Pure ES module, no DOM, no three.js. A sheet is { prims, W, H, title? }; prims are in pixels of the final picture:
     { t: "line", a, b, col, w, dash } | { t: "poly", pts, fill, stroke, w } | { t: "text", p, s, size, col, anchor: "l"|"m"|"r", rot: 0|-90, bg }
   text size = pixels per font cell (2 gives letters 10 x 14 px). toSVG(sheet) writes them as SVG; sheet-png.mjs (node only) as a PNG.
   Every helper pushes prims and, for a dimension, a record in `dims` ({ ...rec, text }): the drawing's numbers come from the
   caller's model, the helper only draws them. */
const INK = [30, 30, 36], DIMC = [0, 84, 150], AXIS = [190, 40, 40], GREY = [120, 120, 128], ORANGE = [235, 110, 20], TEXT_BG = true;
const PX_PER_M_1_1 = 3779.5;   // pixels per metre at 1:1 on a 96 dpi screen; at 1:N it is this / N
const NICE = [20, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];

const r2 = v => Math.round(v * 100) / 100 + 0, r1 = v => Math.round(v * 10) / 10 + 0;
export const com = v => String(v).replace(".", ",");
export const kote = v => (v < 0 ? "-" : "+") + Math.abs(v).toFixed(2).replace(".", ",");
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k], len = a => Math.hypot(a[0], a[1]);
const unit = a => { const L = len(a) || 1; return [a[0] / L, a[1] / L]; };
export const textW = (s, size) => String(s).length * 6 * size - size;

/* scale: px per metre for what must fit in avail pixels; N is the 1:N asked for. Refuses with the smallest 1:N that fits. */
export function fitScale(spanW, spanH, availW, availH, N) {
  const fit = Math.min(availW / Math.max(spanW, 1e-6), availH / Math.max(spanH, 1e-6));
  if (N == null) { const n = PX_PER_M_1_1 / fit, nice = NICE.find(x => x >= n) || Math.ceil(n / 1000) * 1000; return { p: fit, N: nice, said: `ca. 1:${nice}` }; }
  if (!(N >= 10 && N <= 100000)) throw new Error("scale er målestokken som tall, for eksempel 200 for 1:200 (mellom 10 og 100000)");
  const p = PX_PER_M_1_1 / N;
  if (p > fit * 1.0001) { const n = PX_PER_M_1_1 / fit, nice = NICE.find(x => x >= n) || Math.ceil(n / 1000) * 1000; throw new Error(`Det får ikke plass i 1:${N}; det minste målet som passer i bildet er 1:${nice}. Bruk scale: ${nice} eller la scale stå.`); }
  return { p, N, said: `1:${N}` };
}

/* ----- primitives ----- */
export const T = (prims, p, s, o = {}) => prims.push({ t: "text", p, s, size: o.size || 2, col: o.col || INK, anchor: o.anchor || "l", rot: o.rot || 0, bg: o.bg });
export const Ln = (prims, a, b, col = INK, w = 1, dash = null) => prims.push({ t: "line", a, b, col, w, dash });
export const Pg = (prims, pts, fill, stroke, w = 1) => prims.push({ t: "poly", pts, fill, stroke, w });
const circlePts = (c, r, n = 48) => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos(i / n * 2 * Math.PI), c[1] + r * Math.sin(i / n * 2 * Math.PI)]);
const circle = (prims, c, r, fill = null, stroke = INK, w = 1) => Pg(prims, circlePts(c, r), fill, stroke, w);
const arrow = (prims, tip, d, col, s = 8) => { const t = [-d[1], d[0]]; Pg(prims, [tip, sub(sub(tip, mul(d, s)), mul(t, s * 0.3)), sub(add(tip, mul(t, s * 0.3)), mul(d, s))], col, col, 1); };   // d: the way the arrow points

/* an architect's dimension line between two points in pixels, pushed off by `off` px along n (unit, px), ticks at both ends, text in the middle */
export function dimLine(prims, dims, A, B, n, off, text, rec) {
  const a = add(A, mul(n, off)), b = add(B, mul(n, off)), e = mul(n, off > 0 ? 5 : -5);
  Ln(prims, A, add(a, e), DIMC, 1); Ln(prims, B, add(b, e), DIMC, 1); Ln(prims, a, b, DIMC, 1.2);
  const d = unit(sub(b, a)), t = [-d[1], d[0]];
  for (const q of [a, b]) Ln(prims, add(q, mul(add(d, t), -5)), add(q, mul(add(d, t), 5)), DIMC, 1.6);
  const mid = mul(add(a, b), 0.5), steep = Math.abs(d[1]) > Math.abs(d[0]) * 1.5, fits = len(sub(b, a)) > textW(text, 1.6) + 10;
  if (steep && !fits) T(prims, [mid[0] + 8, mid[1] + 5], text, { size: 1.6, col: DIMC, bg: TEXT_BG });   // a short vertical dimension: the text beside it, not along it
  else T(prims, steep ? [mid[0] - 4, mid[1]] : [mid[0], mid[1] - 4], text, { size: 1.6, col: DIMC, anchor: "m", rot: steep ? -90 : 0, bg: TEXT_BG });
  dims.push({ ...rec, text });
}

/* an angle at V between the rays towards A and B (points in px), the arc at radius r px (the shorter way round); text is the caller's value, e.g. "35,5°" */
export function angleDim(prims, dims, V, A, B, r, text, rec) {
  const a0 = Math.atan2(A[1] - V[1], A[0] - V[0]);
  let da = Math.atan2(B[1] - V[1], B[0] - V[0]) - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da <= -Math.PI) da += 2 * Math.PI;
  const dir = ang => [Math.cos(ang), Math.sin(ang)];
  for (const ang of [a0, a0 + da]) Ln(prims, add(V, mul(dir(ang), 4)), add(V, mul(dir(ang), r + 6)), DIMC, 1);
  const n = Math.max(6, Math.ceil(Math.abs(da) / (Math.PI / 24))), pt = i => add(V, mul(dir(a0 + da * i / n), r));
  for (let i = 0; i < n; i++) Ln(prims, pt(i), pt(i + 1), DIMC, 1.2);
  for (const i of [0, n]) arrow(prims, pt(i), unit(sub(pt(i), pt(i ? n - 1 : 1))), DIMC, 7);   // each end points away along the arc
  const mid = a0 + da / 2, q = add(V, mul(dir(mid), r + 14));
  T(prims, [q[0], q[1] + 4], text, { size: 1.6, col: DIMC, anchor: "m", bg: TEXT_BG });
  dims.push({ ...rec, text });
}

/* a radius: from the centre C out to the circle (radius rpx) in the screen direction ang (radians), arrow on the circle, a cross at the centre, text beside the line */
export function radiusDim(prims, dims, C, rpx, ang, text, rec) {
  const d = [Math.cos(ang), Math.sin(ang)], tip = add(C, mul(d, rpx));
  Ln(prims, C, tip, DIMC, 1.2); arrow(prims, tip, d, DIMC, 9);
  Ln(prims, add(C, [-4, 0]), add(C, [4, 0]), DIMC, 1); Ln(prims, add(C, [0, -4]), add(C, [0, 4]), DIMC, 1);
  const m = add(C, mul(d, rpx * 0.55)), left = d[0] < 0;
  T(prims, [m[0] + (left ? -6 : 6), m[1] - 6], text, { size: 1.6, col: DIMC, anchor: left ? "r" : "l", bg: TEXT_BG });
  dims.push({ ...rec, text });
}

/* a diameter: a line through the centre C across the circle (radius rpx) in direction ang, arrows at both ends, text above the middle */
export function diameterDim(prims, dims, C, rpx, ang, text, rec) {
  const d = [Math.cos(ang), Math.sin(ang)], a = sub(C, mul(d, rpx)), b = add(C, mul(d, rpx));
  Ln(prims, a, b, DIMC, 1.2); arrow(prims, a, mul(d, -1), DIMC, 9); arrow(prims, b, d, DIMC, 9);
  T(prims, [C[0], C[1] - 6], text, { size: 1.6, col: DIMC, anchor: "m", bg: TEXT_BG });
  dims.push({ ...rec, text });
}

/* a leader note: a line from the thing pointed at (tip, a dot) to `at`, a shelf under the text, the text on the shelf; the text runs away from the tip */
export function leaderNote(prims, tip, at, text, o = {}) {
  const col = o.col || INK, size = o.size || 1.6, right = at[0] >= tip[0], w = textW(text, size) + 8, end = [at[0] + (right ? w : -w), at[1]];
  Ln(prims, tip, at, col, 1); Ln(prims, at, end, col, 1);
  Pg(prims, circlePts(tip, 2.2, 8), col, col, 1);
  T(prims, [at[0] + (right ? 4 : -4), at[1] - 4], text, { size, col, anchor: right ? "l" : "r" });
  return { tip, at, end, text };
}

export function northArrow(prims, x, y, ang = 0) {   // ang: the screen angle of north, radians clockwise from up
  const rot = ([u, v]) => [x + u * Math.cos(ang) - v * Math.sin(ang), y + u * Math.sin(ang) + v * Math.cos(ang)];
  Pg(prims, [rot([0, -26]), rot([11, 16]), rot([0, 8]), rot([-11, 16])], INK, INK, 1);
  T(prims, rot([0, -32]), "N", { size: 2, anchor: "m" });
}
export function scaleBar(prims, x, y, p, W) {
  const m = [5, 10, 20, 50, 100].find(v => v * p >= 90) || 100, L = m * p;
  for (let i = 0; i < 4; i++) Pg(prims, [[x + i * L / 4, y], [x + (i + 1) * L / 4, y], [x + (i + 1) * L / 4, y + 6], [x + i * L / 4, y + 6]], i % 2 ? [255, 255, 255] : INK, INK, 1);
  T(prims, [x, y - 4], "0", { size: 1.6 }); T(prims, [x + L, y - 4], `${m} m`, { size: 1.6, anchor: "m" });
}
export const frameBox = (prims, W, H) => Pg(prims, [[1, 1], [W - 1, 1], [W - 1, H - 1], [1, H - 1]], null, GREY, 1.5);

/* the title block, bottom right: the title on top, under it four cells: scale, date, drawn by, sheet n/m. sheet: [n, m]. Returns its box. */
export function titleBlock(prims, W, H, { title, scale, date, drawnBy, sheet }) {
  const w = 410, h = 64, x0 = W - 8 - w, y0 = H - 8 - h, cells = [["MÅLESTOKK", scale, 80], ["DATO", date, 110], ["TEGNET AV", drawnBy, 150], ["ARK", sheet ? `${sheet[0]}/${sheet[1]}` : "", 70]];
  Pg(prims, [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]], [255, 255, 255], INK, 1.5);
  Ln(prims, [x0, y0 + 28], [x0 + w, y0 + 28], INK, 1);
  T(prims, [x0 + 8, y0 + 20], title, { size: 2 });
  let cx = x0;
  for (const [i, [label, value, cw]] of cells.entries()) {
    if (i) Ln(prims, [cx, y0 + 28], [cx, y0 + h], INK, 1);
    T(prims, [cx + 5, y0 + 40], label, { size: 1.2, col: GREY }); T(prims, [cx + 5, y0 + 57], String(value ?? ""), { size: 1.6 }); cx += cw;
  }
  return { x: x0, y: y0, w, h };
}

/* ----- SVG ----- */
const n2 = v => String(Math.round(v * 100) / 100 + 0), rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function toSVG(sheet) {
  const { prims, W, H } = sheet, out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"${sheet.title ? ` aria-label="${esc(sheet.title)}"` : ""}>`, `<rect width="${W}" height="${H}" fill="#fff"/>`];
  const pts = a => a.map(q => `${n2(q[0])},${n2(q[1])}`).join(" ");
  for (const q of prims) {
    if (q.t === "poly") out.push(`<polygon points="${pts(q.pts)}" fill="${q.fill ? rgb(q.fill) : "none"}"${q.stroke ? ` stroke="${rgb(q.stroke)}" stroke-width="${n2(q.w || 1)}" stroke-linejoin="round"` : ""}/>`);
    else if (q.t === "line") out.push(`<line x1="${n2(q.a[0])}" y1="${n2(q.a[1])}" x2="${n2(q.b[0])}" y2="${n2(q.b[1])}" stroke="${rgb(q.col || [0, 0, 0])}" stroke-width="${n2(q.w || 1)}"${q.dash ? ` stroke-dasharray="${q.dash.join(" ")}"` : ""}/>`);
    else if (q.t === "text") {
      const size = q.size || 2, tw = textW(q.s, size), x0 = q.anchor === "m" ? -tw / 2 : q.anchor === "r" ? -tw : 0, th = 9 * size, g = `translate(${n2(q.p[0])} ${n2(q.p[1])})${q.rot ? ` rotate(${q.rot})` : ""}`;
      out.push(`<g transform="${g}">${q.bg ? `<rect x="${n2(x0 - size)}" y="${n2(-th * 0.85)}" width="${n2(tw + 2 * size)}" height="${n2(th * 1.1)}" fill="#fff"/>` : ""}<text x="${n2(x0)}" y="0" font-family="monospace" font-size="${n2(size * 10)}" fill="${rgb(q.col || INK)}">${esc(q.s)}</text></g>`);
    }
  }
  out.push("</svg>");
  return out.join("\n");
}
