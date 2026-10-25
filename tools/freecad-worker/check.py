"""Check one bake-off try in its directory (the cwd): greenhouse.ifc and .glb against the task. Writes check.json and shot.png.

Runs in the full worker (IfcOpenShell for the geometry, FreeCAD for the open test through fcopen.py).
The task: base 30 centred on (0, 0), foot 12, apex 28, members every 3 m up the face (2.19 m in height),
rafters every 3 m along the base edge, a 0.30 slab with its top at 12, a 2.0 × 2.5 door in the south face.
"""
import collections
import json
import math
import os
import pathlib
import struct
import subprocess
import sys

import numpy as np

BASE, TOP, GROUND, MODULE = 30.0, 28.0, 12.0, 3.0
RISE = MODULE * (TOP - GROUND) / math.hypot(BASE / 2, TOP - GROUND)      # 3 m along the face, in height
here = pathlib.Path(".")
out = {"checks": {}}


def ok(name, good, **seen):
    out["checks"][name] = {"ok": bool(good), **seen}


def levels(zs, tol=0.15):
    got = []
    for z in sorted(zs):
        if not got or z - got[-1][-1] > tol:
            got.append([z])
        else:
            got[-1].append(z)
    return [round(sum(g) / len(g), 3) for g in got]


def meshes(f):
    import ifcopenshell.geom
    s = ifcopenshell.geom.settings()
    s.set("use-world-coords", True)
    it = ifcopenshell.geom.iterator(s, f, max(1, (os.cpu_count() or 2) - 1))
    if it.initialize():
        while True:
            sh = it.get()
            v = np.array(sh.geometry.verts, float).reshape(-1, 3)
            if len(v):
                yield f.by_id(sh.id), v, np.array(sh.geometry.faces, int).reshape(-1, 3)
            if not it.next():
                break


def glb(p):
    b = p.read_bytes()
    if len(b) < 20 or b[:4] != b"glTF":
        return {"ok": False, "bytes": len(b)}
    n = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + n])
    return {"ok": True, "bytes": len(b), "meshes": len(j.get("meshes", [])), "nodes": len(j.get("nodes", []))}


def run():
    import ifcopenshell
    import ifcopenshell.util.element as ue
    if (here / "time.txt").exists():
        out["run_s"] = float((here / "time.txt").read_text())
    log = (here / "run.log").read_text(errors="replace") if (here / "run.log").exists() else ""
    said = [l for l in log.splitlines() if l.strip().startswith("{") and '"members"' in l]
    out["printed"] = json.loads(said[-1]) if said else None
    out["glb"] = glb(here / "greenhouse.glb") if (here / "greenhouse.glb").exists() else {"ok": False}
    if not (here / "greenhouse.ifc").exists():
        out["error"] = "no greenhouse.ifc"
        return
    f = ifcopenshell.open("greenhouse.ifc")
    out["schema"] = f.schema
    out["classes"] = dict(collections.Counter(p.is_a() for p in f.by_type("IfcProduct")
                                              if not p.is_a("IfcSpatialElement") and not p.is_a("IfcOpeningElement")))
    items = list(meshes(f))
    out["shapes"] = len(items)
    if not items:
        out["error"] = "no geometry"
        return
    allv = np.vstack([v for _, v, _ in items])
    lo, hi = allv.min(0), allv.max(0)
    out["bbox"] = [lo.round(3).tolist(), hi.round(3).tolist()]

    frame = [(e, v) for e, v, _ in items if e.is_a() in ("IfcMember", "IfcBeam", "IfcColumn")]
    glass = [(e, v) for e, v, _ in items if e.is_a() in ("IfcPlate", "IfcWindow", "IfcCovering")]
    slab = [(e, v) for e, v, _ in items if e.is_a("IfcSlab") or e.is_a("IfcFooting")]
    door = [(e, v) for e, v, _ in items if e.is_a("IfcDoor")]
    above = np.vstack([v for _, v in frame + glass]) if frame + glass else allv
    flo, fhi = above.min(0), above.max(0)
    ext = fhi - flo
    ok("base", abs(ext[0] - BASE) < 0.35 and abs(ext[1] - BASE) < 0.35 and abs(flo[2] - GROUND) < 0.15
       and abs((flo[0] + fhi[0]) / 2) < 0.2 and abs((flo[1] + fhi[1]) / 2) < 0.2,
       x=round(float(ext[0]), 3), y=round(float(ext[1]), 3), foot=round(float(flo[2]), 3))
    ok("apex", abs(fhi[2] - TOP) < 0.25, top=round(float(fhi[2]), 3))
    if slab:
        sv = np.vstack([v for _, v in slab])
        ok("slab", abs(sv[:, 2].max() - GROUND) < 0.05 and abs(np.ptp(sv[:, 2]) - 0.30) < 0.03
           and np.ptp(sv[:, 0]) > BASE - 0.1, top=round(float(sv[:, 2].max()), 3), thick=round(float(np.ptp(sv[:, 2])), 3))
    else:
        ok("slab", False, why="no IfcSlab")
    # horizontals: flat members above the ring; their heights should step by RISE
    flat = [float(v[:, 2].mean()) for _, v in frame if np.ptp(v[:, 2]) < 0.4 and max(np.ptp(v[:, 0]), np.ptp(v[:, 1])) > 1
            and v[:, 2].mean() > GROUND + 0.5]
    lv = levels(flat)
    steps = np.diff([GROUND] + lv) if lv else np.array([])
    ok("module", len(lv) >= 6 and len(steps) and np.all(np.abs(steps - RISE) < 0.12),
       levels=lv, want=round(RISE, 3), count=len(lv))
    # rafters on the south face: where sloped members meet the ground, along the base edge
    feet = []
    for _, v in frame:
        if np.ptp(v[:, 2]) > 0.5 and v[:, 1].mean() < -1:
            low = v[v[:, 2] < v[:, 2].min() + 0.15]
            if abs(low[:, 2].mean() - GROUND) < 0.3 and abs(low[:, 0].mean()) < BASE / 2 - 1:
                feet.append(round(float(low[:, 0].mean()), 2))
    feet = levels(feet, 0.2)
    want = [MODULE * k for k in range(-int(BASE / 2 / MODULE - 0.01), int(BASE / 2 / MODULE - 0.01) + 1)]
    ok("rafters", len(feet) == len(want) and all(abs(a - b) < 0.15 for a, b in zip(feet, want)), feet=feet, want=want)
    if door:
        dv = np.vstack([v for _, v in door])
        w, h = float(max(np.ptp(dv[:, 0]), np.ptp(dv[:, 1]))), float(np.ptp(dv[:, 2]))
        ok("door", 1.8 < w < 2.5 and 2.3 < h < 2.8 and abs(dv[:, 0].mean()) < 0.5 and dv[:, 1].mean() < -BASE / 2 + 1.5,
           w=round(w, 2), h=round(h, 2), at=[round(float(dv[:, 0].mean()), 2), round(float(dv[:, 1].mean()), 2)])
    else:
        ok("door", False, why="no IfcDoor")
    names = {}
    for ent in f.by_type("IfcRoot"):
        try:
            ps = ue.get_psets(ent)
        except Exception:
            continue
        for pset, props in ps.items():
            for k, val in props.items():
                if k.lower() in ("base", "top", "ground", "module", "profile"):
                    names.setdefault(k.lower(), [pset, val])
    ok("params", len(names) == 5, found=names)
    out["counts"] = {"frame": len(frame), "glass": len(glass)}
    shot(items)


def shot(items):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    col = {"IfcMember": "#3a3f47", "IfcBeam": "#3a3f47", "IfcColumn": "#3a3f47", "IfcPlate": "#8fc3e8",
           "IfcWindow": "#8fc3e8", "IfcSlab": "#b9b2a6", "IfcDoor": "#b0472f"}
    fig = plt.figure(figsize=(9, 7), dpi=110)
    ax = fig.add_subplot(projection="3d")
    for e, v, fc in items:
        c = col.get(e.is_a(), "#c9a227")
        ax.add_collection3d(Poly3DCollection(v[fc], facecolor=c, edgecolor="none",
                                             alpha=0.35 if c == "#8fc3e8" else 1.0))
    ax.set_xlim(-17, 17); ax.set_ylim(-17, 17); ax.set_zlim(10, 30)
    ax.set_box_aspect((34, 34, 20)); ax.view_init(elev=20, azim=-70)
    ax.set_title(f"{pathlib.Path.cwd().name}: " + ", ".join(f"{k} {n}" for k, n in sorted(out["classes"].items())), fontsize=8)
    fig.savefig("shot.png", bbox_inches="tight")


def freecad():
    try:
        r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "fcopen.py"), "greenhouse.ifc"],
                           capture_output=True, text=True, timeout=180)
        line = [l for l in r.stdout.splitlines() if l.startswith("{")]
        out["freecad"] = json.loads(line[-1]) if line else {"ok": False, "error": (r.stderr or r.stdout)[-300:]}
    except subprocess.TimeoutExpired:
        out["freecad"] = {"ok": False, "error": "timeout 180 s"}


if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
    if (here / "greenhouse.ifc").exists():
        freecad()
    pathlib.Path("check.json").write_text(json.dumps(out, indent=1, default=str))
    print(json.dumps({k: out.get(k) for k in ("schema", "classes", "error")}, default=str))
    print(" ".join(f"{k}:{'ok' if c['ok'] else 'NO'}" for k, c in out["checks"].items()))
