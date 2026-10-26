/* three's materials for materials.js's entries (U3618): the flat colour and its look at once, and the ambientCG picture set
   (colour, OpenGL normal, roughness; CC0, 512 px) when it has come. Pictures are fetched once per page (looks.js picture).
     flatMaterial(key, extra)                  MeshStandardMaterial: the colour and the entry's look; an unknown key: concrete
     texturedMaterial(key, {url, extra})       a promise of {material, tile}: tile [m, m] one picture covers, null with no set;
                                               url(name): where a file is served (e.g. n => `renderkit/${n}`)
     worldUV(geometry, tile, a, b)             UVs from the vertices' own coordinates a, b ("x", "y" or "z") in metres, so the
                                               picture is at true scale whatever the shape (a surface, a path, a wall's face)
     hatchUrl(key, url)                        the plan and section hatch picture's address (an SVG)
   A low quality tier keeps the flat material (quality.js; the app decides). */
import * as T from '../vendor/three.module.js'
import { picture } from './looks.js'
import { MATERIALS } from './materials.js'

const entry = key => MATERIALS[key] || MATERIALS.concrete

export function flatMaterial(key, extra = {}) {
  const m = entry(key)
  return new T.MeshStandardMaterial({ color: m.colour, ...m.look, ...extra })
}

export async function texturedMaterial(key, { url, extra = {} } = {}) {
  const m = entry(key)
  if (!m.texture) return { material: flatMaterial(key, extra), tile: null }
  const p = n => url(`${m.texture.set}_${n}.jpg`)
  const [map, normalMap, roughnessMap] = await Promise.all([picture(p('Color'), true), picture(p('NormalGL')), picture(p('Roughness'))])
  return { material: new T.MeshStandardMaterial({ map, normalMap, roughnessMap, roughness: 1, metalness: 0, ...extra }), tile: m.texture.tile }
}

export function worldUV(geometry, tile, a = 'x', b = 'z') {
  const pos = geometry.attributes.position, uv = new Float32Array(pos.count * 2), [tu, tv] = tile || [1, 1]
  for (let i = 0; i < pos.count; i++) { uv[2 * i] = pos['get' + a.toUpperCase()](i) / tu; uv[2 * i + 1] = pos['get' + b.toUpperCase()](i) / tv }
  geometry.setAttribute('uv', new T.BufferAttribute(uv, 2))
  return geometry
}

export const hatchUrl = (key, url) => url(`hatch-${entry(key).hatch}.svg`)
