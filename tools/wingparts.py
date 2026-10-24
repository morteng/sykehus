"""The parts of the hospital block, as the 1:1000 existing-situation site plan draws them (Ottar 2013, 534362efe171
p1): the block's outline (a light grey fill) cut by the thin black lines inside it into closed parts, placed on the
site by georef.py. A part that only hangs on another by a sliver (two wings with a gap drawn between them) is split
where it narrows below 2 m.

  python -I tools/wingparts.py <sit.json from pdfpaths.py> <georef.json> <out.json> [out.png]

out.json: [{"part": n, "ring": [[x, y], ...] in site metres, "area_m2"}], largest first. Which wing each part is
belongs in tools/wings.json, by hand, from the documents. Needs shapely."""
import sys, json, math
from shapely.geometry import Polygon, LineString
from shapely.ops import polygonize, unary_union

sit_f, geo_f, out_f = sys.argv[1:4]
png = sys.argv[4] if len(sys.argv) > 4 else None
sit, geo = json.load(open(sit_f)), json.load(open(geo_f))
m, th, (sx, sy) = geo["m_per_pt"], geo["theta"], geo["shift"]
c, s = math.cos(th), math.sin(th)
to_site = lambda p: (p[0] * m * c - p[1] * m * s + sx, p[0] * m * s + p[1] * m * c + sy)

fills = [sh for sh in sit["shapes"] if sh["k"] != "stroke" and sh["fill"] and abs(sh["fill"][0] - 0.949) < 0.01]
block = unary_union([Polygon([to_site(p) for p in sh["p"][0]]).buffer(0) for sh in fills])
lines = [LineString([to_site(p) for p in r]) for sh in sit["shapes"]
         if sh["k"] == "stroke" and sh["stroke"] and len(sh["stroke"]) == 3 and max(sh["stroke"]) < 0.05 for r in sh["p"] if len(r) > 1]
inner = [l for l in lines if block.buffer(0.3).contains(l)]
def longer(l, d=0.6):   # a line drawn to stop just short of the outline still closes its part
    q = list(l.coords)
    def ext(a, b):
        L = math.dist(a, b) or 1; return (a[0] + (a[0] - b[0]) / L * d, a[1] + (a[1] - b[1]) / L * d)
    return LineString([ext(q[0], q[1]), *q[1:-1], ext(q[-1], q[-2])]) if len(q) > 1 else l
inner = [longer(l).intersection(block.buffer(0.01)) for l in inner]
faces = [f for f in polygonize(unary_union([block.boundary, *inner])) if block.buffer(0.3).contains(f.representative_point()) and f.area > 4]
# a part joined to another only through a sliver (a gap between two wings drawn as one face): split at the neck
def necks(f):
    core = f.buffer(-1.0)
    if core.geom_type != "MultiPolygon": return [f]
    pieces = [f.intersection(c.buffer(1.0)) for c in core.geoms]
    rest = f.difference(unary_union(pieces))
    pieces = [pc.union(rest.intersection(pc.buffer(0.6))) for pc in pieces]
    return [g for pc in pieces for g in getattr(pc, "geoms", [pc]) if g.geom_type == "Polygon" and g.area > 4]
faces = [g for f in faces for g in necks(f)]
faces.sort(key=lambda f: -f.area)
out = [{"part": i + 1, "ring": [[round(x, 2), round(y, 2)] for x, y in f.exterior.coords], "area_m2": round(f.area, 1)} for i, f in enumerate(faces)]
json.dump(out, open(out_f, "w"))
print(len(inner), "inner lines,", len(out), "parts,", round(sum(p["area_m2"] for p in out)), "m2 (block", round(block.area), "m2)")

if png:
    from PIL import Image, ImageDraw
    xs = [x for p in out for x, _ in p["ring"]]; ys = [y for p in out for _, y in p["ring"]]
    x0, y0, k = min(xs) - 5, max(ys) + 5, 8
    im = Image.new("RGB", (int((max(xs) - x0 + 5) * k), int((y0 - min(ys) + 5) * k)), "white"); d = ImageDraw.Draw(im)
    T = lambda p: ((p[0] - x0) * k, (y0 - p[1]) * k)
    for p in out:
        h = p["part"] * 0.618 % 1; d.polygon([T(q) for q in p["ring"]], fill=tuple(int(150 + 100 * v) for v in (abs(h * 6 - 3) - 1, 2 - abs(h * 6 - 2), 2 - abs(h * 6 - 4))), outline=(176, 18, 43), width=2)
        cx, cy = Polygon(p["ring"]).representative_point().coords[0]
        d.text(T((cx, cy)), f'{p["part"]}\n{p["area_m2"]:.0f}', fill="black", font_size=22)
    im.save(png)
