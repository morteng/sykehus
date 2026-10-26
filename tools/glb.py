"""The high block as a GLB for the 3D page (U3656): the same model as the IFC, one source. tools/ifc.py builds the envelope wings
(walls with their window openings, floor slabs, roof, the windows as glass); this reads the triangles back out of that model
with IfcOpenShell and writes them as one mesh a material (concrete, glass), so the page draws what the IFC holds.

  python -I tools/glb.py <site.json> <out.glb> [wing id ...]      (the wings of public/bimglb.js BIM; about 3 minutes)

The file holds absolute heights in the page's axes (glTF: x east, y up = kote in metres, z = -north), as the IFC has them; the
viewer lifts it by its terrain base. Positions are int16 on one box (KHR_mesh_quantization: the node's scale and translation put
them back; about 2 mm a step on this block), indices uint16, no normals (the page shades it flat). meshes[0].extras.windows is the
model's IfcWindow count, which tests/bimglb.test.mjs holds to the IFC file's. Read by public/bimglb.js (a small reader of this
layout only, not a general glTF loader). Needs IfcOpenShell and numpy."""
import sys, json, struct
import numpy as np
import ifcopenshell, ifcopenshell.geom
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import ifc

GLASS = ("IfcWindow",)
SKIP = ("IfcOpeningElement", "IfcSpace")   # an opening is the hole's own volume: drawn, it would fill the hole it cuts

def triangles(m):
    """{material key: (positions Nx3 float32 in glTF axes, indices uint32)} from the model's own geometry, openings cut"""
    s = ifcopenshell.geom.settings(); s.set("use-world-coords", True)
    it = ifcopenshell.geom.iterator(s, m, 4)
    parts = {"concrete": [], "glass": []}
    if it.initialize():
        while True:
            sh = it.get(); g = sh.geometry
            v = np.array(g.verts, dtype=np.float64).reshape(-1, 3); f = np.array(g.faces, dtype=np.uint32).reshape(-1)
            cls = m.by_id(sh.id).is_a()
            if len(f) and cls not in SKIP: parts["glass" if cls in GLASS else "concrete"].append((v, f))
            if not it.next(): break
    out = {}
    for k, ps in parts.items():
        if not ps: continue
        off, V, F = 0, [], []
        for v, f in ps: V.append(v); F.append(f + off); off += len(v)
        V, F = np.concatenate(V), np.concatenate(F)
        V = np.round(V, 3)   # a millimetre: welds what the pieces share, and gzips well
        u, inv = np.unique(V, axis=0, return_inverse=True)
        pos = np.stack([u[:, 0], u[:, 2], -u[:, 1]], axis=1).astype(np.float32)   # ifc (east, north, up) -> glTF (east, up, -north)
        idx = inv.reshape(-1)[F].astype(np.uint32).reshape(-1, 3)
        idx = idx[:, [0, 2, 1]]   # the turn of axes reverses the winding
        out[k] = (pos, idx.reshape(-1))
    return out

def glb(parts, windows=0):
    allp = np.concatenate([p for p, _ in parts.values()]); lo, hi = allp.min(0).astype(np.float64), allp.max(0).astype(np.float64)
    scale = (hi - lo) / 65535.0; shift = lo + 32768 * scale   # q = round((p - lo) / scale) - 32768, so p = q * scale + shift
    blob, views, accs, prims, mats = bytearray(), [], [], [], []
    def put(arr, target, stride=None):
        while len(blob) % 4: blob.append(0)
        v = {"buffer": 0, "byteOffset": len(blob), "byteLength": arr.nbytes, "target": target}
        if stride: v["byteStride"] = stride
        views.append(v); blob.extend(arr.tobytes()); return len(views) - 1
    for name, (pos, idx) in parts.items():
        assert len(pos) < 65536 and idx.max() < 65536, "a primitive past 65535 vertices needs uint32 indices"
        q = (np.round((pos.astype(np.float64) - lo) / scale) - 32768).astype(np.int16)
        q4 = np.zeros((len(q), 4), dtype=np.int16); q4[:, :3] = q   # a vertex attribute starts on 4 bytes: x, y, z and a pad, 8 bytes a vertex
        accs.append({"bufferView": put(q4, 34962, 8), "componentType": 5122, "count": len(q), "type": "VEC3", "min": q.min(0).tolist(), "max": q.max(0).tolist()})
        accs.append({"bufferView": put(idx.astype(np.uint16), 34963), "componentType": 5123, "count": len(idx), "type": "SCALAR"})
        mats.append({"name": name}); prims.append({"attributes": {"POSITION": len(accs) - 2}, "indices": len(accs) - 1, "material": len(mats) - 1})
    js = {"asset": {"version": "2.0", "generator": "sykehus tools/glb.py"}, "extensionsUsed": ["KHR_mesh_quantization"], "extensionsRequired": ["KHR_mesh_quantization"],
          "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "scale": scale.tolist(), "translation": shift.tolist()}],
          "meshes": [{"primitives": prims, "extras": {"windows": int(windows)}}], "materials": mats, "buffers": [{"byteLength": len(blob)}], "bufferViews": views, "accessors": accs}
    j = json.dumps(js, separators=(",", ":")).encode(); j += b" " * (-len(j) % 4)
    while len(blob) % 4: blob.append(0)
    return b"glTF" + struct.pack("<II", 2, 12 + 8 + len(j) + 8 + len(blob)) + struct.pack("<I4s", len(j), b"JSON") + j + struct.pack("<I4s", len(blob), b"BIN\0") + bytes(blob)

if __name__ == "__main__":
    site_f, out = sys.argv[1:3]
    wings = sys.argv[3:] or list(ifc.ENVELOPE)
    m, counts = ifc.build(json.load(open(site_f)), {"floors": []}, wings, envelope=tuple(wings))
    parts = triangles(m)
    open(out, "wb").write(glb(parts, len(m.by_type("IfcWindow"))))
    print({k: (len(p), len(i) // 3) for k, (p, i) in parts.items()}, "->", out)
