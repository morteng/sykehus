"""Room outlines for the room stamps of floors.json: the space between the drawn walls around each stamp, and its area
computed, to stand beside the area the architect wrote.

  python -I tools/roompoly.py public/data/floors.json public/data/site.json [--check]

Per floor, the walls are drawn on a 10 cm raster with the wings' outlines (the windows are gaps in a plan's walls) and
thickened by 0.45 m, so a door (0.9 m or less) closes; from each
stamp the free space is filled; the region is grown back by the same 0.45 m, inside the walls, and kept as the room's
'poly' (site metres) with 'area_calc' (m2). A fill that runs out of the drawing or over 600 m2 found no closed room
(a corridor, an open plan, a wall missing on the sheet) and is left without, as is a space that holds two stamps.
The walls of every sheet of the storey count. Those left are then shared out (see the end of rooms_of), marked
'poly_how': "delt", and kept only where the stamped areas bear them out. Run after tools/floors.mjs. With --check:
how the computed areas compare with the stamped ones. Needs Pillow, numpy and shapely."""
import sys, json, math
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

RES, CLOSE, MAXA, SHARE = 0.1, 0.45, 600.0, 8.0

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
        r.pop("poly", None); r.pop("area_calc", None); r.pop("poly_how", None)
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
    # the rest (a fill that ran out through a gap in the traced walls, or two stamps in one space): the free space
    # inside the wings is shared out, each cell to the stamp nearest it walking round the walls, at most SHARE metres
    # out; outlines found so far are kept as they are. Such an outline is marked 'poly_how': "delt", roughly drawn.
    left = [r for r in rooms if "poly" not in r]
    if not left: return n
    inner = Image.new("L", (W, H), 0); di = ImageDraw.Draw(inner)
    for o in outlines: di.polygon([px(p) for p in o], fill=255)
    free = ~shut & (np.array(inner) > 0); free[[0, -1], :] = False; free[:, [0, -1]] = False   # the edge: np.roll wraps
    lab = np.zeros((H, W), np.int32)
    for i, r in enumerate(rooms, 1):
        if "poly" in r:   # a closed room holds its own cells
            one = Image.new("L", (W, H), 0); ImageDraw.Draw(one).polygon([px(p) for p in r["poly"]], fill=255)
            lab[np.array(one) > 0] = -i
    for i, r in enumerate(rooms, 1):
        if "poly" in r: continue
        cx, cy = (int(v) for v in px(r["at"]))
        seeds = [(cx + dx, cy - dy) for dy in (3, 6, 1, 10) for dx in (8, 3, 15, 25)]
        seed = next(((a, b) for a, b in seeds if 0 <= a < W and 0 <= b < H and free[b, a] and lab[b, a] == 0), None)
        if seed: lab[seed[1], seed[0]] = i
    for _ in range(int(SHARE / RES)):   # one cell a step, the four ways, a cell to the first that reaches it
        grown = lab.copy()
        for sh in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nb = np.roll(lab, sh, axis=(0, 1)); take = (grown == 0) & free & (nb > 0); grown[take] = nb[take]
        if (grown == lab).all(): break
        lab = grown
    for i, r in enumerate(rooms, 1):
        if "poly" in r: continue
        reg = lab == i
        if reg.sum() * RES * RES < 2.0: continue
        reg = (grow(reg, int(round(CLOSE / RES)) + 2) & ~wall & (lab == 0)) | reg   # out to the walls, not into a neighbour
        rects = []
        for k in np.nonzero(reg.any(1))[0]:
            row = np.r_[0, reg[k].astype(np.int8), 0]; edges = np.flatnonzero(np.diff(row))
            for a, b in zip(edges[::2], edges[1::2]):
                rects.append(box(x0 + a * RES, y1 - (k + 1) * RES, x0 + b * RES, y1 - k * RES))
        g = unary_union(rects)
        if g.geom_type == "MultiPolygon": g = max(g.geoms, key=lambda q: q.area)
        g = g.simplify(0.12)
        if g.is_empty or g.area < 2.0 or g.area > MAXA: continue
        r["poly"] = [[round(x, 2), round(y, 2)] for x, y in g.exterior.coords]
        r["area_calc"] = round(g.area, 1); r["poly_how"] = "delt"
    # sharing out is only as good as the walls: kept where the stamps bear it out. A shared room with a stamped area
    # stays if it is within 25 % of it; one without stays only on a sheet where at least five shared rooms were checked
    # so and the middle one is within 20 %.
    shared = [r for r in rooms if r.get("poly_how") == "delt"]
    err = sorted(abs(r["area_calc"] - r["area_m2"]) / r["area_m2"] for r in shared if r.get("area_m2"))
    sheet_ok = len(err) >= 5 and err[len(err) // 2] <= 0.2
    for r in shared:
        if (abs(r["area_calc"] - r["area_m2"]) / r["area_m2"] <= 0.25) if r.get("area_m2") else sheet_ok:
            why["shared out"] = why.get("shared out", 0) + 1; n += 1
        else:
            for k in ("poly", "area_calc", "poly_how"): r.pop(k)
            why["shared, dropped"] = why.get("shared, dropped", 0) + 1
    return n

floors_f, site_f = sys.argv[1:3]
F, site = json.load(open(floors_f)), json.load(open(site_f))
outlines = [b["ring"] for b in site["buildings"] if b.get("wing")]
why = {}
for f in F["floors"]:
    n = rooms_of(f, outlines, [g for g in F["floors"] if g is not f and g["name"] == f["name"]])
    line = f'{f["id"]}: {n} of {len(f["rooms"])} rooms outlined ({sum(r.get("poly_how") == "delt" for r in f["rooms"])} shared out)'
    for kind in (None, "delt"):   # closed rooms and shared-out ones, each against the stamps
        stamped = [r for r in f["rooms"] if r.get("area_m2") and r.get("area_calc") and r.get("poly_how") == kind]
        err = sorted(abs(r["area_calc"] - r["area_m2"]) / r["area_m2"] for r in stamped)
        if err: line += f'; {kind or "closed"} against {len(err)} stamps: median {100 * err[len(err) // 2]:.0f} % off, {sum(e < 0.1 for e in err)} within 10 %'
    print(line)
    if "--check" in sys.argv:
        for r in f["rooms"]:
            if r.get("area_m2") and r.get("area_calc"): print(f'   {r.get("code") or "":10} {r["name"][:24]:24} stamp {r["area_m2"]:7.1f}  calc {r["area_calc"]:7.1f} {r.get("poly_how", "")}')
print("not outlined:", why)
json.dump(F, open(floors_f, "w"), separators=(",", ":"), ensure_ascii=False)
