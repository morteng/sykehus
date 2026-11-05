// renderkit scenes (U4460): four photometric scene presets for a still: studio-white, studio-dark, workshop, outdoor. Values are in
// real units (lux, kelvin, EV100, degrees); applyScene turns them into three r155+ physical lights, an environment, Khronos PBR
// Neutral tone mapping and an exposure from the EV, so a scene reads like a photograph of that light.
// three is the app's; the HDRIs are served by the app like the look pictures (pass `url(name)`).
import * as T from '../vendor/three.module.js'
import { roomEnv } from './studio.js'
import { loadHDR, envFor } from './looks.js'

// ground: shadow = opacity of the cast shadow (0..1), contact = darkness of the contact blob under the part (0..1),
// reflection = strength of the floor's mirror image (0..1). basis: 'guessed' or 'sourced' (what the numbers rest on).
// hdri: a Poly Haven 1K file in src/ (CC0, docs/credits.txt), or null for studio.js roomEnv. colour_K is the key light's.
export const SCENES = {
  'studio-white': {
    id: 'studio-white', v: 1, en: 'White studio', no: 'Hvitt studio', hdri: null, rotation_deg: 0, ev100: 8, colour_K: 5600, illuminance_lux: 600,
    background: '#f2f2f0', ground: { shadow: 0.35, contact: 0.5, reflection: 0.08 }, tone: 'neutral',
    basis: 'guessed: a lit white sweep as a product photographer meters it (about 500 lux on the subject, EV100 8)',
  },
  'studio-dark': {
    id: 'studio-dark', v: 1, en: 'Dark studio', no: 'Mørkt studio', hdri: 'monochrome_studio_01_1k.hdr', rotation_deg: 0, ev100: 7, colour_K: 5500, illuminance_lux: 300,
    background: '#101112', ground: { shadow: 0.55, contact: 0.6, reflection: 0.18 }, tone: 'neutral',
    basis: 'guessed: lux and EV; sourced: the HDRI is Poly Haven Monochrome Studio 01 (white balance 5500 K), CC0',
  },
  workshop: {
    id: 'workshop', v: 1, en: 'Workshop', no: 'Verksted', hdri: 'carpentry_shop_02_1k.hdr', rotation_deg: 0, ev100: 7, colour_K: 4000, illuminance_lux: 400,
    background: '#3a3835', ground: { shadow: 0.5, contact: 0.5, reflection: 0 }, tone: 'neutral',
    basis: 'sourced: 300-500 lux is the usual bench-work level for a workshop (EN 12464-1 lists 300 to 750), 4000 K from the HDRI; EV100 guessed',
  },
  outdoor: {
    id: 'outdoor', v: 1, en: 'Outdoors', no: 'Utendørs', hdri: 'kloofendal_48d_partly_cloudy_puresky_1k.hdr', rotation_deg: 0, ev100: 14, colour_K: 5800, illuminance_lux: 60000,
    background: '#9fc3e6', ground: { shadow: 0.6, contact: 0.5, reflection: 0 }, tone: 'neutral',
    basis: 'sourced: a partly cloudy day gives 20000 to 80000 lux (direct sun alone about 100000), sunny-16 is EV100 15, cloud a stop or so lower',
  },
}
// key and fill as shares of illuminance_lux, and where they sit (azimuth, elevation in degrees from the model); the HDRI is the rest
export const RIG = { key: { share: 0.7, az: -35, el: 55 }, fill: { share: 0.15, az: 70, el: 25 } }

// three's toneMappingExposure for an EV100: exposure = 1 / (1.2 * 2^EV100) (the saturation-based speed of ISO 12232, 1.2 = 78 / (q * S) with S = 100)
export const exposureFor = ev100 => 1 / (1.2 * 2 ** ev100)
// the camera's EV at ISO 100: log2(N^2 / t) - log2(ISO / 100)
export const evFromCamera = (N, t, iso = 100) => Math.log2(N * N / t) - Math.log2(iso / 100)

// colour temperature (K) -> linear-ish sRGB 0..1 (Tanner Helland's fit, good from 1000 to 40000 K); returns a hex number
export function kelvinHex(K) {
  const t = Math.min(40000, Math.max(1000, K)) / 100, c = x => Math.round(Math.min(255, Math.max(0, x)))
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  return (c(r) << 16) | (c(g) << 8) | c(b)
}

// a soft round blob (alpha white to clear) for the contact darkening under a part
function contactBlob() {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64)
  gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128)
  return new T.CanvasTexture(c)
}
const RAD = Math.PI / 180
const at = (az, el, d, mid) => new T.Vector3(mid.x + d * Math.cos(el * RAD) * Math.sin(az * RAD), mid.y - d * Math.cos(el * RAD) * Math.cos(az * RAD), mid.z + d * Math.sin(el * RAD))

/** Light a scene. preset: a SCENES entry or its id.
 *  o: {url(name) (where the app serves the HDRIs; default the bare name), rotation (deg, replaces rotation_deg), ev (EV100, replaces the preset's),
 *  ground (false: none; or {shadow, contact, reflection} over the preset's), mid {x,y,z}, radius (mm, the part's size), floorZ, hdr (a loaded texture, for tests)}.
 *  Resolves {preset, exposure, key, fill, ground (the group, or null)}; a second call removes the first's lights and ground. */
export async function applyScene(renderer, scene, preset, o = {}) {
  const p = typeof preset === 'string' ? SCENES[preset] : preset
  if (!p) throw new Error('unknown scene: ' + preset)
  const ev = o.ev ?? p.ev100, exposure = exposureFor(ev), mid = o.mid || { x: 0, y: 0, z: 0 }, radius = o.radius || 100
  renderer.toneMapping = T.NeutralToneMapping; renderer.toneMappingExposure = exposure
  const old = scene.userData.sceneRig; if (old) { for (const x of old) { scene.remove(x); x.dispose?.() } }
  // the environment: the HDRI through envFor, else the soft room; its radiance is the unlit share of the illuminance (cd/m2 = lux / pi)
  if (p.hdri) { const hdr = o.hdr || await loadHDR((o.url || (n => n))(p.hdri)); scene.environment = envFor(renderer, hdr) } else scene.environment = roomEnv(renderer)
  const rot = (o.rotation ?? p.rotation_deg) * RAD
  scene.environmentRotation?.set(0, rot, 0); scene.backgroundRotation?.set(0, rot, 0)
  scene.environmentIntensity = p.illuminance_lux * (1 - RIG.key.share - RIG.fill.share) / Math.PI
  scene.background = new T.Color(p.background)
  const col = kelvinHex(p.colour_K), made = []
  const key = new T.DirectionalLight(col, p.illuminance_lux * RIG.key.share), fill = new T.DirectionalLight(col, p.illuminance_lux * RIG.fill.share)
  key.position.copy(at(RIG.key.az, RIG.key.el, radius * 4, mid)); fill.position.copy(at(RIG.fill.az, RIG.fill.el, radius * 4, mid))
  key.target.position.set(mid.x, mid.y, mid.z); fill.target.position.set(mid.x, mid.y, mid.z)
  const g = p.ground && o.ground !== false ? { ...p.ground, ...(o.ground || {}) } : null
  if (g && g.shadow > 0) {
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 6; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02
    Object.assign(key.shadow.camera, { left: -radius * 2.5, right: radius * 2.5, top: radius * 2.5, bottom: -radius * 2.5, near: radius, far: radius * 8 })
    key.shadow.camera.updateProjectionMatrix?.()
  }
  scene.add(key, key.target, fill, fill.target); made.push(key, key.target, fill, fill.target)
  let ground = null
  if (g) {
    ground = new T.Group(); ground.position.set(mid.x, mid.y, o.floorZ ?? mid.z)
    const disc = (m, r, order) => { const x = new T.Mesh(new T.CircleGeometry(r, 64), m); x.receiveShadow = true; x.renderOrder = order; ground.add(x); return x }
    if (g.reflection > 0) disc(new T.MeshStandardMaterial({ color: p.background, roughness: 1 - g.reflection, metalness: 0, envMapIntensity: g.reflection, transparent: true, opacity: 1 }), radius * 12, 0)
    if (g.shadow > 0) disc(new T.ShadowMaterial({ opacity: g.shadow }), radius * 12, 1)
    if (g.contact > 0 && typeof document !== 'undefined') disc(new T.MeshBasicMaterial({ map: contactBlob(), color: 0x000000, transparent: true, opacity: g.contact, depthWrite: false }), radius * 1.2, 2)
    scene.add(ground); made.push(ground)
  }
  scene.userData.sceneRig = made
  renderer.shadowMap.needsUpdate = true
  return { preset: p, exposure, key, fill, ground }
}
