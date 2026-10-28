/* The wings the page draws from their BIM model (U3656): wing id -> the GLB tools/glb.py wrote from the same model as the IFC
   (tools/ifc.py ENVELOPE names the same wings; tests/bimglb.test.mjs holds the two together). And the small reader of that GLB:
   per material, float32 positions (x east, y up as kote, z -north; stored as int16 on one box) and 16- or 32-bit indices. Not a general glTF loader. */
export const BIM = { sentralblokka: "data/hoyblokka.glb" };
/* the wing's built-in balconies, a file of their own: a person's balconies edit on that wall replaces them (design.js replacesBuiltIn), and the page leaves this file out */
export const BIM_EXTRA = { sentralblokka: "data/hoyblokka-balkonger.glb" };

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
  const node = json.nodes[0], S = node.scale || [1, 1, 1], Tr = node.translation || [0, 0, 0];
  const view = i => { const a = json.accessors[i], v = json.bufferViews[a.bufferView]; return { a, v, at: (v.byteOffset || 0) + (a.byteOffset || 0) }; };
  const positions = i => {   // int16 x3 in 8-byte vertices, put back by the node's scale and translation
    const { a, v, at } = view(i), out = new Float32Array(a.count * 3), d = new DataView(bin), stride = v.byteStride || 6;
    for (let k = 0; k < a.count; k++) for (let c = 0; c < 3; c++) out[k * 3 + c] = d.getInt16(at + k * stride + c * 2, true) * S[c] + Tr[c];
    return out;
  };
  const indices = i => { const { a, at } = view(i); return a.componentType === 5125 ? new Uint32Array(bin, at, a.count) : new Uint16Array(bin, at, a.count); };
  const mesh = json.meshes[0], prims = mesh.primitives.map(p => ({ material: json.materials[p.material]?.name, positions: positions(p.attributes.POSITION), indices: indices(p.indices) }));
  return Object.assign(prims, { windows: mesh.extras?.windows ?? null });
}
