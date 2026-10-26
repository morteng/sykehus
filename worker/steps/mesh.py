"""A built-in step (trusted, run in the job's sandbox after its script): mesh.json from the IFC it made, for a viewer
with no IFC reader. One part per IFC class: positions in metres to the cm (x east, y north, z kote, as the IFC has
them) and triangle indices; the box round it all; the count of each class; what the IFC is (schema, building, storeys).
"""
import collections
import json
import pathlib
import sys

import ifcopenshell
import ifcopenshell.geom

ifcs = sorted(pathlib.Path(".").glob("*.ifc"), key=lambda p: (p.name != "model.ifc", p.name))
if not ifcs:
    sys.exit("no IFC: the script wrote no .ifc file")
f = ifcopenshell.open(str(ifcs[0]))
s = ifcopenshell.geom.settings()
s.set("use-world-coords", True)
parts = collections.OrderedDict()
lo, hi = [1e18] * 3, [-1e18] * 3
it = ifcopenshell.geom.iterator(s, f, 1)
if it.initialize():
    while True:
        sh = it.get()
        e = f.by_id(sh.id)
        v, fc = sh.geometry.verts, sh.geometry.faces
        if v and not e.is_a("IfcOpeningElement") and not e.is_a("IfcSpace"):
            p = parts.setdefault(e.is_a(), {"cls": e.is_a(), "n": 0, "pos": [], "idx": []})
            base = len(p["pos"]) // 3
            p["pos"].extend(round(x, 2) for x in v)
            p["idx"].extend(base + i for i in fc)
            p["n"] += 1
            for k in range(0, len(v), 3):
                for a in range(3):
                    lo[a] = min(lo[a], v[k + a]); hi[a] = max(hi[a], v[k + a])
        if not it.next():
            break
if not parts:
    sys.exit("no geometry: the IFC has no shapes")
counts = collections.Counter(p.is_a() for p in f.by_type("IfcProduct") if not p.is_a("IfcSpatialElement") and not p.is_a("IfcOpeningElement"))
out = {"ifc": ifcs[0].name, "schema": f.schema, "box": {"min": [round(x, 2) for x in lo], "max": [round(x, 2) for x in hi]},
       "classes": dict(counts), "buildings": len(f.by_type("IfcBuilding")), "storeys": len(f.by_type("IfcBuildingStorey")),
       "triangles": sum(len(p["idx"]) // 3 for p in parts.values()), "parts": list(parts.values())}
pathlib.Path("mesh.json").write_text(json.dumps(out, separators=(",", ":")))
