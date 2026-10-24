"""Room outlines for the room stamps of floors.json: the space between the drawn walls around each stamp, and its area
computed, to stand beside the area the architect wrote.

  python -I tools/roompoly.py public/data/floors.json public/data/site.json [--check]

Per floor, the walls are drawn on a 10 cm raster with the wings' outlines (the windows are gaps in a plan's walls) and
thickened by 0.45 m, so a door (0.9 m or less) closes; from each
stamp the free space is filled; the region is grown back by the same 0.45 m, inside the walls, and kept as the room's
'poly' (site metres) with 'area_calc' (m2). A fill that runs out of the drawing or over 600 m2 found no closed room
(a corridor, an open plan, a wall missing on the sheet) and is left without, as is a space that holds two stamps.
The walls of every sheet of the storey count. Run after tools/floors.mjs. With --check:
how the computed areas compare with the stamped ones. Needs Pillow, numpy and shapely."""
import sys, json, math
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

RES, CLOSE, MAXA = 0.1, 0.45, 600.0

def grow(mask, r):   # r cells out each way (a square)
    m = mask.copy()
    for k in range(1, r + 1):
        m[k:, :] |= mask[:-k, :]; m[:-k, :] |= mask[k:, :]
    n = m.copy()
    for k in range(1, r + 1):
        n[:, k:] |= m[:, :-k]; n[:, :-k] |= m[:, k:]
    return n

why = {}
def rooms_of(floor, outlines, more=()):
    """more: the walls of the other sheets of the same storey (each sheet draws the wings it shows best)"""
    walls = [w for w in list(floor["walls"]) + [w for g in more for w in g["walls"]] if len(w) >= 3]
    rooms = floor["rooms"]
    if not walls or not rooms: return 0
    xs = [p[0] for w in walls for p in w]; ys = [p[1] for w in walls for p in w]
    x0, y0, x1, y1 = min(xs) - 2, min(ys) - 2, max(xs) + 2, max(ys) + 2
    W, H = int((x1 - x0) / RES) + 1, int((y1 - y0) / RES) + 1
    px = lambda p: ((p[0] - x0) / RES, (y1 - p[1]) / RES)
    im = Image.new("L", (W, H), 0); d = ImageDraw.Draw(im)
    for w in walls: d.polygon([px(p) for p in w], fill=255)
    for o in outlines: d.line([px(p) for p in o] + [px(o[0])], fill=255, width=3)
    wall = np.array(im) > 0
    shut = grow(wall, int(round(CLOSE / RES)))
    n = 0
    for r in rooms:
        r.pop("poly", None); r.pop("area_calc", None)
        cx, cy = (int(v) for v in px(r["at"]))
        # the stamp's left edge sits at the name's baseline: start a little up and right of it, in free space
        seeds = [(cx + dx, cy - dy) for dy in (3, 6, 1, 10) for dx in (8, 3, 15, 25)]
        seed = next(((a, b) for a, b in seeds if 0 <= a < W and 0 <= b < H and not shut[b, a]), None)
        if not seed: why["seed"] = why.get("seed", 0) + 1; continue
        fill = Image.fromarray(np.where(shut, 255, 0).astype(np.uint8)).copy()   # a copy: a fill on the array view is lost
        ImageDraw.floodfill(fill, seed, 128)
        reg = np.array(fill) == 128
        if reg[0].any() or reg[-1].any() or reg[:, 0].any() or reg[:, -1].any(): why["out"] = why.get("out", 0) + 1; continue   # ran out of the drawing
        if reg.sum() * RES * RES > MAXA: why["big"] = why.get("big", 0) + 1; continue
        others = [q for q in rooms if q is not r and (lambda a, b: 0 <= a < W and 0 <= b < H and reg[b, a])(*(int(v) for v in px(q["at"])))]
        if others: why["shared"] = why.get("shared", 0) + 1; continue          # two stamps in one space: a wall the sheet leaves out
        reg = grow(reg, int(round(CLOSE / RES)) + 2) & ~wall   # back out to the walls (two cells more: the fill stops one short of the thickened edge)
        # the region as a polygon: its rows' runs, joined
        rects = []
        for i in np.nonzero(reg.any(1))[0]:
            row = np.r_[0, reg[i].astype(np.int8), 0]; edges = np.flatnonzero(np.diff(row))
            for a, b in zip(edges[::2], edges[1::2]):
                rects.append(box(x0 + a * RES, y1 - (i + 1) * RES, x0 + b * RES, y1 - i * RES))
        g = unary_union(rects)
        if g.geom_type == "MultiPolygon": g = max(g.geoms, key=lambda q: q.area)
        g = g.simplify(0.12)
        if g.is_empty or g.area < 1.0: continue
        r["poly"] = [[round(x, 2), round(y, 2)] for x, y in g.exterior.coords]
        r["area_calc"] = round(g.area, 1)
        n += 1
    return n

floors_f, site_f = sys.argv[1:3]
F, site = json.load(open(floors_f)), json.load(open(site_f))
outlines = [b["ring"] for b in site["buildings"] if b.get("wing")]
why = {}
for f in F["floors"]:
    n = rooms_of(f, outlines, [g for g in F["floors"] if g is not f and g["name"] == f["name"]])
    stamped = [r for r in f["rooms"] if r.get("area_m2") and r.get("area_calc")]
    err = sorted(abs(r["area_calc"] - r["area_m2"]) / r["area_m2"] for r in stamped)
    print(f'{f["id"]}: {n} of {len(f["rooms"])} rooms outlined' + (f'; against {len(err)} stamps: median {100 * err[len(err) // 2]:.0f} % off, {sum(e < 0.1 for e in err)} within 10 %' if err else ""))
    if "--check" in sys.argv:
        for r in stamped: print(f'   {r.get("code") or "":10} {r["name"][:24]:24} stamp {r["area_m2"]:7.1f}  calc {r["area_calc"]:7.1f}')
print("not outlined:", why)
json.dump(F, open(floors_f, "w"), separators=(",", ":"), ensure_ascii=False)
