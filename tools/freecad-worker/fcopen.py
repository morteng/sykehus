"""Open an IFC in FreeCAD headless, as Lars would open it: objects, IFC classes, shapes. One JSON line.

NativeIFC (FreeCAD 1.x's default importer) decides; the old importer is tried too and its result kept beside it
(FreeCAD 1.1.4's old importer calls settings.USE_BREP_DATA, which IfcOpenShell 0.8 no longer has).
"""
import collections
import json
import sys

import FreeCAD


def native(path):
    from nativeifc import ifc_import
    doc = FreeCAD.newDocument("native")
    ifc_import.insert(path, doc.Name, strategy=2, shapemode=0, switchwb=False, silent=True)
    doc.recompute()
    objs = [o for o in doc.Objects if hasattr(o, "Class") and o.Class not in ("IfcProject", "IfcSite", "IfcBuilding", "IfcBuildingStorey")]
    shaped = [o for o in objs if getattr(o, "Shape", None) is not None and not o.Shape.isNull()]
    return {"ok": len(shaped) > 0, "objects": len(objs), "shaped": len(shaped), "classes": dict(collections.Counter(o.Class for o in objs))}


def legacy(path):
    try:
        from importers import importIFC
    except ImportError:
        import importIFC
    doc = FreeCAD.newDocument("legacy")
    importIFC.insert(path, doc.Name)
    return {"ok": True, "objects": len([o for o in doc.Objects if hasattr(o, "IfcType")])}


def attempt(fn, path):
    try:
        return fn(path)
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


r = attempt(native, sys.argv[1])
r["legacy"] = attempt(legacy, sys.argv[1])
print(json.dumps(r))
