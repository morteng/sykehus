"""The high block as a GLB for the 3D page (U3656): the same model as the IFC, one source. tools/ifc.py builds the envelope wings
(walls with their window openings, floor slabs, roof, the windows as glass); this reads the triangles back out of that model
with IfcOpenShell and writes them as one mesh a material (concrete, glass), so the page draws what the IFC holds.

  python -I tools/glb.py <site.json> <out.glb> [wing id ...]      (the wings of public/bimglb.js BIM; about 3 minutes)

The file holds absolute heights in the page's axes (glTF: x east, y up = kote in metres, z = -north), as the IFC has them; the
viewer lifts it by its terrain base. Positions are float32, indices uint32, no normals (the page shades it flat). Read by
public/bimglb.js (a small reader of this layout only, not a general glTF loader). Needs IfcOpenShell and numpy."""
import sys, json, struct
import numpy as np
import ifcopenshell, ifcopenshell.geom
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import ifc

GLASS = ("IfcWindow",)

def triangles(m):
    """{material key: (positions Nx3 float32 in glTF axes, indices uint32)} from the model's own geometry, openings cut"""
    s = ifcopenshell.geom.settings(); s.set("use-world-coords", True)
    it = ifcopenshell.geom.iterator(s, m, 4)
    parts = {"concrete": [], "glass": []}
    if it.initialize():
        while True:
            sh = it.get(); g = sh.geometry
            v = np.array(g.verts, dtype=np.float64).reshape(-1, 3); f = np.array(g.faces, dtype=np.uint32).reshape(-1)
            if len(f): parts["glass" if m.by_id(sh.id).is_a() in GLASS else "concrete"].append((v, f))
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

def glb(parts):
    blob, views, accs, prims, mats = bytearray(), [], [], [], []
    for name, (pos, idx) in parts.items():
        for arr, target, kind, ctype, mn, mx in ((pos, 34962, "VEC3", 5126, pos.min(0).tolist(), pos.max(0).tolist()), (idx, 34963, "SCALAR", 5125, None, None)):
            while len(blob) % 4: blob.append(0)
            views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": arr.nbytes, "target": target}); blob += arr.tobytes()
            a = {"bufferView": len(views) - 1, "componentType": ctype, "count": len(arr) if kind == "VEC3" else len(arr), "type": kind}
            if mn is not None: a["min"], a["max"] = mn, mx
            accs.append(a)
        mats.append({"name": name}); prims.append({"attributes": {"POSITION": len(accs) - 2}, "indices": len(accs) - 1, "material": len(mats) - 1})
    js = {"asset": {"version": "2.0", "generator": "sykehus tools/glb.py"}, "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}], "meshes": [{"primitives": prims}],
          "materials": mats, "buffers": [{"byteLength": len(blob)}], "bufferViews": views, "accessors": accs}
    j = json.dumps(js, separators=(",", ":")).encode(); j += b" " * (-len(j) % 4)
    while len(blob) % 4: blob.append(0)
    return b"glTF" + struct.pack("<II", 2, 12 + 8 + len(j) + 8 + len(blob)) + struct.pack("<I4s", len(j), b"JSON") + j + struct.pack("<I4s", len(blob), b"BIN\0") + bytes(blob)

if __name__ == "__main__":
    site_f, out = sys.argv[1:3]
    wings = sys.argv[3:] or list(ifc.ENVELOPE)
    m, counts = ifc.build(json.load(open(site_f)), {"floors": []}, wings, envelope=tuple(wings))
    parts = triangles(m)
    open(out, "wb").write(glb(parts))
    print({k: (len(p), len(i) // 3) for k, (p, i) in parts.items()}, "->", out)
