// renderkit studio: the renderer set-up, a studio light set (soft room, key, fill, rim), the card light pair, the floor and the
// banana for scale. From laser's studio3d.js and view3d.js (U3120), moved here unchanged in slice 1 (U3453).
import * as T from '../vendor/three.module.js'

// Khronos PBR Neutral tone mapping (a material's colour stays its colour; U3453 slice 2, was ACES) and soft shadows (PCF with
// the key's radius: three r186 dropped PCFSoftShadowMap); the shadow is drawn again only when the caller sets needsUpdate
export function setUp(r) {
  r.toneMapping = T.NeutralToneMapping; r.toneMappingExposure = 1.0; r.shadowMap.enabled = true; r.shadowMap.type = T.PCFShadowMap
  r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true
}

// a studio set-up, as Fusion 360's: a soft room for reflections and fill (an environment map made here, no file), a key light
// that casts the shadows, a fill from the other side and a rim from behind
// U4330: the ONE soft studio room (a grey room with soft boxes, three's RoomEnvironment idea) through PMREM, made once per renderer: the
// editor's view and every still read it (stillrig.js stage)
const rooms = new WeakMap()
export function roomEnv(r) {
  if (rooms.has(r)) return rooms.get(r)
  const pm = new T.PMREMGenerator(r), room = new T.Scene()
  room.add(new T.Mesh(new T.BoxGeometry(10, 10, 10), new T.MeshBasicMaterial({ color: 0x909090, side: T.BackSide })))
  for (const [x, y, z, w, h, k] of [[0, 0, 4.9, 7, 7, 2.6], [-4.9, -2, 1, 3, 5, 1.4], [4.9, 2, 1, 3, 4, 0.9], [0, 4.9, 2, 6, 2, 1.2]]) {
    const p = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(k, k, k), side: T.DoubleSide }))
    p.position.set(x, y, z); p.lookAt(0, 0, 0); room.add(p)
  }
  const tex = pm.fromScene(room, 0.06).texture; pm.dispose(); rooms.set(r, tex)
  return tex
}
export function lights(r, sc, coarse) {
  sc.environment = roomEnv(r); sc.environmentIntensity = 0.8
  const key = new T.DirectionalLight(0xffffff, 1.9), fill = new T.DirectionalLight(0xffffff, 0.45), rim = new T.DirectionalLight(0xffffff, 0.9)
  key.castShadow = true; key.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048); key.shadow.radius = 6; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02
  sc.add(key, key.target, fill, rim)
  // the lights sit round the model: at(az, el, d) is a point d from the model's middle
  return (at, mid, radius) => {
    key.position.copy(at(-35, 55, radius * 4)); key.target.position.copy(mid); fill.position.copy(at(70, 25, radius * 4)); rim.position.copy(at(180, 35, radius * 4))
    Object.assign(key.shadow.camera, { left: -radius * 2.5, right: radius * 2.5, top: radius * 2.5, bottom: -radius * 2.5, near: radius, far: radius * 8 }); key.shadow.camera.updateProjectionMatrix()
  }
}

// a card's light: a sky and ground fill and one sun from the top left, no shadows (laser's card stills)
export function cardLights(sc) {
  sc.add(new T.HemisphereLight(0xffffff, 0x8890a0, 1.9))
  const sun = new T.DirectionalLight(0xffffff, 2.6); sun.position.set(-1.2, -1.4, 2.2); sc.add(sun)
}

// the floor: a disc 12 radii wide under the middle at z, taking the soft shadow; the caller colours floorMaterial()
export const floorMaterial = () => new T.MeshStandardMaterial({ roughness: 0.95, metalness: 0 })
export function floor(sc, mat, mid, radius, z) {
  const f = new T.Mesh(new T.CircleGeometry(radius * 12, 64), mat); f.position.set(mid.x, mid.y, z); f.receiveShadow = true; sc.add(f); return f
}

// «Banana for scale»: a 180 mm arc, 36 mm thick in the middle, thinner to the tips, on its side at x, y on the floor (mm, z up)
export function banana(sc, x, y, floorZ) {
  const L = 180, curve = new T.QuadraticBezierCurve3(new T.Vector3(-L / 2, 0, 0), new T.Vector3(0, -L * 0.28, 0), new T.Vector3(L / 2, 0, 0))
  const g = new T.TubeGeometry(curve, 48, 18, 12, false), p = g.getAttribute('position'), n = 49, ring = 13, c = new T.Vector3()
  for (let i = 0; i < n; i++) { const u = i / (n - 1), k = 0.25 + 0.75 * Math.sin(Math.PI * u) ** 0.6; curve.getPoint(u, c)
    for (let j = 0; j < ring; j++) { const v = i * ring + j; p.setXYZ(v, c.x + (p.getX(v) - c.x) * k, c.y + (p.getY(v) - c.y) * k, c.z + (p.getZ(v) - c.z) * k) } }
  g.computeVertexNormals()
  const m = new T.Mesh(g, new T.MeshStandardMaterial({ color: 0xf2cf45, roughness: 0.6 })); m.castShadow = true
  m.rotation.z = Math.PI / 2; m.position.set(x, y, floorZ + 16); m.visible = false; sc.add(m); return m
}
