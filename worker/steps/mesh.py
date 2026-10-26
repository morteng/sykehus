"""A built-in step (trusted, run in the job's sandbox after its script): meshes for a viewer with no IFC or STEP reader.

IFC (the first, model.ifc if there is one): mesh.json, one part per IFC class: positions in metres to the cm (x east,
y north, z kote, as the IFC has them) and triangle indices; the box round it all; the count of each class; what the
IFC is (schema, building, storeys, its length unit).

STEP / BREP / FCStd (with FreeCAD; the inputs too, so a bought part's STEP can come in alone): for each file <stem>,
one mesh per part (a STEP's product names, an FCStd's labels) in the part's own frame, at the job's mesh tolerance
({linear_mm: 0.1, angular_deg: 15} by default):
  <stem>.<n>.stl      each part's own mesh, mm (the same part twice is the same bytes, so the same sha)
  <stem>.glb          every part as a node with its name and placement, one mesh per distinct part, metres (glTF's)
  <stem>.parts.json   [{name, stl, matrix (4×4 row-major, mm, the part's place in the file), box, triangles}]
"""
import collections
import glob
import hashlib
import json
import math
import pathlib
import struct
import sys

HERE = pathlib.Path(".")
OPT = {"linear_mm": 0.1, "angular_deg": 15, **(json.loads((HERE / ".mesh.json").read_text()) if (HERE / ".mesh.json").exists() else {})}
did = []


def ifc_mesh(path):
    import ifcopenshell
    import ifcopenshell.geom
    f = ifcopenshell.open(str(path))
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
    # the file's own length unit (ifcopenshell.geom gives metres whatever it is): what an imported file is said to be in
    import ifcopenshell.util.unit
    scale = ifcopenshell.util.unit.calculate_unit_scale(f)
    lu = next((u for a in f.by_type("IfcUnitAssignment") for u in a.Units if getattr(u, "UnitType", None) == "LENGTHUNIT"), None)
    unit = ((lu.Prefix or "") + lu.Name).lower() if lu and lu.is_a("IfcSIUnit") else (str(lu.Name).lower() if lu else None)
    out = {"ifc": path.name, "schema": f.schema, "unit": {"length": unit, "to_m": scale}, "box": {"min": [round(x, 2) for x in lo], "max": [round(x, 2) for x in hi]},
           "classes": dict(counts), "buildings": len(f.by_type("IfcBuilding")), "storeys": len(f.by_type("IfcBuildingStorey")),
           "triangles": sum(len(p["idx"]) // 3 for p in parts.values()), "parts": list(parts.values())}
    pathlib.Path("mesh.json").write_text(json.dumps(out, separators=(",", ":")))


def freecad():
    for p in [None, "/opt/conda/lib", *glob.glob("/Applications/FreeCAD*.app/Contents/Resources/lib")]:
        if p:
            sys.path.append(p)
        try:
            import FreeCAD  # noqa: F401
            return True
        except ImportError:
            pass
    return False


def cad_parts(path):
    """the leaves that are solids, each (name, its shape in its own frame, its placement in the file)"""
    import FreeCAD as App
    import Part
    ext = path.suffix.lower()
    if ext == ".brep":
        sh = Part.Shape(); sh.read(str(path)); return [(path.stem, sh, App.Placement())]
    if ext == ".fcstd":
        doc = App.openDocument(str(path))
    else:
        import Import
        doc = App.newDocument("mesh"); Import.insert(str(path), doc.Name); doc.recompute()
    out = []
    for o in doc.Objects:
        sh = getattr(o, "Shape", None)
        if sh is None or sh.isNull() or not sh.Solids or o.TypeId in ("App::Part", "App::Link"):
            continue
        if any(getattr(p, "Shape", None) is not None and p.TypeId not in ("App::Part", "App::DocumentObjectGroup") for p in o.InList):
            continue
        local = sh.copy(); local.Placement = App.Placement()
        out.append((o.Label, local, o.getGlobalPlacement()))
    if not out:
        sh = Part.Shape(); sh.read(str(path)); out = [(f"solid {i + 1}", s, App.Placement()) for i, s in enumerate(sh.Solids)]
    return out


def stl_bytes(pts, tris):
    b = bytearray(b"sykehus worker mesh".ljust(80, b" ")) + struct.pack("<I", len(tris))
    for t in tris:
        a, c, d = (pts[i] for i in t)
        u = [c[k] - a[k] for k in range(3)]; v = [d[k] - a[k] for k in range(3)]
        n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; L = math.sqrt(sum(x * x for x in n)) or 1
        b += struct.pack("<12fH", *(x / L for x in n), *a, *c, *d, 0)
    return bytes(b)


def glb_bytes(meshes, nodes):
    """meshes: [(pts mm, tris)]; nodes: [(name, mesh index, 4×4 row-major mm)] → glTF 2.0 binary, metres"""
    bin_, views, accs, gm = bytearray(), [], [], []
    for pts, tris in meshes:
        p = b"".join(struct.pack("<3f", *(x / 1000 for x in q)) for q in pts)
        i = b"".join(struct.pack("<3I", *t) for t in tris)
        lo = [min(q[k] for q in pts) / 1000 for k in range(3)]; hi = [max(q[k] for q in pts) / 1000 for k in range(3)]
        for data, target in ((p, 34962), (i, 34963)):
            views.append({"buffer": 0, "byteOffset": len(bin_), "byteLength": len(data), "target": target}); bin_ += data
            bin_ += b"\0" * (-len(bin_) % 4)
        accs.append({"bufferView": len(views) - 2, "componentType": 5126, "count": len(pts), "type": "VEC3", "min": lo, "max": hi})
        accs.append({"bufferView": len(views) - 1, "componentType": 5125, "count": 3 * len(tris), "type": "SCALAR"})
        gm.append({"primitives": [{"attributes": {"POSITION": len(accs) - 2}, "indices": len(accs) - 1}]})
    gn = []
    for name, mi, m in nodes:
        col = [m[r][c] / (1000 if (c == 3 and r < 3) else 1) for c in range(4) for r in range(4)]   # column-major, the move in metres
        gn.append({"name": name, "mesh": mi, "matrix": col})
    doc = {"asset": {"version": "2.0", "generator": "sykehus worker"}, "scene": 0, "scenes": [{"nodes": list(range(len(gn)))}],
           "nodes": gn, "meshes": gm, "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(bin_)}]}
    j = json.dumps(doc, separators=(",", ":")).encode(); j += b" " * (-len(j) % 4)
    return b"glTF" + struct.pack("<II", 2, 12 + 8 + len(j) + 8 + len(bin_)) + struct.pack("<I", len(j)) + b"JSON" + j + struct.pack("<I", len(bin_)) + b"BIN\0" + bytes(bin_)


def cad_mesh(path):
    import MeshPart
    stem, parts, meshes, nodes, seen = path.stem, [], [], [], {}
    for n, (name, sh, pl) in enumerate(cad_parts(path), 1):
        m = MeshPart.meshFromShape(Shape=sh, LinearDeflection=float(OPT["linear_mm"]), AngularDeflection=math.radians(float(OPT["angular_deg"])), Relative=False)
        pts, tris = m.Topology
        pts = [(round(p.x, 4), round(p.y, 4), round(p.z, 4)) for p in pts]; tris = [tuple(t) for t in tris]
        if not tris:
            continue
        stl = stl_bytes(pts, tris); key = hashlib.sha256(stl).hexdigest()
        if key not in seen:   # the same part again: the same mesh, placed elsewhere
            seen[key] = (len(meshes), f"{stem}.{len(meshes) + 1}.stl"); meshes.append((pts, tris)); pathlib.Path(seen[key][1]).write_bytes(stl)
        mi, fname = seen[key]
        M = pl.toMatrix(); mat = [[M.A11, M.A12, M.A13, M.A14], [M.A21, M.A22, M.A23, M.A24], [M.A31, M.A32, M.A33, M.A34], [0, 0, 0, 1]]
        bb = sh.copy(); bb.Placement = pl; b = bb.BoundBox
        nodes.append((name, mi, mat))
        parts.append({"name": name, "stl": fname, "matrix": [[round(x, 6) for x in r] for r in mat],
                      "box": [round(v, 3) for v in (b.XMin, b.YMin, b.ZMin, b.XMax, b.YMax, b.ZMax)], "triangles": len(tris)})
    if not parts:
        sys.exit(f"no geometry: {path.name} has no solids")
    pathlib.Path(f"{stem}.glb").write_bytes(glb_bytes(meshes, nodes))
    pathlib.Path(f"{stem}.parts.json").write_text(json.dumps({"file": path.name, "unit": "mm", "tolerance": OPT, "parts": parts}, indent=1))


files = sorted(p for p in HERE.iterdir() if p.is_file() and not p.name.startswith("."))
ifcs = sorted((p for p in files if p.suffix.lower() == ".ifc"), key=lambda p: (p.name != "model.ifc", p.name))
cads = [p for p in files if p.suffix.lower() in (".step", ".stp", ".brep", ".fcstd")]
if ifcs:
    ifc_mesh(ifcs[0])
if cads and freecad():
    for p in cads:
        cad_mesh(p)
elif cads and not ifcs:
    sys.exit("no FreeCAD: this worker meshes STEP in its FreeCAD image")
if not ifcs and not cads:
    sys.exit("no IFC: the script wrote no .ifc or .step file")
