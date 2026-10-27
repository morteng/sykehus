/* A baseline JPEG from RGB pixels, for the forslag thumbnails (thumbs.mjs). The server has no image library and the kit's
   picture is a PNG: a 480x300 massing drawing is 25 KB as JPEG against 60 KB+ as PNG. Standard luminance tables for all
   three components (every decoder accepts that), 4:4:4, no subsampling. px is W*H*3 bytes. */
const ZZ = [0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63];
const QL = [16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99];
const DC_BITS = [0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0], DC_VALS = [0,1,2,3,4,5,6,7,8,9,10,11];
const AC_BITS = [0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,0x7d];
const AC_VALS = [1,2,3,0,4,0x11,5,0x12,0x21,0x31,0x41,6,0x13,0x51,0x61,7,0x22,0x71,0x14,0x32,0x81,0x91,0xa1,8,0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,0x24,0x33,0x62,0x72,0x82,9,0xa,0x16,0x17,0x18,0x19,0x1a,0x25,0x26,0x27,0x28,0x29,0x2a,
  ...[4,5,6,7,8,9,0xa].map(n => 0x30 + n), ...[3,4,5,6,7,8,9,0xa].map(n => 0x40 + n), ...[3,4,5,6,7,8,9,0xa].map(n => 0x50 + n), ...[3,4,5,6,7,8,9,0xa].map(n => 0x60 + n), ...[3,4,5,6,7,8,9,0xa].map(n => 0x70 + n),
  ...[3,4,5,6,7,8,9,0xa].map(n => 0x80 + n), ...[2,3,4,5,6,7,8,9,0xa].map(n => 0x90 + n), ...[2,3,4,5,6,7,8,9,0xa].map(n => 0xa0 + n), ...[2,3,4,5,6,7,8,9,0xa].map(n => 0xb0 + n), ...[2,3,4,5,6,7,8,9,0xa].map(n => 0xc0 + n),
  ...[2,3,4,5,6,7,8,9,0xa].map(n => 0xd0 + n), ...[1,2,3,4,5,6,7,8,9,0xa].map(n => 0xe0 + n), ...[1,2,3,4,5,6,7,8,9,0xa].map(n => 0xf0 + n)];
if (AC_VALS.length !== 162) throw new Error("jpeg: AC table is not 162 long");
const codes = (bits, vals) => { const t = new Map(); let code = 0, k = 0; for (let len = 1; len <= 16; len++) { for (let i = 0; i < bits[len - 1]; i++) t.set(vals[k++], [code++, len]); code <<= 1; } return t; };
const DC = codes(DC_BITS, DC_VALS), AC = codes(AC_BITS, AC_VALS);
const COS = Array.from({ length: 8 }, (_, u) => Array.from({ length: 8 }, (_, x) => Math.cos((2 * x + 1) * u * Math.PI / 16) * (u ? 1 : Math.SQRT1_2) / 2));

export function encodeJpeg(px, W, H, quality = 80) {
  const sc = quality < 50 ? 5000 / quality : 200 - quality * 2, Q = QL.map(q => Math.min(255, Math.max(1, Math.floor((q * sc + 50) / 100))));
  const out = [], u16 = n => [n >> 8, n & 255];
  const seg = (m, body) => out.push(0xff, m, ...u16(body.length + 2), ...body);
  out.push(0xff, 0xd8);
  seg(0xdb, [0, ...ZZ.map(i => Q[i])]);
  seg(0xc0, [8, ...u16(H), ...u16(W), 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]);
  seg(0xc4, [0x00, ...DC_BITS, ...DC_VALS]); seg(0xc4, [0x10, ...AC_BITS, ...AC_VALS]);
  seg(0xda, [3, 1, 0, 2, 0, 3, 0, 0, 63, 0]);
  let acc = 0, n = 0;
  const bytes = [];
  const put = (code, len) => { for (let i = len - 1; i >= 0; i--) { acc = (acc << 1) | ((code >> i) & 1); if (++n === 8) { bytes.push(acc); if (acc === 255) bytes.push(0); acc = 0; n = 0; } } };
  const bitsOf = v => { const a = Math.abs(v); let s = 0; while (a >> s) s++; return [s, v < 0 ? (v - 1) & ((1 << s) - 1) : v]; };
  const planes = [new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H)];
  for (let i = 0; i < W * H; i++) { const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
    planes[0][i] = 0.299 * r + 0.587 * g + 0.114 * b - 128; planes[1][i] = -0.168736 * r - 0.331264 * g + 0.5 * b; planes[2][i] = 0.5 * r - 0.418688 * g - 0.081312 * b; }
  const pred = [0, 0, 0], blk = new Float32Array(64), tmp = new Float32Array(64), q = new Int32Array(64);
  for (let by = 0; by < H; by += 8) for (let bx = 0; bx < W; bx += 8) for (let c = 0; c < 3; c++) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) blk[y * 8 + x] = planes[c][Math.min(H - 1, by + y) * W + Math.min(W - 1, bx + x)];
    for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += blk[y * 8 + x] * COS[u][x]; tmp[y * 8 + u] = s; }
    for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let s = 0; for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[v][y]; q[v * 8 + u] = Math.round(s / Q[v * 8 + u]); }
    const dc = q[0] - pred[c]; pred[c] = q[0];
    const [s, v] = bitsOf(dc); put(...DC.get(s)); if (s) put(v, s);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const a = q[ZZ[k]]; if (!a) { run++; continue; }
      while (run > 15) { put(...AC.get(0xf0)); run -= 16; }
      const [t, w] = bitsOf(a); put(...AC.get((run << 4) | t)); put(w, t); run = 0;
    }
    if (run) put(...AC.get(0));
  }
  if (n) put(0x7f, 8 - n);
  return Buffer.concat([Buffer.from(out), Buffer.from(bytes), Buffer.from([0xff, 0xd9])]);
}
