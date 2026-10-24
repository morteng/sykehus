"""Clean massing for the buildings on the lot: flat-roofed blocks on each building's own grid, in place of the roof
drawn from laser cells. Writes them into site.json (buildings[].blocks).

  python3 -I tools/massing.py <site.json> <dom.tif> <x0,y0,x1,y1>

For each building: its grid is the direction of its longest outline edges (the hospital's wings share one, -32.6
degrees). The laser surface (DOM, 1 m, EPSG:25833 over the box) is sampled on a 1 m grid turned to it, inside the
outline and outside the building:parts on it. The heights found most often become the building's roof levels (at
least 2 m apart, each over at least 25 m2); every cell takes the nearest level, a majority filter takes out roof
plant and chimneys, patches under 20 m2 join their neighbours, and each level is cut into rectangles. A block is
one rectangle of roof: corners in site metres and its kote. Walls stand only where the roof steps down or the
building ends (buildings[].walls: from, to, bottom kote or null for the ground, top kote), so a cut through the
building shows its outer walls and not the joins between blocks."""
import sys, json, math, struct
import numpy as np

site_f, dom_f, box = sys.argv[1], sys.argv[2], [float(v) for v in sys.argv[3].split(",")]
site = json.load(open(site_f)); X0, Y0, X1, Y1 = box; OX, OY = site["origin"]

def tiff(path):
    b = open(path, "rb").read(); e = "<" if b[:2] == b"II" else ">"
    ifd = struct.unpack(e + "I", b[4:8])[0]; n = struct.unpack(e + "H", b[ifd:ifd + 2])[0]; tags = {}
    for i in range(n):
        o = ifd + 2 + i * 12; tag, typ, cnt = struct.unpack(e + "HHI", b[o:o + 8]); sz = {3: 2, 4: 4}.get(typ, 1)
        at = struct.unpack(e + "I", b[o + 8:o + 12])[0] if cnt * sz > 4 else o + 8
        if typ in (3, 4): tags[tag] = [struct.unpack(e + ("H" if typ == 3 else "I"), b[at + k * sz:at + k * sz + sz])[0] for k in range(cnt)]
    w, h = tags[256][0], tags[257][0]
    if tags.get(259, [1])[0] != 1: sys.exit("compressed TIFF")
    if 273 in tags: return np.frombuffer(b"".join(b[o:o + c] for o, c in zip(tags[273], tags[279]))[:w * h * 4], dtype=e + "f4").reshape(h, w)
    tw, th = tags[322][0], tags[323][0]; across = (w + tw - 1) // tw; out = np.zeros((h, w), np.float32)
    for i, o in enumerate(tags[324]):
        tx, ty = (i % across) * tw, (i // across) * th; t = np.frombuffer(b[o:o + tw * th * 4], dtype=e + "f4").reshape(th, tw)
        out[ty:ty + th, tx:tx + tw] = t[:min(th, h - ty), :min(tw, w - tx)]
    return out

dom = tiff(dom_f); RES = (X1 - X0) / dom.shape[1]
def dom_at(x, y):  # x, y in site metres, arrays
    c = np.floor((x + OX - X0) / RES).astype(int); r = np.floor((Y1 - (y + OY)) / RES).astype(int)
    ok = (c >= 0) & (r >= 0) & (c < dom.shape[1]) & (r < dom.shape[0])
    v = np.full(x.shape, np.nan); v[ok] = dom[r[ok], c[ok]]; v[v < -1000] = np.nan; return v

def inside(px, py, ring):
    r = np.array(ring); o = np.zeros(px.shape, bool); j = len(r) - 1
    for i in range(len(r)):
        (a, b), (e, f) = r[i], r[j]
        if b != f: o ^= ((b > py) != (f > py)) & (px < (e - a) * (py - b) / (f - b) + a)
        j = i
    return o

def grid_angle(ring):
    h = np.zeros(90)
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]): h[int(math.degrees(math.atan2(y1 - y0, x1 - x0)) % 90)] += math.hypot(x1 - x0, y1 - y0)
    h = np.convolve(np.r_[h[-2:], h, h[:2]], np.ones(5), "same")[2:-2]
    return math.radians(float(np.argmax(h)))

def components(mask):
    lab = np.zeros(mask.shape, int); n = 0
    for s in zip(*np.nonzero(mask)):
        if lab[s]: continue
        n += 1; stack = [s]; lab[s] = n
        while stack:
            i, j = stack.pop()
            for a, b in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                if 0 <= a < mask.shape[0] and 0 <= b < mask.shape[1] and mask[a, b] and not lab[a, b]: lab[a, b] = n; stack.append((a, b))
    return lab, n

def rectangles(mask):
    """greedy: the longest run in the first row left, grown down while every row below has it"""
    m = mask.copy(); out = []
    for i in range(m.shape[0]):
        j = 0
        while j < m.shape[1]:
            if not m[i, j]: j += 1; continue
            k = j
            while k < m.shape[1] and m[i, k]: k += 1
            d = i + 1
            while d < m.shape[0] and m[d, j:k].all(): d += 1
            m[i:d, j:k] = False; out.append((i, j, d, k)); j = k
    return out

total = 0
for b in site["buildings"]:
    if not b.get("own") or b.get("top") is None: b.pop("blocks", None); continue
    ring, cuts = b["ring"], b.get("cut") or []
    th = grid_angle(ring); c, s = math.cos(th), math.sin(th)
    U = [x * c + y * s for x, y in ring]; V = [-x * s + y * c for x, y in ring]
    u0, v0 = math.floor(min(U)) - 1, math.floor(min(V)) - 1; nu, nv = int(max(U) - u0) + 3, int(max(V) - v0) + 3
    uu, vv = np.meshgrid(u0 + np.arange(nu) + 0.5, v0 + np.arange(nv) + 0.5)          # rows: v, columns: u
    px, py = uu * c - vv * s, uu * s + vv * c
    inn = inside(px, py, ring)
    for q in cuts: inn &= ~inside(px, py, q)
    z = dom_at(px, py); inn &= ~np.isnan(z)
    if inn.sum() < 4: b.pop("blocks", None); continue
    # roof levels: the most frequent heights (0.25 m bins), at least 2 m apart and 25 m2 each, highest support first
    hz = z[inn]; bins = np.arange(b["base"] + 2, hz.max() + 0.5, 0.25)
    if len(bins) < 2: b.pop("blocks", None); continue
    hist, edges = np.histogram(hz, bins)
    if len(hist) > 5: hist = np.convolve(hist, np.ones(5), "same")
    levels = []
    for k in np.argsort(-hist):
        lv = (edges[k] + edges[k + 1]) / 2
        if any(abs(lv - l) < 2.0 for l in levels): continue
        if (np.abs(hz - lv) < 0.75).sum() < 25: continue
        levels.append(lv)
        if len(levels) >= 8: break
    if not levels: levels = [float(np.median(hz[hz > b["base"] + 2])) if (hz > b["base"] + 2).any() else b["top"]]
    L = np.array(sorted(levels)); lab = np.full(z.shape, -1)
    # a cell barely above the ground inside the outline is a yard or a passage: no block
    lab[inn] = np.abs(z[inn][:, None] - L[None, :]).argmin(1); lab[inn & (z < b["base"] + 2)] = -1
    # majority filter, twice: roof plant, chimneys and edge noise take their surroundings' level
    for _ in range(2):
        new = lab.copy()
        for i in range(lab.shape[0]):
            for j in range(lab.shape[1]):
                if not inn[i, j]: continue
                w = lab[max(0, i - 1):i + 2, max(0, j - 1):j + 2].ravel(); w = w[w >= 0]
                if len(w): vals, cnt = np.unique(w, return_counts=True); new[i, j] = vals[cnt.argmax()] if cnt.max() >= 5 else lab[i, j]
        lab = new
    # patches under 20 m2 join the level around them most
    for k in range(len(L)):
        comp, n = components(lab == k)
        for q in range(1, n + 1):
            cell = comp == q
            if cell.sum() >= 20: continue
            ring_ = np.zeros_like(cell); ring_[1:] |= cell[:-1]; ring_[:-1] |= cell[1:]; ring_[:, 1:] |= cell[:, :-1]; ring_[:, :-1] |= cell[:, 1:]
            nb = lab[ring_ & ~cell & inn]; nb = nb[nb != k]
            if len(nb): lab[cell] = np.bincount(nb[nb >= 0]).argmax() if (nb >= 0).any() else -1
    blocks = []
    for k, lv in enumerate(L):
        for i0, j0, i1, j1 in rectangles(lab == k):
            corners = [(u0 + j0, v0 + i0), (u0 + j1, v0 + i0), (u0 + j1, v0 + i1), (u0 + j0, v0 + i1)]
            blocks.append({"p": [[round(u * c - v * s, 2), round(u * s + v * c, 2)] for u, v in corners], "top": round(float(lv), 2)})
    # walls: every cell edge with a higher level on one side, joined along their line
    H = np.where(lab >= 0, np.array([*L, 0.0])[lab], np.nan)
    def runs(hi, lo, line, along, horizontal):
        out, k = [], 0
        while k < len(hi):
            if np.isnan(hi[k]) or (not np.isnan(lo[k]) and lo[k] >= hi[k]): k += 1; continue
            m = k
            while m + 1 < len(hi) and hi[m + 1] == hi[k] and (lo[m + 1] == lo[k] or (np.isnan(lo[m + 1]) and np.isnan(lo[k]))): m += 1
            a, z = (along + k, line), (along + m + 1, line)
            if not horizontal: a, z = (line, along + k), (line, along + m + 1)
            out.append((a, z, None if np.isnan(lo[k]) else float(lo[k]), float(hi[k]))); k = m + 1
        return out
    P = np.pad(H, 1, constant_values=np.nan); segs = []
    for i in range(H.shape[0] + 1):            # edges between rows i-1 and i, at v = v0 + i
        up, dn = P[i, 1:-1], P[i + 1, 1:-1]
        segs += runs(dn, up, v0 + i, u0, True) + [(z, a, lo, hi) for a, z, lo, hi in runs(up, dn, v0 + i, u0, True)]
    for j in range(H.shape[1] + 1):            # edges between columns j-1 and j, at u = u0 + j
        lf, rt = P[1:-1, j], P[1:-1, j + 1]
        segs += runs(rt, lf, u0 + j, v0, False) + [(z, a, lo, hi) for a, z, lo, hi in runs(lf, rt, u0 + j, v0, False)]
    xy = lambda q: [round(q[0] * c - q[1] * s, 2), round(q[0] * s + q[1] * c, 2)]
    b["walls"] = [[*xy(a), *xy(z), None if lo is None else round(lo, 2), round(hi, 2)] for a, z, lo, hi in segs]
    b["blocks"] = blocks; b["grid_deg"] = round(math.degrees(th), 1); total += len(blocks)
    print(f"{b['id']}: grid {math.degrees(th):.1f} deg, levels {', '.join(f'{l:.1f}' for l in L)}, {len(blocks)} blocks")
json.dump(site, open(site_f, "w"), separators=(",", ":"))
print(total, "blocks")
