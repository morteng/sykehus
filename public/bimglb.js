/* The wings the page draws from their BIM model (U3656): wing id -> the GLB tools/glb.py wrote from the same model as the IFC
   (tools/ifc.py ENVELOPE names the same wings; tests/bimglb.test.mjs holds the two together). And the small reader of that GLB:
   per material, float32 positions (x east, y up as kote, z -north) and uint32 indices. Not a general glTF loader. */
export const BIM = { sentralblokka: "data/hoyblokka.glb" };

export function readGlb(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) throw new Error("not a GLB 2");
  let json = null, bin = null;
  for (let o = 12; o + 8 <= buf.byteLength;) {
    const n = dv.getUint32(o, true), t = dv.getUint32(o + 4, true), s = o + 8;
    if (t === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, s, n))); else if (t === 0x004e4942) bin = buf.slice(s, s + n);
    o = s + n;
  }
  if (!json || !bin) throw new Error("a GLB without JSON or BIN");
  const take = (i, Type) => { const a = json.accessors[i], v = json.bufferViews[a.bufferView], c = a.type === "VEC3" ? 3 : 1; return new Type(bin, (v.byteOffset || 0) + (a.byteOffset || 0), a.count * c); };
  return json.meshes.flatMap(m => m.primitives).map(p => ({ material: json.materials[p.material]?.name, positions: take(p.attributes.POSITION, Float32Array), indices: take(p.indices, Uint32Array) }));
}
