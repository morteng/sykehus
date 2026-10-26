// renderkit looks (U3453 slice 2, Morten 2026-10-24 19:26Z «full pbr texturing», 21:52Z «the best version of everything»):
// the HDR environment, and a material's look as a PBR set: walnut plywood (Poly Haven black_walnut_veneer_02: colour,
// OpenGL normal, and AO, roughness and metalness packed as ARM; the figure along each part's grain, the ply layers charred
// on a laser-cut edge) and opal acrylic (physical: transmission, IOR 1.49, a clear coat; its laser-cut edge frosted).
// The sheet UVs are at true scale: one picture covers `tile` mm. Every picture is CC0 (docs/credits.txt). The printed plastics
// (PLA, PETG, TPU) are filaments.js's: physical, with a layer-line normal drawn here; their UVs are printUV's, in layers.
import * as T from '../vendor/three.module.js'
import { HDRLoader } from './hdr-loader.js'
import { FILAMENTS, layerNormals, printUV } from './filaments.js'
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

const memo = new Map(), once = (k, f) => { if (!memo.has(k)) memo.set(k, f().catch(e => { memo.delete(k); throw e })); return memo.get(k) }
export function picture(url, colour) {                       // a picture once per page, repeating (materials-three.js too)
  return once(url, () => new T.TextureLoader().loadAsync(url).then(t => {
    t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = colour ? T.SRGBColorSpace : T.NoColorSpace; t.anisotropy = 8; return t }))
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

// the face and the cut edge's materials for look id, or null when renderkit has no set for it (the app keeps its own colour).
// o: {url(name): where a picture is served, size: '1k' | '2k', extra: material settings both take (polygon offset)}
// -> {tile, face, edge}: tile > 0: UVs by sheetUV at that scale; a filament also has layer (mm): UVs by printUV at that pitch.
export async function lookMaterials(id, { url, size = '1k', extra = {} } = {}) {
  const L = LOOKS[id]
  if (!L) return null
  if (L.set) {
    const p = n => url(`${L.set}_${n}_${size}.jpg`)
    const [map, normalMap, arm] = await Promise.all([picture(p('diff'), true), picture(p('nor_gl')), picture(p('arm'))])
    return {
      tile: L.tile,
      face: new T.MeshStandardMaterial({ map, normalMap, aoMap: arm, roughnessMap: arm, metalnessMap: arm, roughness: 1, metalness: 1, color: L.tint, ...extra }),
      edge: new T.MeshStandardMaterial({ map: plyPicture(L.ply), roughness: L.edgeRoughness, metalness: 0, ...extra }),
    }
  }
  if (L.layer) {                                                 // printed: no cut edge, one material for both groups
    const face = new T.MeshPhysicalMaterial({ ...L.physical, normalMap: layerPicture(L.layer.tilt), ...extra })
    return { tile: 0, layer: L.layer.mm, face, edge: face }
  }
  return { tile: 0, face: new T.MeshPhysicalMaterial({ ...L.physical, ...extra }), edge: new T.MeshPhysicalMaterial({ ...L.physical, ...L.edge, ...extra }) }
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
