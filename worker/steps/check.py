"""A built-in step (trusted, run in the job's sandbox after its script): check.json, what every file the script made
is, measured, and the job's expect held against it. Lengths in mm for STEP, BREP, FCStd and STL (as the files have
them), metres for IFC.

  STEP / BREP / FCStd (FreeCAD): its parts by name (a STEP's product names, an FCStd's labels), each with solids,
        valid, closed, volume, area, size and box; the parts that overlap, with by how much; gaps between parts named
        in expect
  STL:  triangles, size and box, watertight (every edge in two triangles), volume
  IFC:  its schema and the count of each class, buildings, storeys

expect (from the job): {"<file>": {solids, valid, closed, watertight, no_overlap, size: [x, y, z], max_size,
  min_volume, max_volume, tol (mm, for size; default 0.5), parts: {"<name>": {the same}}, gaps: [{a, b, min, max}]},
  ...}. Each is a line in checks, {file, part, what, want, got, ok}; ok is all of them; failed names those that are not.
"""
import glob
import json
import math
import os
import pathlib
import struct
import sys

OUT = pathlib.Path(".")
EXP = json.loads((OUT / ".expect.json").read_text()) if (OUT / ".expect.json").exists() else {}
FC = None


def freecad():
    """FreeCAD, if this image has it (the FreeCAD image has it on the path; a developer's FreeCAD.app beside it)"""
    global FC
    if FC is None:
        for p in [None, "/opt/conda/lib", *glob.glob("/Applications/FreeCAD*.app/Contents/Resources/lib")]:
            if p:
                sys.path.append(p)
            try:
                import FreeCAD  # noqa: F401
                import Part  # noqa: F401
                FC = True
                break
            except ImportError:
                FC = False
    return FC


r3 = lambda v: round(v, 3)


def box_of(bb):
    return {"box": [r3(bb.XMin), r3(bb.YMin), r3(bb.ZMin), r3(bb.XMax), r3(bb.YMax), r3(bb.ZMax)], "size": [r3(bb.XLength), r3(bb.YLength), r3(bb.ZLength)]}


def shape_facts(sh):
    solids = sh.Solids
    return {"solids": len(solids), "valid": bool(sh.isValid()), "closed": all(s.isClosed() for s in solids) if solids else False,
            "volume": r3(sum(s.Volume for s in solids)), "area": r3(sh.Area), **box_of(sh.BoundBox)}


def cad(path):
    """a STEP, BREP or FCStd as named parts"""
    import FreeCAD
    import Part
    ext = path.suffix.lower()
    parts = []
    if ext == ".brep":
        sh = Part.Shape(); sh.read(str(path)); parts = [(path.stem, sh)]
    else:
        if ext == ".fcstd":
            doc = FreeCAD.openDocument(str(path))
        else:
            import Import
            doc = FreeCAD.newDocument("check"); Import.insert(str(path), doc.Name); doc.recompute()
        # the leaves that are solids: a part's own body, not the assemblies or the bodies' features that hold it
        for o in doc.Objects:
            sh = getattr(o, "Shape", None)
            if sh is None or sh.isNull() or not sh.Solids or o.TypeId in ("App::Part", "App::Link"):
                continue
            if any(getattr(p, "Shape", None) is not None and p.TypeId not in ("App::Part", "App::DocumentObjectGroup") for p in o.InList):
                continue   # used by another shape (a feature in a body, a boolean's input): that one is the part
            parts.append((o.Label, sh))
        if not parts:   # a STEP with no names: its solids as they are
            sh = Part.Shape(); sh.read(str(path)); parts = [(f"solid {i + 1}", s) for i, s in enumerate(sh.Solids)]
    names, seen = [], {}
    for n, _ in parts:
        seen[n] = seen.get(n, 0) + 1; names.append(n if seen[n] == 1 else f"{n} {seen[n]}")
    shapes = dict(zip(names, (s for _, s in parts)))
    allsh = Part.makeCompound(list(shapes.values()))
    facts = {"kind": ext[1:], **shape_facts(allsh), "parts": [{"name": n, **shape_facts(s)} for n, s in shapes.items()]}
    over = []
    ks = list(shapes)[:40]
    for i in range(len(ks)):
        for k in range(i + 1, len(ks)):
            a, b = shapes[ks[i]], shapes[ks[k]]
            if not a.BoundBox.intersect(b.BoundBox):
                continue
            try:
                v = a.common(b).Volume
            except Exception:
                v = 0
            if v > 1e-3:
                over.append({"a": ks[i], "b": ks[k], "volume": r3(v)})
    facts["overlaps"] = over
    return facts, shapes


def stl(path):
    b = path.read_bytes()
    tris = []
    if len(b) >= 84 and 84 + 50 * struct.unpack("<I", b[80:84])[0] == len(b):
        n = struct.unpack("<I", b[80:84])[0]
        for i in range(n):
            v = struct.unpack("<12f", b[84 + 50 * i: 84 + 50 * i + 48])
            tris.append((v[3:6], v[6:9], v[9:12]))
    else:
        pts = [tuple(map(float, l.split()[1:4])) for l in b.decode(errors="replace").splitlines() if l.strip().startswith("vertex")]
        tris = [tuple(pts[i:i + 3]) for i in range(0, len(pts) - 2, 3)]
    if not tris:
        return {"kind": "stl", "triangles": 0, "watertight": False, "volume": 0}
    key = lambda p: (round(p[0], 4), round(p[1], 4), round(p[2], 4))
    edges, vol = {}, 0.0
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    for t in tris:
        q = [key(p) for p in t]
        for a in range(3):
            e = tuple(sorted((q[a], q[(a + 1) % 3])))
            edges[e] = edges.get(e, 0) + 1
            for c in range(3):
                lo[c] = min(lo[c], t[a][c]); hi[c] = max(hi[c], t[a][c])
        (ax, ay, az), (bx, by, bz), (cx, cy, cz) = t
        vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
    return {"kind": "stl", "triangles": len(tris), "watertight": all(n == 2 for n in edges.values()), "volume": r3(abs(vol)),
            "box": [r3(v) for v in lo + hi], "size": [r3(hi[c] - lo[c]) for c in range(3)]}


def ifc(path):
    import collections
    import ifcopenshell
    f = ifcopenshell.open(str(path))
    n = collections.Counter(p.is_a() for p in f.by_type("IfcProduct") if not p.is_a("IfcSpatialElement") and not p.is_a("IfcOpeningElement"))
    return {"kind": "ifc", "schema": f.schema, "classes": dict(n), "buildings": len(f.by_type("IfcBuilding")), "storeys": len(f.by_type("IfcBuildingStorey"))}


report = {"ok": True, "files": {}, "checks": [], "failed": []}
shapes_of = {}
for p in sorted(OUT.iterdir()):
    if not p.is_file() or p.name.startswith(".") or p.name in ("script.py", "params.json", "check.json"):
        continue
    ext = p.suffix.lower()
    try:
        if ext in (".step", ".stp", ".brep", ".fcstd"):
            if not freecad():
                report["files"][p.name] = {"kind": ext[1:], "note": "not measured: this worker has no FreeCAD"}
                continue
            report["files"][p.name], shapes_of[p.name] = cad(p)
        elif ext == ".stl":
            report["files"][p.name] = stl(p)
        elif ext == ".ifc":
            report["files"][p.name] = ifc(p)
    except Exception as e:   # a file that cannot be read is itself a finding
        report["files"][p.name] = {"kind": ext[1:], "error": f"{type(e).__name__}: {e}"[:300]}


def held(file, part, what, want, got, ok):
    report["checks"].append({"file": file, "part": part, "what": what, "want": want, "got": got, "ok": bool(ok)})
    if not ok:
        report["failed"].append(f"{file}{' / ' + part if part else ''}: {what} {json.dumps(want)}, got {json.dumps(got)}")


def against(file, part, f, e):
    tol = e.get("tol", EXP.get(file, {}).get("tol", 0.5))
    for k in ("solids", "valid", "closed", "watertight"):
        if k in e:
            held(file, part, k, e[k], f.get(k), f.get(k) == e[k])
    if "no_overlap" in e and part is None:
        held(file, part, "no_overlap", e["no_overlap"], f.get("overlaps", []), (not f.get("overlaps")) == bool(e["no_overlap"]))
    if "size" in e:   # either way round on plan: a part may lie turned
        got = f.get("size")
        ok = bool(got) and (all(abs(g - w) <= tol for g, w in zip(got, e["size"])) or all(abs(g - w) <= tol for g, w in zip([got[1], got[0], got[2]], e["size"])))
        held(file, part, "size", e["size"], got, ok)
    if "max_size" in e:
        got = f.get("size"); held(file, part, "max_size", e["max_size"], got, bool(got) and all(g <= w + tol for g, w in zip(sorted(got), sorted(e["max_size"]))))
    if "min_volume" in e:
        held(file, part, "min_volume", e["min_volume"], f.get("volume"), (f.get("volume") or 0) >= e["min_volume"])
    if "max_volume" in e:
        held(file, part, "max_volume", e["max_volume"], f.get("volume"), (f.get("volume") or 0) <= e["max_volume"])


for file, e in EXP.items():
    f = report["files"].get(file)
    if f is None:
        held(file, None, "exists", True, False, False); continue
    if "error" in f:
        held(file, None, "readable", True, f["error"], False); continue
    against(file, None, f, e)
    by = {p["name"]: p for p in f.get("parts", [])}
    for name, pe in (e.get("parts") or {}).items():
        if name not in by:
            held(file, name, "exists", True, sorted(by), False); continue
        against(file, name, by[name], pe)
    for g in e.get("gaps") or []:
        sh = shapes_of.get(file, {})
        if g.get("a") not in sh or g.get("b") not in sh:
            held(file, f"{g.get('a')} / {g.get('b')}", "gap", g, "no such parts", False); continue
        d = r3(sh[g["a"]].distToShape(sh[g["b"]])[0])
        ok = ("min" not in g or d >= g["min"]) and ("max" not in g or d <= g["max"])
        held(file, f"{g['a']} / {g['b']}", "gap", {k: g[k] for k in ("min", "max") if k in g}, d, ok)
report["ok"] = not report["failed"]
(OUT / "check.json").write_text(json.dumps(report, indent=1))
