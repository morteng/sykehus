"""Windows and doors from vector elevations, placed on the walls they belong to, and the volumes only the elevations
show (tools/elevations.json, by hand: where each drawn facade sits on its sheet and on the site).

  python -I tools/elevations.py <site.json> tools/elevations.json <documents folder> <dom.tif> <x0,y0,x1,y1>

On the sheet, an opening is a cluster of the small axis-aligned rectangles a CAD export draws a window with (frame,
sashes, panes); its outline is the cluster's box, its panes the rectangles inside it. Walls, columns and the
bracing's diagonals are left out by their size and shape. Each opening is written as metres along the wall from its
left end (as one stands outside) and kote: site.json facades[{id, building, name, from, to, openings[{kind, u, z,
panes}], src}]. A volume (the operating module on its frame) becomes a building of its own: a box from 'bottom' to
its laser roof, posts and braces under it. 'levels' (storeys with no plan, kote from a section) go to site.json
levels. Run after tools/wings.py and tools/massing.py; running it again replaces
what it wrote. Needs PyMuPDF."""
import sys, os, json, math
import numpy as np
import pymupdf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # our own tools, not the data's folder
from laser import tiff, inside

site_f, el_f, docs_dir, dom_f, box = sys.argv[1:6]
site, E = json.load(open(site_f)), json.load(open(el_f))
X0, Y0, X1, Y1 = [float(v) for v in box.split(",")]; OX, OY = site["origin"]
dom = tiff(dom_f).astype(float); RES = (X1 - X0) / dom.shape[1]
F = {f["id"]: f for f in E["facades"]}

def frame(f):   # a facade's wall line on the site: given, or set out from another facade's line (u along, out from it)
    if "from" in f: return f["from"], f["to"]
    g = F[f["on"]]; (ax, ay), (bx, by) = frame(g); L = math.dist((ax, ay), (bx, by)); d = ((bx - ax) / L, (by - ay) / L); n = outward(g)
    u = f["u"]; o = f["out"] if isinstance(f["out"], list) else [f["out"], f["out"]]
    at = lambda u, o: [round(ax + d[0] * u + n[0] * o, 2), round(ay + d[1] * u + n[1] * o, 2)]
    return at(u[0], o[0]), at(u[1], o[1])
def outward(f):   # standing outside facing the wall, 'from' is on the left: outside is 'from'→'to' turned a quarter clockwise
    (ax, ay), (bx, by) = frame(f); L = math.dist((ax, ay), (bx, by)); return ((by - ay) / L, -(bx - ax) / L)

def openings(f):
    pg = pymupdf.open(os.path.join(docs_dir, f["doc"] + ".pdf"))[f["page"] - 1]
    m = 0.0254 / 72 * f["scale"]; x0, y0, x1, y1 = f["box"]; e0, e1 = f["ends_pt"]; yl, kl = f["level"]
    rects = []
    for d in pg.get_drawings():
        r = d["rect"]
        if r.x0 < x0 or r.x1 > x1 or r.y0 < y0 or r.y1 > y1: continue
        if any(r.x0 >= s[0] - 0.1 and r.x1 <= s[2] + 0.1 and r.y0 >= s[1] - 0.1 and r.y1 <= s[3] + 0.1 for s in f.get("skip", [])): continue
        if "f" not in d["type"]: continue                                                   # lines and dashes: level lines, outlines
        if not (max(r.width, r.height) * m >= 0.25 and r.width * m <= 4.0 and r.height * m <= 3.2): continue   # frame strips stay, walls go
        if any(it[0] == "l" and abs(it[1].x - it[2].x) > 0.05 and abs(it[1].y - it[2].y) > 0.05 and abs(it[1] - it[2]) * m > 0.5 for it in d["items"]): continue   # a long diagonal: bracing, not a window (frames have short mitres)
        if any(it[0] == "c" for it in d["items"]): continue
        if (r.x0 - e0) * m < 0.2 or (e1 - r.x1) * m < 0.2: continue                        # the wall's own surface, filled white from its end
        rects.append((r.x0, r.y0, r.x1, r.y1))
    # clusters: rectangles that touch or overlap
    parent = list(range(len(rects)))
    def root(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for i, a in enumerate(rects):
        for j in range(i):
            b = rects[j]
            if a[0] <= b[2] + 0.3 and b[0] <= a[2] + 0.3 and a[1] <= b[3] + 0.3 and b[1] <= a[3] + 0.3: parent[root(i)] = root(j)
    groups = {}
    for i, r in enumerate(rects): groups.setdefault(root(i), []).append(r)
    # the sashes of one window stand a hand apart: same height, side by side, less than 0.3 m between them
    gs = list(groups.values()); bb = lambda rs: (min(r[0] for r in rs), min(r[1] for r in rs), max(r[2] for r in rs), max(r[3] for r in rs))
    joined = True
    while joined:
        joined = False
        for i in range(len(gs)):
            for j in range(i):
                a, b = bb(gs[i]), bb(gs[j]); ov = min(a[3], b[3]) - max(a[1], b[1])
                if ov > 0.85 * max(a[3] - a[1], b[3] - b[1]) and max(a[0], b[0]) - min(a[2], b[2]) < 0.3 / m:
                    gs[j] += gs.pop(i); joined = True; break
            if joined: break
    groups = dict(enumerate(gs))
    U = lambda x: round((x - e0) * m, 3); Z = lambda y: round(kl + (yl - y) * m, 3)
    out = []
    for rs in groups.values():
        bx0, by0, bx1, by1 = min(r[0] for r in rs), min(r[1] for r in rs), max(r[2] for r in rs), max(r[3] for r in rs)
        w, h = (bx1 - bx0) * m, (by1 - by0) * m
        if w > 8.0 or h > 14.0 or w < 0.3 or h < 0.3 or Z(by0) > f.get("top", 99) + 0.05: continue   # on the roof: not this wall
        # panes: the rectangles that hold no other one inside (the glass), each once
        panes = sorted({r for r in rs if min(r[2] - r[0], r[3] - r[1]) * m >= 0.15 and
                        not any(q != r and q[0] >= r[0] - 0.05 and q[2] <= r[2] + 0.05 and q[1] >= r[1] - 0.05 and q[3] <= r[3] + 0.05 for q in rs)})
        panes = [p for p in panes if (p[2] - p[0]) * (p[3] - p[1]) < 0.97 * (bx1 - bx0) * (by1 - by0) or len(rs) == 1]
        if not panes: continue                                                              # an outline with no glass: a box on the drawing, not an opening
        kind = ("glazing" if h > 3.2 or w > 4.0 else                                         # glass over more than a storey (the stair towers)
                "door" if h > 1.9 and w < 2.6 and min(abs(Z(by1) - k) for k in (23.54, 27.76, 32.02, 35.52, 38.38, 20.24)) < 0.4 else "window")
        out.append({"kind": kind, "u": [U(bx0), U(bx1)], "z": [Z(by1), Z(by0)], "panes": [[U(p[0]), U(p[2]), Z(p[3]), Z(p[1])] for p in panes]})
    out.sort(key=lambda o: (o["z"][0], o["u"][0]))
    L = (e1 - e0) * m; (ax, ay), (bx, by) = frame(f)
    print(f'{f["id"]:14} {len(out):3} openings ({sum(o["kind"] == "door" for o in out)} doors), drawn {L:.2f} m, on site {math.dist((ax, ay), (bx, by)):.2f} m')
    return out

# what an earlier run wrote goes first
mine = {v["id"] for v in E["volumes"]}
site["buildings"] = [b for b in site["buildings"] if b["id"] not in mine]
site["facades"] = []
for f in E["facades"]:
    a, b = frame(f)
    site["facades"].append({"id": f["id"], "building": f["building"], "name": f["name"], "from": a, "to": b, "openings": openings(f),
                            "src": [f'{f["doc"]}#p{f["page"]} {f["state"]}']})

def at(x, y):
    c = np.floor((np.asarray(x) + OX - X0) / RES).astype(int); r = np.floor((Y1 - (np.asarray(y) + OY)) / RES).astype(int); return dom[r, c]
for v in E["volumes"]:
    g = F[v["on"]]; (ax, ay), (bx, by) = frame(g); L = math.dist((ax, ay), (bx, by)); d = ((bx - ax) / L, (by - ay) / L); n = outward(g)
    P = lambda u, o: [round(ax + d[0] * u + n[0] * o, 2), round(ay + d[1] * u + n[1] * o, 2)]
    (u0, u1), (o0, o1) = v["u"], v["out"]
    ring = [P(u0, o0), P(u1, o0), P(u1, o1), P(u0, o1)]
    if (ring[1][0] - ring[0][0]) * (ring[2][1] - ring[0][1]) - (ring[1][1] - ring[0][1]) * (ring[2][0] - ring[0][0]) < 0: ring.reverse()
    xs, ys = np.array([p[0] for p in ring]), np.array([p[1] for p in ring])
    gx, gy = np.meshgrid(np.arange(xs.min() + 0.5, xs.max(), 1.0), np.arange(ys.min() + 0.5, ys.max(), 1.0)); msk = inside(gx, gy, ring + [ring[0]])
    s = np.sort(at(gx[msk], gy[msk])); top = float(np.median(s[len(s) // 2:])) if v["top"] == "laser" else v["top"]
    ground = [b for b in site["buildings"] if b.get("wing") == g["building"]][0]["base"]
    walls = [[*ring[i], *ring[(i + 1) % 4], v["bottom"], round(top, 2)] for i in range(4)]
    posts = [[*P(u, o), v["posts"]["size"]] for u in v["posts"]["u"] for o in v["posts"]["out"]]
    braces = [[*P(a, v["braces"]["out"]), *P(b, v["braces"]["out"])] for a, b in v["braces"]["between"]]
    site["buildings"].append({"id": v["id"], "type": "hospital", "own": True, "ring": ring + [ring[0]], "base": ground, "top": round(top, 2),
                              "lift": v["bottom"], "area_m2": round((u1 - u0) * (o1 - o0)), "wing": v["wing"], "name": v["name"],
                              "walls": walls, "blocks": [{"p": ring, "top": round(top, 2)}], "posts": posts, "braces": braces, "source": "; ".join(v["src"])})
    print(f'{v["id"]}: {u1 - u0:.2f} x {o1 - o0:.2f} m, underside +{v["bottom"]:.2f}, roof +{top:.2f} (laser), {len(posts)} posts')
lv = E.get("levels")
site["levels"] = [{**l, "wing": lv["wing"], "src": [lv["src"]]} for l in lv["list"]] if lv else []
json.dump(site, open(site_f, "w"), separators=(",", ":"), ensure_ascii=False)
