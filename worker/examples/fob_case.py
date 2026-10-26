"""A worker job for Fab (U3531's done-when): the keychain fob's case, a shell and a lid around a board read from its
STEP, with a hole for a switch and one for an LED, and a ring for the key ring. Inputs (by sha256): board.step (the
StickS3), and switch.step if there is one (placed at the switch hole, to check its fit). Parameters, mm: wall, gap
(board to inside), floor, lid, lip (the lid's lip into the shell), lip_gap, radius (outside corners), switch_x/_y/_d
(from the board's corner, on its top face), led_x/_y/_d, ring_d (the key ring's hole), ring_w.
Writes case.step (Shell, Lid, Board, Switch), shell.stl, lid.stl, fob.params.json (as used); prints what it made.
Ask for then: ["check"] with expect, e.g. {"case.step": {"no_overlap": true, "gaps": [{"a": "Shell", "b": "Board",
"min": 0.2}]}}.
"""
import glob
import json
import os
import sys

sys.path += glob.glob("/Applications/FreeCAD*.app/Contents/Resources/lib")   # a developer's FreeCAD.app; the image has it on the path
import FreeCAD as App
import Import
import Mesh
import Part

V = App.Vector
P = {"wall": 1.6, "gap": 0.4, "floor": 1.2, "lid": 1.2, "lip": 1.5, "lip_gap": 0.2, "radius": 2.0,
     "switch_x": 10.0, "switch_y": 0.0, "switch_d": 4.0, "led_x": 4.0, "led_y": 0.0, "led_d": 3.0, "ring_d": 4.0, "ring_w": 2.0,
     **json.load(open("params.json"))}


def read(name):
    doc = App.newDocument(name.replace(".", "_")); Import.insert(name, doc.Name); doc.recompute()
    solids = [s for o in doc.Objects if getattr(o, "Shape", None) is not None and not o.Shape.isNull() for s in o.Shape.Solids]
    if not solids:
        sys.exit(f"{name} has no solids")
    return Part.makeCompound(solids)


board = read("board.step")
bb = board.BoundBox
w, g, fl, ld = P["wall"], P["gap"], P["floor"], P["lid"]
# inside: the board's box and the gap round it; outside: the wall round that; the lid closes the top
ix, iy, iz = bb.XLength + 2 * g, bb.YLength + 2 * g, bb.ZLength + 2 * g + P["lip"]   # the lid's lip stands above the board
o = V(bb.XMin - g - w, bb.YMin - g - w, bb.ZMin - g - fl)
ox, oy, oz = ix + 2 * w, iy + 2 * w, iz + fl


def rounded(x, y, z, r, at):
    b = Part.makeBox(x, y, z, at)
    return b.makeFillet(min(r, x / 2 - 0.01, y / 2 - 0.01), [e for e in b.Edges if abs(e.Vertexes[0].Point.z - e.Vertexes[1].Point.z) > 1e-6]) if r > 0 else b


outer = rounded(ox, oy, oz, P["radius"], o)
inner = Part.makeBox(ix, iy, iz + 1, V(bb.XMin - g, bb.YMin - g, bb.ZMin - g))
# the key ring: a tab at the shell's -x end, its hole just outside the wall
rc = V(o.x - P["ring_d"] / 2, o.y + oy / 2, o.z)
tab = Part.makeCylinder(P["ring_d"] / 2 + P["ring_w"], oz, rc)
shell = outer.fuse(tab).cut(inner).cut(Part.makeCylinder(P["ring_d"] / 2, oz + 2, rc + V(0, 0, -1))).removeSplitter()
# the lid: a plate on top and a lip down inside the shell, with the switch and LED holes over the board's top
top = o.z + oz
lid = rounded(ox, oy, ld, P["radius"], V(o.x, o.y, top))
lg = P["lip_gap"]
lip = Part.makeBox(ix - 2 * lg, iy - 2 * lg, P["lip"], V(bb.XMin - g + lg, bb.YMin - g + lg, top - P["lip"]))
lip = lip.cut(Part.makeBox(ix - 2 * lg - 2 * w, iy - 2 * lg - 2 * w, P["lip"] + 1, V(bb.XMin - g + lg + w, bb.YMin - g + lg + w, top - P["lip"] - 0.5)))
lid = lid.fuse(lip).removeSplitter()
holes, sw = {}, read("switch.step") if os.path.exists("switch.step") else None
for k in ("switch", "led"):
    c = V(bb.XMin + P[f"{k}_x"], bb.YMin + bb.YLength / 2 + P[f"{k}_y"], top - P["lip"] - 1)
    holes[k] = [round(c.x, 3), round(c.y, 3)]
    if k == "switch" and sw is not None:   # the switch's own footprint and the gap round it, so it goes through
        sb = sw.BoundBox
        lid = lid.cut(Part.makeBox(sb.XLength + 2 * lg, sb.YLength + 2 * lg, ld + P["lip"] + 2, V(c.x - sb.XLength / 2 - lg, c.y - sb.YLength / 2 - lg, c.z)))
    else:
        lid = lid.cut(Part.makeCylinder(P[f"{k}_d"] / 2, ld + P["lip"] + 2, c))

doc = App.newDocument("fob")
for name, sh in (("Shell", shell), ("Lid", lid), ("Board", board)):
    doc.addObject("Part::Feature", name).Shape = sh
if sw is not None:
    sb = sw.BoundBox
    sw.translate(V(holes["switch"][0] - sb.Center.x, holes["switch"][1] - sb.Center.y, bb.ZMax - sb.ZMin))
    doc.addObject("Part::Feature", "Switch").Shape = sw
doc.recompute()
objs = [x for x in doc.Objects]
Import.export(objs, "case.step")
for name, sh in (("shell", shell), ("lid", lid)):
    Mesh.Mesh(sh.tessellate(0.05)).write(f"{name}.stl")
json.dump(P, open("fob.params.json", "w"), indent=1)   # params.json is the input; this is what was used
print(json.dumps({"parts": [x.Label for x in objs], "outside_mm": [round(ox, 2), round(oy, 2), round(oz + ld, 2)], "board_mm": [round(bb.XLength, 2), round(bb.YLength, 2), round(bb.ZLength, 2)], "holes": holes}))
