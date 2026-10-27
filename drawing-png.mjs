/* T5: the drawing's primitives (public/drawing.js) as a PNG, in Node: no browser, no fonts (a 5 x 7 dot font of its own), the
   picture drawn twice the size and halved for smooth lines. The 3D picture's PNG writer (renderkit look.js) is a vendored
   file that does not export it, so the 12 lines of the PNG container are here (a change there: take it from there).
     prims: { t: "line", a, b, col, w?, dash? } | { t: "poly", pts, fill?, stroke?, w? } | { t: "text", p, s, size?, col?, anchor?, rot?, bg? }
     all in pixels of the final picture; text size = pixels per font cell (2 gives letters 10 x 14 px). */
import { deflateSync } from "node:zlib";
import { glyph, GLYPH_W, ADVANCE } from "./drawing-font.mjs";

const SS = 2;
export function rasterize(prims, W, H) {
  const w = W * SS, h = H * SS, px = new Uint8Array(w * h * 3).fill(255);
  const put = (x, y, c) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const k = (y * w + x) * 3; px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) put(x, y, c); };
  const fill = (pts, c) => {
    const P = pts.map(p => [p[0] * SS, p[1] * SS]), ys = P.map(p => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(h - 1, Math.ceil(Math.max(...ys))); y++) {
      const cy = y + 0.5, xs = [];
      for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; if ((a[1] <= cy) !== (b[1] <= cy)) xs.push(a[0] + (cy - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.max(0, Math.round(xs[i])); x < Math.min(w, Math.round(xs[i + 1])); x++) put(x, y, c);
    }
  };
  const line = (a, b, c, wd = 1, dash = null) => {
    const A = [a[0] * SS, a[1] * SS], B = [b[0] * SS, b[1] * SS], L = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.max(1, Math.ceil(L * 2)), r = Math.max(0.5, wd * SS / 2), cyc = dash ? dash.reduce((s, v) => s + v, 0) * SS : 0;
    for (let s = 0; s <= n; s++) {
      const d = s / 2;
      if (dash) { let m = d % cyc, on = true; for (const [i, v] of dash.entries()) { if (m < v * SS) { on = i % 2 === 0; break; } m -= v * SS; } if (!on) continue; }
      const x = A[0] + (B[0] - A[0]) * s / n, y = A[1] + (B[1] - A[1]) * s / n;
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) if (dx * dx + dy * dy <= r * r + 0.3) put(Math.round(x + dx), Math.round(y + dy), c);
    }
  };
  const text = (p, s, size = 2, c = [20, 20, 20], anchor = "l", rot = 0, bg = false) => {
    const cell = size * SS, adv = ADVANCE * cell, tw = String(s).length * adv - cell, th = 9 * cell;
    const x0 = anchor === "m" ? -tw / 2 : anchor === "r" ? -tw : 0, X = p[0] * SS, Y = p[1] * SS;
    const at = (u, v) => rot ? [X + v, Y - u] : [X + u, Y + v];   // rot -90: the text reads upward
    if (bg) { const q = [at(x0 - cell, -th * 0.85), at(x0 + tw + cell, -th * 0.85), at(x0 + tw + cell, th * 0.25), at(x0 - cell, th * 0.25)];
      rect(Math.min(...q.map(t => t[0])), Math.min(...q.map(t => t[1])), Math.max(...q.map(t => t[0])), Math.max(...q.map(t => t[1])), [255, 255, 255]); }
    [...String(s)].forEach((ch, i) => { const g = glyph(ch), off = g.length - 7;
      g.forEach((row, r) => { for (let k = 0; k < GLYPH_W; k++) if (row[k] === "#") {
        const u = x0 + i * adv + k * cell, v = -7 * cell + (r - off) * cell, [a, b] = at(u, v), [a2, b2] = at(u + cell, v + cell);
        rect(Math.min(a, a2), Math.min(b, b2), Math.max(a, a2), Math.max(b, b2), c); } }); });
  };
  for (const q of prims) {
    if (q.t === "poly") { if (q.fill) fill(q.pts, q.fill); if (q.stroke) for (let i = 0; i < q.pts.length; i++) line(q.pts[i], q.pts[(i + 1) % q.pts.length], q.stroke, q.w || 1); }
    else if (q.t === "line") line(q.a, q.b, q.col || [0, 0, 0], q.w || 1, q.dash);
    else if (q.t === "text") text(q.p, q.s, q.size || 2, q.col, q.anchor || "l", q.rot || 0, q.bg);
  }
  const out = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { out[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) { const i = (y * SS * w + x * SS) * 3 + c; out[y * (W * 3 + 1) + 1 + x * 3 + c] = (px[i] + px[i + 3] + px[i + w * 3] + px[i + w * 3 + 3]) >> 2; } }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(out, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}
