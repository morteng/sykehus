"""The hospital block as its wings: puts the parts of the 1:1000 site plan (tools/wingparts.py), joined wing by wing as
tools/wings.json names them, into site.json in place of the OSM buildings they replace (the block as one relation,
the high-rise, and a few small buildings the plan draws). Each wing is a building of its own, with the same base
and top rules as tools/site.mjs (base: the lowest terrain at its corners; top: the median of the upper half of the
laser surface over it, where that stands more than 2 m over the ground), and its name, years and sources.

  python -I tools/wings.py <site.json> <parts.json> <tools/wings.json> <dom.tif> <dtm.tif> <x0,y0,x1,y1>

Then run tools/massing.py again, so each wing gets its own roof levels. Needs shapely."""
import sys, os, json
import numpy as np
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # our own tools, not the data's folder
from laser import tiff, inside

site_f, parts_f, wings_f, dom_f, dtm_f, box = sys.argv[1:7]
site, parts, W = json.load(open(site_f)), {p["part"]: p for p in json.load(open(parts_f))}, json.load(open(wings_f))
X0, Y0, X1, Y1 = [float(v) for v in box.split(",")]; OX, OY = site["origin"]
dom, dtm = tiff(dom_f).astype(float), tiff(dtm_f).astype(float); RES = (X1 - X0) / dom.shape[1]
def at(g, x, y):
    c = np.floor((np.asarray(x) + OX - X0) / RES).astype(int); r = np.floor((Y1 - (np.asarray(y) + OY)) / RES).astype(int)
    ok = (c >= 0) & (r >= 0) & (c < g.shape[1]) & (r < g.shape[0]); v = np.full(c.shape, np.nan); v[ok] = g[r[ok], c[ok]]; v[v < -1000] = np.nan; return v

keep = [b for b in site["buildings"] if b["id"] not in W["replaces"]]
new = []
for w in W["wings"]:
    shape = unary_union([Polygon(parts[n]["ring"]).buffer(0.4, join_style="mitre") for n in w["parts"]]).buffer(-0.4, join_style="mitre")   # parts drawn a hair apart join
    polys = list(shape.geoms) if isinstance(shape, MultiPolygon) else [shape]
    for i, g in enumerate(sorted(polys, key=lambda g: -g.area)):
        g = g.simplify(0.05); ring = [[round(x, 2), round(y, 2)] for x, y in g.exterior.coords]
        xs, ys = np.array([p[0] for p in ring]), np.array([p[1] for p in ring])
        gx, gy = np.meshgrid(np.arange(xs.min() + 0.5, xs.max(), 1.0), np.arange(ys.min() + 0.5, ys.max(), 1.0))
        m = inside(gx, gy, ring)
        for h in g.interiors: m &= ~inside(gx, gy, list(h.coords))
        s, t = at(dom, gx[m], gy[m]), at(dtm, gx[m], gy[m]); up = np.sort(s[(s - t) > 2])
        grounds = at(dtm, xs, ys); base = float(np.nanmin(grounds))
        top = float(np.median(up[len(up) // 2:])) if len(up) else None
        b = {"id": w["id"] + (f"-{i + 1}" if len(polys) > 1 else ""), "type": "hospital", "own": True, "ring": ring,
             "base": round(base, 2), "top": round(top, 2) if top and top - base > 2 else None, "area_m2": round(g.area),
             "wing": w["id"], "name": w["name"], "source": W["source"]}
        if g.interiors: b["cut"] = [[[round(x, 2), round(y, 2)] for x, y in h.coords] for h in g.interiors]
        new.append(b)
site["buildings"] = keep + new
# sources as the page shows them: the document's title and year and its link, from docs/documents.tsv
docs = {}
for line in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "documents.tsv"), encoding="utf-8").read().splitlines()[1:]:
    c = line.split("\t"); docs[c[0]] = {"title": c[1], "year": c[3], "url": c[6] if len(c) > 6 else ""}
def source(s):
    did, _, rest = s.partition(" "); did, _, page = did.partition("#p"); d = docs.get(did)
    if not d: return {"title": s}
    return {"id": did, "title": d["title"], "year": d["year"], "page": int(page) if page else None, "url": d["url"], "note": rest or None}
site["wings"] = [{**{k: w[k] for k in w if k not in ("parts", "src")}, "sources": [source(x) for x in w["src"]]} for w in W["wings"]]
json.dump(site, open(site_f, "w"), separators=(",", ":"), ensure_ascii=False)
for b in new: print(f'{b["id"]:24} {b["area_m2"]:6} m2  base +{b["base"]:.2f}  top {"+%.2f" % b["top"] if b["top"] else "-"}')
