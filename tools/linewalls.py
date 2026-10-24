"""Walls of a plan drawn in lines, not filled (the fire plans, BR-05 and BR-06): each wall is two black lines side by
side, its two faces. Pairs them into wall shapes and writes them as tools/pdfpaths.py writes filled walls (page
points, origin bottom left, y up; fill grey), so georef.py and floors.mjs take them as they take a filled plan.

  python -I tools/linewalls.py <file.pdf> <page 1..> <scale, e.g. 200> <out.json> [x0,y0,x1,y1 page region, y down]

A pair: two black lines along the sheet's axes, 7 to 65 cm apart (at the drawing's scale), running side by side for
at least 50 cm; the wall is the stretch they share. A line with no partner (a door leaf, a fixture) is left out, and
so are the colours (fire cells red, escape routes green, hatching blue, furniture brown or grey). The PDF is data:
PyMuPDF reads it, nothing in it runs."""
import sys, json
import pymupdf

pdf, pageno, scale, out = sys.argv[1], int(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
region = [float(v) for v in sys.argv[5].split(",")] if len(sys.argv) > 5 else None
pg = pymupdf.open(pdf)[pageno - 1]; H = pg.rect.height
m = 0.0254 / 72 * scale; tmin, tmax, lmin = 0.07 / m, 0.65 / m, 0.5 / m

# the black lines along the axes: horizontal ones as (y, x0, x1), vertical ones as (x, y0, y1)
hs, vs = [], []
for d in pg.get_drawings():
    c = d.get("color")
    if c is None or max(c) > 0.05 or "s" not in d["type"]: continue
    segs = []
    for it in d["items"]:
        if it[0] == "l": segs.append((it[1], it[2]))
        elif it[0] == "re": r = it[1]; segs += [(r.tl, r.tr), (r.tr, r.br), (r.br, r.bl), (r.bl, r.tl)]
    for a, b in segs:
        if region and not all(region[0] <= p.x <= region[2] and region[1] <= p.y <= region[3] for p in (a, b)): continue
        if abs(a.y - b.y) < 0.05 and abs(a.x - b.x) >= lmin * 0.5: hs.append((a.y, min(a.x, b.x), max(a.x, b.x)))
        elif abs(a.x - b.x) < 0.05 and abs(a.y - b.y) >= lmin * 0.5: vs.append((a.x, min(a.y, b.y), max(a.y, b.y)))

def pairs(lines):
    """the walls between neighbouring parallel lines: for each line, the nearest partner on each side that runs
    beside it for lmin or more"""
    lines = sorted(set((round(c, 2), round(a, 2), round(b, 2)) for c, a, b in lines)); out = set()
    for i, (c, a, b) in enumerate(lines):
        best = None
        for j in range(i + 1, len(lines)):
            c2, a2, b2 = lines[j]
            if c2 - c > tmax: break
            if c2 - c < tmin: continue
            lo, hi = max(a, a2), min(b, b2)
            if hi - lo >= lmin: best = (c2, lo, hi); break   # the nearest one beside it
        if best: out.add((c, best[0], best[1], best[2]))
    return out

shapes = []
ring = lambda pts: [[round(x, 2), round(H - y, 2)] for x, y in pts]
for c0, c1, lo, hi in pairs(hs): shapes.append(ring([(lo, c0), (hi, c0), (hi, c1), (lo, c1), (lo, c0)]))
for c0, c1, lo, hi in pairs(vs): shapes.append(ring([(c0, lo), (c1, lo), (c1, hi), (c0, hi), (c0, lo)]))
json.dump({"file": pdf.split("/")[-1], "page": pageno, "w": pg.rect.width, "h": H, "shapes": [{"k": "fill", "fill": [0.5], "p": [r]} for r in shapes]}, open(out, "w"))
print(f"{len(hs)} + {len(vs)} lines, {len(shapes)} walls", file=sys.stderr)
