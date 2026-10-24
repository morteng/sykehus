"""The trees around the hospital, from the laser: where the surface (DOM) stands 4 m or more over the ground (DTM)
outside every building, the highest point of each crown is a tree. Writes site.json trees: [x, y, height, crown
radius, form] in site metres, form "cone" for a crown much narrower than it is tall (spruce, pine), else "round".

  python3 -I tools/trees.py <site.json> <dom.tif> <dtm.tif> <x0,y0,x1,y1>

A crown is the canopy cells nearest to its top (within 9 m); a top needs the highest cell in a window that grows
with the tree, and 8 m2 of crown, so lamp posts, lines and roof edges are left out."""
import sys, os, json, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # our own tools, not the data's folder
from laser import tiff, inside

site_f, dom_f, dtm_f, box = sys.argv[1], sys.argv[2], sys.argv[3], [float(v) for v in sys.argv[4].split(",")]
site = json.load(open(site_f)); X0, Y0, X1, Y1 = box; OX, OY = site["origin"]
dom, dtm = tiff(dom_f).astype(float), tiff(dtm_f).astype(float); RES = (X1 - X0) / dom.shape[1]
dom[dom < -1000] = np.nan; dtm[dtm < -1000] = np.nan
H, W = dom.shape
xs = X0 + (np.arange(W) + 0.5) * RES - OX; ys = Y1 - (np.arange(H) + 0.5) * RES - OY
px, py = np.meshgrid(xs, ys)
chm = np.nan_to_num(dom - dtm)
# out of the buildings, with a 2 m margin so eaves and walls do not count
built = np.zeros(chm.shape, bool)
for b in site["buildings"]:
    r = np.array(b["ring"]); c = r.mean(0)
    grown = [list(c + (p - c) * (1 + 2.0 / max(1.0, np.linalg.norm(p - c)))) for p in r]
    m = (px >= r[:, 0].min() - 3) & (px <= r[:, 0].max() + 3) & (py >= r[:, 1].min() - 3) & (py <= r[:, 1].max() + 3)
    if m.any(): built[m] |= inside(px[m], py[m], grown)
canopy = (chm >= 3.0) & ~built
# smooth a little, then the tops: highest in a window of 2 m plus a tenth of the height
pad = np.pad(chm, 1, mode="edge"); sm = sum(pad[1 + i:1 + i + H, 1 + j:1 + j + W] for i in (-1, 0, 1) for j in (-1, 0, 1)) / 9
tops = []
for r, c in zip(*np.nonzero(canopy & (sm >= 4.0))):
    k = int(round((2 + sm[r, c] * 0.1) / RES))
    win = sm[max(0, r - k):r + k + 1, max(0, c - k):c + k + 1]
    if sm[r, c] >= win.max() - 1e-6: tops.append((r, c))
# crowns: each canopy cell to the nearest top within 9 m
tops = sorted(set(tops)); T = np.array(tops)
area = np.zeros(len(tops)); cr, cc = np.nonzero(canopy)
for s in range(0, len(cr), 20000):
    d = (cr[s:s + 20000, None] - T[None, :, 0]) ** 2 + (cc[s:s + 20000, None] - T[None, :, 1]) ** 2
    near = d.argmin(1); ok = d[np.arange(len(near)), near] <= (9 / RES) ** 2
    np.add.at(area, near[ok], RES * RES)
trees = []
for (r, c), a in zip(tops, area):
    if a < 8: continue
    h = float(chm[r, c]); rad = min(9.0, max(1.5, math.sqrt(a / math.pi)))
    trees.append([round(float(xs[c]), 1), round(float(ys[r]), 1), round(h, 1), round(rad, 1), "cone" if rad < 0.22 * h else "round"])
site["trees"] = trees
json.dump(site, open(site_f, "w"), separators=(",", ":"))
print(len(trees), "trees,", sum(t[4] == "cone" for t in trees), "cone; heights", f"{min(t[2] for t in trees):.0f}-{max(t[2] for t in trees):.0f} m" if trees else "")
