// renderkit filament looks (laser L40 follow-up, plan G7): PLA, PETG and TPU as printed plastic. Each is a physical material
// and a faint layer-line normal: one bead per layer, the lines run along the print direction (around the part) and stack up
// Z at the profile's layer height. Imports nothing (looks.js gives the numbers to three), so a node test reads them.
export const LAYER_MM = 0.2                                     // the Prusa Mini's «0.20mm QUALITY @MINI» print profile

// physical: MeshPhysicalMaterial settings. layer: {mm, tilt}: the layer pitch and the steepest a bead's side turns the normal
// (degrees): a few degrees, so the lines read up close and average out to a plain face further off (mipmaps).
export const FILAMENTS = {
  pla: {                                                        // matte: a dry, even sheen, no clear coat
    physical: { color: 0xd9dcdf, roughness: 0.7, metalness: 0, ior: 1.46, clearcoat: 0 },
    layer: { mm: LAYER_MM, tilt: 9 },
  },
  petg: {                                                       // gloss with slight translucency: light goes a little way in
    physical: { color: 0xe4ecef, roughness: 0.14, metalness: 0, ior: 1.57, transmission: 0.18, thickness: 2,
      attenuationColor: 0xdfe9ec, attenuationDistance: 6, clearcoat: 0.6, clearcoatRoughness: 0.08 },
    layer: { mm: LAYER_MM, tilt: 7 },
  },
  tpu: {                                                        // satin and soft: a rubbery sheen, rounder beads
    physical: { color: 0x3f4347, roughness: 0.5, metalness: 0, ior: 1.5, sheen: 0.6, sheenRoughness: 0.65, sheenColor: 0x7a7f85, clearcoat: 0 },
    layer: { mm: LAYER_MM, tilt: 6 },
  },
}

// one layer's normal map, rows high and w wide, RGBA bytes in tangent space (+v = up the print): a bead h(t) = sin(πt) across
// the layer, its slope scaled so the steepest normal leans `tilt` degrees. Row 0 is the groove between two layers.
export function layerNormals(tilt, rows = 32, w = 4) {
  const px = new Uint8Array(w * rows * 4), k = Math.tan(tilt * Math.PI / 180)
  for (let y = 0; y < rows; y++) {
    const s = k * Math.cos(Math.PI * (y + 0.5) / rows), l = Math.hypot(s, 1)
    const g = Math.round((-s / l * 0.5 + 0.5) * 255), b = Math.round((1 / l * 0.5 + 0.5) * 255)
    for (let x = 0; x < w; x++) px.set([128, g, b, 255], (y * w + x) * 4)
  }
  return px
}

// UVs for a printed part, in layers: v = z / mm, so one picture is one layer; u runs around the part (along x or y, whichever
// lies flatter in the face), at the same scale so the normal's frame is square. A top or bottom face (|nz| > 0.9) takes x and y.
// pos, nor: 3 floats per vertex.
export function printUV(pos, nor, mm = LAYER_MM) {
  const n = pos.length / 3, uv = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], nx = Math.abs(nor[i * 3]), ny = Math.abs(nor[i * 3 + 1]), nz = Math.abs(nor[i * 3 + 2])
    const top = nz > 0.9
    uv[i * 2] = (top || ny > nx ? x : y) / mm
    uv[i * 2 + 1] = (top ? y : z) / mm
  }
  return uv
}
