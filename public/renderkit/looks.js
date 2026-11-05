// renderkit looks (U3453 slice 2, Morten 2026-10-24 19:26Z «full pbr texturing», 21:52Z «the best version of everything»):
// the HDR environment, and a material's look as a PBR set: walnut plywood (Poly Haven black_walnut_veneer_02: colour,
// OpenGL normal, and AO, roughness and metalness packed as ARM; the figure along each part's grain, the ply layers charred
// on a laser-cut edge) and opal acrylic (physical: transmission, IOR 1.49, a clear coat; its laser-cut edge frosted).
// The sheet UVs are at true scale: one picture covers `tile` mm. Every picture is CC0 (docs/credits.txt). The printed plastics
// (PLA, PETG, TPU) are filaments.js's: physical, with a layer-line normal drawn here; their UVs are printUV's, in layers.
import * as T from '../vendor/three.module.js'
import { HDRLoader } from './hdr-loader.js'
import { FILAMENTS, layerNormals, printUV } from './filaments.js'
import { loadLooks, hexNum } from './looklib.js'
export { FILAMENTS, printUV }

export const HDRI = 'studio_small_09_1k.hdr'                   // Poly Haven «Studio Small 09», CC0; photo_studio_01_1k.hdr is the other
export const LOOKS = {
  walnut: {
    set: 'black_walnut_veneer_02', tile: 1000, tint: 0x8f7462,  // the veneer as oiled walnut plywood reads: darker and warmer
    // a 3 mm ply's layers across the cut edge (0 one face, 1 the other), charred by the laser: face veneers, glue lines, core
    ply: [[0, 0.1, 0x3a2416], [0.1, 0.13, 0x1e120a], [0.13, 0.87, 0x4a3221], [0.87, 0.9, 0x1e120a], [0.9, 1, 0x3a2416]], edgeRoughness: 0.92,
  },
  opal: {
    physical: { color: 0xf3f2ee, roughness: 0.38, metalness: 0, transmission: 0.32, thickness: 3, ior: 1.49, clearcoat: 1, clearcoatRoughness: 0.04,
      attenuationColor: 0xf6f3ea, attenuationDistance: 4 },
    edge: { roughness: 0.75, clearcoat: 0 },                   // a laser-cut acrylic edge is frosted
  },
  ...FILAMENTS,
}
// the picture size for a quality tier (quality.js): 2K on a desktop, 1K on a touch device or a card
export const sizeFor = tier => tier === 'high' ? '2k' : '1k'
// U3996: the sizes of a set that also has KTX2 (Basis Universal) copies, `<set>_<name>_<size>.ktx2` next to the JPEGs (tools/make-ktx2.mjs):
// about a quarter of the JPEG bytes, and the GPU keeps them compressed. Needs a renderer to tell which format it can transcode to.
export const KTX2_SIZES = { black_walnut_veneer_02: ['1k', '2k'] }

const memo = new Map(), once = (k, f) => { if (!memo.has(k)) memo.set(k, f().catch(e => { memo.delete(k); throw e })); return memo.get(k) }
export function picture(url, colour, ktx2) {                  // a picture once per page, repeating (materials-three.js too); ktx2: a KTX2Loader for a .ktx2 url
  return once((ktx2 ? 'ktx2:' : '') + url, () => (ktx2 ? ktx2.loadAsync(url) : new T.TextureLoader().loadAsync(url)).then(t => {
    t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = colour ? T.SRGBColorSpace : T.NoColorSpace; t.anisotropy = 8; return t }))
}
// the KTX2 loader for a renderer (once per renderer): the basis transcoder is served by the app at `path` (basis_transcoder.js and .wasm, no CDN)
const loaders = new WeakMap()
export async function ktx2For(r, path) {
  let l = loaders.get(r)
  if (!l) {
    const { KTX2Loader } = await import('./ktx2-loader.js'), k = new KTX2Loader().setTranscoderPath(path).detectSupport(r)
    if (!Object.values(k.workerConfig).some(Boolean)) { k.dispose(); throw new Error('this GPU takes no compressed texture format') }   // no transcoder download for nothing: the JPEGs
    loaders.set(r, l = k)
  }
  return l
}
function plyPicture(layers) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256
  const x = c.getContext('2d')
  for (const [a, b, col] of layers) { x.fillStyle = new T.Color(col).getStyle(); x.fillRect(0, Math.round(a * 256), 4, Math.ceil((b - a) * 256)) }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.wrapS = T.RepeatWrapping; return t
}
function layerPicture(tilt) {                                    // one layer's normal, repeated up the part (mipmaps flatten it far off)
  const rows = 32, t = new T.DataTexture(layerNormals(tilt, rows, 4), 4, rows, T.RGBAFormat)
  t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.NoColorSpace; t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter
  t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t
}

// U4459: generated detail normals for the metal and coating looks (maps.detail is one of DETAILS). A size x size tile of unit vectors
// (Float32Array, x y z per texel, tangent space, z up), seeded so a look is the same on every device. Heights are sums of sines at whole
// wave counts (so the tile repeats), gradients are taken analytically; bead-blast is random round dents (wrapped at the edges).
// brushed-linear: scratches along v (wave counts across u only, 1/3 of them wobble slowly along v); brushed-circular: the same in the
// radius from the tile's centre (a disc: for a round face, the tile's corners are not seamless); orange-peel: soft two-way swell;
// fine-noise (U4464, MDF): seeded random heights, one texel apart, softened by a 3x3 average, wrapped.
export const DETAILS = ['brushed-linear', 'brushed-circular', 'bead-blast', 'orange-peel', 'fine-noise']
const rng = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const SLOPE = { 'brushed-linear': 0.35, 'brushed-circular': 0.35, 'bead-blast': 1, 'orange-peel': 0.12, 'fine-noise': 0.18 }   // the steepest slope drawn, about
export function detailNormal(kind, size = 128) {
  if (!DETAILS.includes(kind)) throw new Error('detailNormal: unknown kind ' + kind)
  const r = rng(DETAILS.indexOf(kind) * 7919 + 17), n = size * size, gx = new Float32Array(n), gy = new Float32Array(n), TAU = Math.PI * 2
  if (kind === 'bead-blast') {                                    // dents: height -(1 - d2/R2)^2 within radius R (px), a few thousand per tile
    const count = Math.round(n / 14)
    for (let i = 0; i < count; i++) {
      const cx = r() * size, cy = r() * size, R = 2 + r() * 2.5, a = 0.5 + r() * 0.5, R2 = R * R
      for (let dy = -Math.ceil(R); dy <= Math.ceil(R); dy++) for (let dx = -Math.ceil(R); dx <= Math.ceil(R); dx++) {
        const px = Math.floor(cx) + dx, py = Math.floor(cy) + dy, ex = px + 0.5 - cx, ey = py + 0.5 - cy, d2 = ex * ex + ey * ey
        if (d2 >= R2) continue
        const k = 4 * a * (1 - d2 / R2) / R2, j = (((py % size) + size) % size) * size + (((px % size) + size) % size)   // d/dx of -a(1-d2/R2)^2
        gx[j] += k * ex; gy[j] += k * ey
      }
    }
  } else if (kind === 'fine-noise') {
    const h = new Float32Array(n), at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)]
    for (let i = 0; i < n; i++) h[i] = r() - 0.5
    const s = new Float32Array(n)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { let a = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) a += at(x + i, y + j); s[y * size + x] = a / 9 }
    const sat = (x, y) => s[((y + size) % size) * size + ((x + size) % size)]
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { gx[y * size + x] = (sat(x + 1, y) - sat(x - 1, y)) / 2; gy[y * size + x] = (sat(x, y + 1) - sat(x, y - 1)) / 2 }
  } else {
    const waves = [], count = kind === 'orange-peel' ? 10 : 40
    for (let i = 0; i < count; i++) {
      const lo = kind === 'orange-peel' ? 2 : 12, hi = kind === 'orange-peel' ? 9 : size / 2 - 1
      const ku = Math.round(lo + r() * (hi - lo)), kv = kind === 'orange-peel' ? Math.round(lo + r() * (hi - lo)) : (i % 3 === 0 ? 1 + Math.floor(r() * 2) : 0)
      waves.push({ ku: r() < 0.5 || kind !== 'orange-peel' ? ku : -ku, kv, ph: r() * TAU, a: (0.4 + r()) / (kind === 'orange-peel' ? 1 : 1 + ku / 8) })
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let dx = 0, dy = 0
      if (kind === 'brushed-circular') {                          // height is a function of the radius: the gradient is radial
        const ex = (x + 0.5 - size / 2) / size, ey = (y + 0.5 - size / 2) / size, rad = Math.hypot(ex, ey) || 1e-6
        let dh = 0; for (const w of waves) dh += -w.a * w.ku * TAU * Math.sin(TAU * w.ku * rad * 2 + w.ph) * 2     // radius in half-tiles: wave counts up to size/2 over the radius
        dx = dh * ex / rad / size; dy = dh * ey / rad / size
      } else for (const w of waves) {
        const t = TAU * (w.ku * (x + 0.5) + w.kv * (y + 0.5)) / size + w.ph, c = -w.a * Math.sin(t) * TAU / size
        dx += c * w.ku; dy += c * w.kv
      }
      gx[y * size + x] = dx; gy[y * size + x] = dy
    }
  }
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.hypot(gx[i], gy[i]))
  const sc = peak > 0 ? SLOPE[kind] / peak : 0, out = new Float32Array(n * 3)      // the steepest texel leans SLOPE (rise over run)
  for (let i = 0; i < n; i++) {
    const nx = -gx[i] * sc, ny = -gy[i] * sc, l = Math.hypot(nx, ny, 1)
    out[i * 3] = nx / l; out[i * 3 + 1] = ny / l; out[i * 3 + 2] = 1 / l
  }
  return out
}
// the detail normal as RGBA bytes (a normal map: 0.5 + 0.5 v)
export function detailPixels(kind, size = 128) {
  const v = detailNormal(kind, size), px = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) px.set([v[i * 3], v[i * 3 + 1], v[i * 3 + 2]].map(c => Math.round((c * 0.5 + 0.5) * 255)).concat(255), i * 4)
  return px
}
function detailPicture(kind) {
  const size = 128, t = new T.DataTexture(detailPixels(kind, size), size, size, T.RGBAFormat)
  t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.NoColorSpace; t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter
  t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t
}

// the library record's physical settings as three's MeshPhysicalMaterial parameters; only what the record sets (null: three's default)
const LAYER_PARAMS = [['clearcoat', 'clearcoat'], ['clearcoatRoughness', 'clearcoatRoughness'], ['anisotropy', 'anisotropy'], ['anisotropyRotation', 'anisotropyRotation'],
  ['iridescence', 'iridescence'], ['iridescenceIOR', 'iridescenceIOR'], ['sheen', 'sheen'], ['sheenRoughness', 'sheenRoughness'], ['sheenColour', 'sheenColor', hexNum],
  ['transmission', 'transmission'], ['thickness_mm', 'thickness'], ['attenuationColour', 'attenuationColor', hexNum], ['attenuation_mm', 'attenuationDistance']]
function physical(rec, tint) {
  const b = rec.base, p = { color: hexNum(tint || b.colour), roughness: b.roughness, metalness: b.metalness }
  if (b.ior != null) p.ior = b.ior
  if (b.specularColour != null) p.specularColor = hexNum(b.specularColour)
  for (const [k, to, f] of LAYER_PARAMS) if (rec.layers?.[k] != null) p[to] = f ? f(rec.layers[k]) : rec.layers[k]
  if (rec.layers?.iridescenceNm != null) p.iridescenceThicknessRange = [100, rec.layers.iridescenceNm]
  return p
}
function plyFlat(ply) { const w = ply.reduce((m, l) => l[1] - l[0] > m[1] - m[0] ? l : m); return hexNum(w[2]) }   // the widest layer, for a cut edge with no picture

// the face and the cut edge's materials for look id, or null when the library has no record for it (the app keeps its own colour).
// o: {url(name): where a picture is served (and looklib.json, unless looks is given), looks: the library (loadLooks) | an {id: record} object,
//     size: '1k' | '2k', tier: 'low' draws parameters only (no pictures, no layer lines), tint: a colour ('#rrggbb' or a number) for a look
//     that takes one (a spool's), extra: material settings both take (polygon offset, a sheet's thickness),
//     ktx2: {renderer, path} (U3996): take the set's .ktx2 copies when it has them at this size, the JPEGs when the device cannot transcode}
// -> {face, edge, uv: 'sheet' | 'print' | 'box' | 'none', tile_mm, layer_mm}: uv 'sheet': UVs by sheetUV at tile_mm; 'box': a generated detail, one picture per tile_mm; 'print': printUV at layer_mm.
// A picture that fails to load leaves the flat colour from the record.
export async function materialFor(id, { url, looks = null, size = '1k', tier = null, tint = null, extra = {}, ktx2 = null } = {}) {
  looks = looks || await loadLooks(url('looklib.json'))
  const rec = looks[id]
  if (!rec) return null
  const m = rec.maps, uv = rec.uv || 'none', low = tier === 'low'
  const flat = () => ({ face: new T.MeshPhysicalMaterial({ ...physical(rec, tint), ...extra }) })
  let R = null
  if (m?.set && !low && m.px?.includes(size)) {
    try {
      const p = (n, ext) => url(`${m.set}_${n}_${size}.${ext}`)
      let ktx = null
      if (ktx2 && m.fmt?.includes('ktx2')) try { ktx = await ktx2For(ktx2.renderer, ktx2.path) } catch { ktx = null }
      const get = async (n, colour) => {
        // a transcoder that never answers (a blocked worker, a wasm that will not compile) must not hold the look: 6 s, then the JPEG
        if (ktx) try { return await Promise.race([picture(p(n, 'ktx2'), colour, ktx), new Promise((_, no) => setTimeout(() => no(new Error('ktx2 timeout')), 6000))]) } catch { /* no transcoder here: the JPEG, the low level */ }
        return picture(p(n, 'jpg'), colour)
      }
      const [map, normalMap, arm] = await Promise.all([get('diff', true), get('nor_gl'), get('arm')])
      R = { face: new T.MeshStandardMaterial({ map, normalMap, aoMap: arm, roughnessMap: arm, metalnessMap: arm, roughness: 1, metalness: 1, color: hexNum(tint || m.tint || rec.base.colour), ...extra }) }
      if (rec.edge?.ply) R.edge = new T.MeshStandardMaterial({ map: plyPicture(rec.edge.ply.map(([a, b, c]) => [a, b, hexNum(c)])), roughness: rec.edge.roughness, metalness: 0, ...extra })
    } catch { R = null }                                         // no picture: the flat colour
  } else if (m?.detail && !low) {                                // drawn here, no cut edge, one material for both groups: a print's layer lines, or a generated detail
    const normalMap = typeof m.detail === 'string' ? detailPicture(m.detail) : layerPicture(m.detail.tilt)
    R = { face: new T.MeshPhysicalMaterial({ ...physical(rec, tint), normalMap, ...extra }) }
  }
  R ||= flat()
  if (!R.edge) {
    if (m?.detail) R.edge = R.face
    else if (rec.edge) {
      const { ply, ...e } = rec.edge
      R.edge = new T.MeshPhysicalMaterial({ ...physical(rec, tint), ...(ply ? { color: plyFlat(ply) } : {}), ...e, ...extra })
    } else R.edge = R.face
  }
  return { face: R.face, edge: R.edge, uv, tile_mm: uv === 'sheet' || uv === 'box' ? m?.size_mm || 0 : 0, layer_mm: uv === 'print' ? m?.detail?.layer_mm || 0 : 0 }
}
// the earlier name and shape: {tile, face, edge}, and layer (mm) for a filament; tile > 0: UVs by sheetUV at that scale
export async function lookMaterials(id, o) {
  const r = await materialFor(id, o)
  return r && { tile: r.tile_mm, ...(r.layer_mm ? { layer: r.layer_mm } : {}), face: r.face, edge: r.edge }
}

// the HDR picture (once per page), and its environment for a renderer (PMREM, once per renderer)
export const loadHDR = url => once('hdr:' + url, () => new HDRLoader().setDataType(T.HalfFloatType).loadAsync(url).then(t => { t.mapping = T.EquirectangularReflectionMapping; return t }))
const envs = new WeakMap()
export function envFor(r, hdr) {
  let e = envs.get(r)
  if (!e) { const pm = new T.PMREMGenerator(r); e = pm.fromEquirectangular(hdr).texture; pm.dispose(); envs.set(r, e) }
  return e
}

// UVs for sheet parts at true scale. faces: [{t0, t1 (a triangle range), kind: 'cap' | 'edge', plate (a key), grain: [x, y, z] | null}];
// idx: the triangles' vertex indices, or null for a soup (triangle t's corners are 3t..3t+2). A cap's u runs along its plate's
// grain (without one: along the face's longest side), v across, in tiles of `tile` mm, each plate at its own place in the
// picture; a cut edge's v runs across the plate's thickness (0 one face, 1 the other), u along the cut. st (optional, 2 per vertex,
// NaN where unknown): each vertex's place on its flat sheet in mm, along the grain and across it; a cap triangle whose corners all
// have one takes its u, v from there, so on a bent sheet the figure follows the bend (laser flat-unbend: a Book box's spine), and
// the pieces of one sheet meet with no seam (each part's own place on the sheet keeps parts apart in the picture).
export function sheetUV(pos, idx, faces, tile, st = null) {
  const uv = new Float32Array(pos.length / 3 * 2), vi = (t, k) => idx ? idx[t * 3 + k] : t * 3 + k
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), n = new T.Vector3(), q = new T.Vector3()
  const at = (v, o) => o.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])
  const triN = t => { at(vi(t, 0), a); at(vi(t, 1), b); at(vi(t, 2), c); return n.copy(b).sub(a).cross(c.sub(a)) }
  const plates = new Map(), shift = new Map()
  const offset = key => { let o = shift.get(key); if (!o) { let h = 0; for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; shift.set(key, o = { du: (h % 997) / 997, dv: (h % 991) / 991 }) } return o }
  const onSheet = t => st && [0, 1, 2].every(k => Number.isFinite(st[vi(t, k) * 2]))
  for (const f of faces) {
    if (f.kind !== 'cap' || plates.has(f.plate)) continue
    const N = new T.Vector3(); for (let t = f.t0; t < f.t1; t++) N.add(triN(t))
    if (N.lengthSq() < 1e-12) continue
    N.normalize()
    let g = f.grain ? new T.Vector3(...f.grain) : null
    if (g) g.addScaledVector(N, -g.dot(N))
    if (!g || g.lengthSq() < 1e-6) {                               // no grain: along the face's longest side among the three axes
      let best = -1
      for (const ax of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        const d = new T.Vector3(...ax).addScaledVector(N, -N.getComponent(ax.indexOf(1))); if (d.lengthSq() < 1e-6) continue
        d.normalize(); let lo = Infinity, hi = -Infinity
        for (let t = f.t0; t < f.t1; t++) for (let k = 0; k < 3; k++) { const s = at(vi(t, k), q).dot(d); lo = Math.min(lo, s); hi = Math.max(hi, s) }
        if (hi - lo > best) { best = hi - lo; g = d }
      }
    }
    g.normalize()
    plates.set(f.plate, { n: N, g, w: N.clone().cross(g), ...offset(f.plate), lo: Infinity, hi: -Infinity })
  }
  for (const f of faces) {                                         // the plate's thickness, from its edges' corners
    const P = f.kind === 'edge' && plates.get(f.plate); if (!P) continue
    for (let t = f.t0; t < f.t1; t++) for (let k = 0; k < 3; k++) { const s = at(vi(t, k), q).dot(P.n); P.lo = Math.min(P.lo, s); P.hi = Math.max(P.hi, s) }
  }
  const tn = new T.Vector3(), along = new T.Vector3()
  for (const f of faces) {
    const P = plates.get(f.plate)
    for (let t = f.t0; t < f.t1; t++) {
      if (f.kind === 'cap' && onSheet(t)) {                        // on its sheet: the figure runs along the bend
        for (let k = 0; k < 3; k++) { const v = vi(t, k); uv[v * 2] = st[v * 2] / tile; uv[v * 2 + 1] = st[v * 2 + 1] / tile }      // no plate offset: the pieces of one sheet meet
        continue
      }
      if (!P) continue
      if (f.kind === 'edge') { tn.copy(triN(t)).normalize(); along.copy(P.n).cross(tn); if (along.lengthSq() < 1e-6) along.copy(P.g); along.normalize() }
      for (let k = 0; k < 3; k++) {
        const v = vi(t, k); at(v, q)
        if (f.kind === 'cap') { uv[v * 2] = q.dot(P.g) / tile + P.du; uv[v * 2 + 1] = q.dot(P.w) / tile + P.dv }
        else { uv[v * 2] = q.dot(along) / tile; uv[v * 2 + 1] = P.hi > P.lo ? (q.dot(P.n) - P.lo) / (P.hi - P.lo) : 0.5 }
      }
    }
  }
  return uv
}
