"""Places a plan drawing on the site: finds the similarity transform (rotation, scale, shift) from page points to site
metres that lays the drawing's walls on the building outlines of site.json.

  python3 -I tools/georef.py <plan.json from pdfpaths.py> <site.json> <scale, e.g. 200> <out.json> [overlay.svg]

1. Walls: the drawing's filled grey shapes (pdfpaths.py), sampled every 0.25 m; the outlines: the lot's buildings, sampled the same.
2. Control points (CP="page_x,page_y,site_x,site_y;...", two or more): the transform straight from them (CPONLY=1), or
   refined by a short closest-point fit. This is the reliable way: the OSM outlines merge wings the drawings keep apart.
3. Without them, a search: closest-point fits (rotation, shift, scale) from starts every 12 m at the four quarter-turns
   of the main directions, or around SEED="rotation_deg,x,y" (SEEDONLY=1 for only those).
The score is the share of the drawing's walls within 0.6 m of an outline. Look at the overlay before trusting it."""
import sys, json, math
import numpy as np

plan_f, site_f, scale, out_f = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
svg_f = sys.argv[5] if len(sys.argv) > 5 else None
plan, site = json.load(open(plan_f)), json.load(open(site_f))
M_PER_PT = 25.4 / 72 / 1000 * scale

grey = lambda c: len(c) in (1, 3) and all(abs(v - c[0]) < 0.02 for v in c) and 0.4 < c[0] < 0.9
walls = [p for s in plan["shapes"] if s["k"] != "stroke" and grey(s["fill"]) for p in s["p"]]
if not walls: sys.exit("no grey wall fills in the drawing")

def sample(rings, step):
    out = []
    for r in rings:
        for (x0, y0), (x1, y1) in zip(r, r[1:]):
            n = max(1, int(math.hypot(x1 - x0, y1 - y0) / step))
            for k in range(n): t = k / n; out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
    return np.array(out)

W = sample(walls, 0.25 / M_PER_PT) * M_PER_PT                       # drawing walls, metres, page orientation
own = [b for b in site["buildings"] if b.get("own")]
E = sample([b["ring"] for b in own], 0.25)                          # outlines, site metres

def main_dir(rings, weight_pts):
    h = np.zeros(90)
    for r in rings:
        for (x0, y0), (x1, y1) in zip(r, r[1:]):
            L = math.hypot(x1 - x0, y1 - y0)
            if L * weight_pts < 0.5: continue
            h[int(math.degrees(math.atan2(y1 - y0, x1 - x0)) % 90)] += L
    h = np.convolve(np.r_[h[-3:], h, h[:3]], np.ones(5) / 5, "same")[3:-3]
    return float(np.argmax(h))
th_w, th_e = main_dir(walls, M_PER_PT), main_dir([b["ring"] for b in own], 1)

def rot(P, th, s=1.0): c, si = math.cos(th), math.sin(th); return s * (P @ np.array([[c, si], [-si, c]]))

# distance and nearest outline point for every 0.5 m cell around the outlines: a chamfer sweep, vectorised
CELL = 0.5
gx0, gy0 = E.min(0) - 60; gw, gh = ((E.max(0) - E.min(0) + 120) / CELL).astype(int)
NX = np.full((gh, gw), np.nan); NY = np.full((gh, gw), np.nan)
ix, iy = ((E[:, 0] - gx0) / CELL).astype(int), ((E[:, 1] - gy0) / CELL).astype(int); NX[iy, ix] = E[:, 0]; NY[iy, ix] = E[:, 1]
cx = gx0 + (np.arange(gw) + 0.5) * CELL; cy = gy0 + (np.arange(gh) + 0.5) * CELL; CX, CY = np.meshgrid(cx, cy)
D = np.where(np.isnan(NX), np.inf, np.hypot(NX - CX, NY - CY))
for _ in range(int(12 / CELL)):
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
        sx, sy = np.roll(NX, (dy, dx), (0, 1)), np.roll(NY, (dy, dx), (0, 1))
        d = np.where(np.isnan(sx), np.inf, np.hypot(sx - CX, sy - CY)); b = d < D
        D[b] = d[b]; NX[b] = sx[b]; NY[b] = sy[b]
def look(P):
    i = np.clip(((P[:, 0] - gx0) / CELL).astype(int), 0, gw - 1); j = np.clip(((P[:, 1] - gy0) / CELL).astype(int), 0, gh - 1)
    out = (P[:, 0] < gx0) | (P[:, 1] < gy0) | (P[:, 0] >= gx0 + gw * CELL) | (P[:, 1] >= gy0 + gh * CELL)
    d = np.where(out, np.inf, D[j, i]); return d, np.c_[NX[j, i], NY[j, i]]

Wsub = W[:: max(1, len(W) // 3000)]
def icp(th, t, s=1.0, lims=(8, 5, 3, 2, 1.5, 1, 1, 0.8, 0.8, 0.8)):
    for it, lim in enumerate(lims):
        P = rot(Wsub, th, s) + t; d, Q = look(P); m = d < lim
        if m.sum() < 30: return th, t, s, 0.0
        A, B = Wsub[m], Q[m]; ca, cb = A.mean(0), B.mean(0); A0, B0 = A - ca, B - cb
        U, S_, Vt = np.linalg.svd(A0.T @ B0); Dm = np.eye(2); Dm[1, 1] = np.sign(np.linalg.det(U @ Vt)); Rm = U @ Dm @ Vt
        s_new = (S_ * np.diag(Dm)).sum() / (A0 ** 2).sum(); th = math.atan2(Rm[0, 1], Rm[0, 0])
        if it > 4 and abs(s_new - 1) < 0.04: s = s_new
        t = cb - s * (ca @ Rm)
    d, _ = look(rot(Wsub, th, s) + t); return th, t, s, float((d < 0.5).mean())

# starts: four quarter-turns from the main directions (and the wall direction mirrored to both senses), centres every 12 m over the outlines
cands = []
wc = Wsub.mean(0)
ys_, xs_ = np.where(D < 1.0)
pts = np.c_[cx[xs_], cy[ys_]]
keep = pts[(np.floor(pts[:, 0] / 12) * 1000 + np.floor(pts[:, 1] / 12)).argsort()]
_, first = np.unique(np.floor(keep / 12), axis=0, return_index=True); centres = keep[first]
for k in range(4):
    th0 = math.radians(th_e - th_w + 90 * k)
    for c in centres:
        cands.append(icp(th0, c - rot(wc[None], th0)[0]))
# a known start (SEED="rotation_deg,x,y": where the drawing's centre should land), tried at its rotation and +-5 degrees
import os
if os.environ.get("SEED"):
    r0, sx, sy = map(float, os.environ["SEED"].split(","))
    for dr in (-5, 0, 5):
        th0 = math.radians(r0 + dr)
        for ox in (-10, 0, 10):
            for oy in (-10, 0, 10): cands.append(icp(th0, np.array([sx + ox, sy + oy]) - rot(wc[None], th0)[0]))
if os.environ.get("SEEDONLY"): cands = cands[-27:]
# control points (CP="page_x,page_y,site_x,site_y;..." two or more): the transform straight from them, then a short refinement
if os.environ.get("CP"):
    pr = np.array([list(map(float, c.split(","))) for c in os.environ["CP"].split(";")])
    A, B = pr[:, :2] * M_PER_PT, pr[:, 2:]; ca, cb = A.mean(0), B.mean(0); A0, B0 = A - ca, B - cb
    U, S_, Vt = np.linalg.svd(A0.T @ B0); Dm = np.eye(2); Dm[1, 1] = np.sign(np.linalg.det(U @ Vt)); Rm = U @ Dm @ Vt
    s0 = (S_ * np.diag(Dm)).sum() / (A0 ** 2).sum(); th0 = math.atan2(Rm[0, 1], Rm[0, 0]); t0 = cb - s0 * (ca @ Rm)
    print("control points: residuals", np.round(np.hypot(*(rot(A, th0, s0) + t0 - B).T), 2), "m, scale", round(scale * s0, 1), file=sys.stderr)
    cands = [(th0, t0, s0, 0.0)] if os.environ.get("CPONLY") else [icp(th0, t0, s0, (2, 1.5, 1, 1, 0.8, 0.8))]
    if not os.environ.get("CPONLY"): cands.append(cands[0])
cands.sort(key=lambda r: -r[3])
th, t, s, sc = cands[0]
if len(cands) > 1: print(f"{len(cands)} starts; best {sc:.3f}, next {cands[1][3]:.3f} (rotation {math.degrees(cands[1][0]):.1f})", file=sys.stderr)

P = rot(W, th, s) + t
d, _ = look(P)
score = float((d < 0.6).mean())
res = {"plan": plan["file"], "page": plan["page"], "scale_drawn": scale, "scale_fitted": round(scale * s, 1), "rotation_deg": round(math.degrees(th), 2),
       "m_per_pt": M_PER_PT * s, "theta": th, "shift": [float(t[0]), float(t[1])], "walls_on_outline": round(score, 3), "median_gap_m": round(float(np.median(d)), 2),
       "note": "site = rotate(page_pt * m_per_pt, theta) + shift; rotate as row vector @ [[cos, sin], [-sin, cos]]"}
json.dump(res, open(out_f, "w"), indent=1)
print(json.dumps(res))

if svg_f:
    xs = np.r_[E[:, 0], P[:, 0]]; ys = np.r_[E[:, 1], P[:, 1]]; x0, x1, y0, y1 = xs.min() - 5, xs.max() + 5, ys.min() - 5, ys.max() + 5
    with open(svg_f, "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0} {-y1} {x1 - x0} {y1 - y0}" width="1600" height="{1600 * (y1 - y0) / (x1 - x0):.0f}"><rect x="{x0}" y="{-y1}" width="100%" height="100%" fill="white"/>')
        for b in own: f.write('<path d="M' + " L".join(f"{x},{-y}" for x, y in b["ring"]) + '" fill="#cfe3f7" stroke="#1d5fa8" stroke-width="0.3"/>')
        for r in walls:
            Q = rot(np.array(r) * M_PER_PT, th, s) + t
            f.write('<path d="M' + " L".join(f"{x:.2f},{-y:.2f}" for x, y in Q) + '" fill="#c8102e" fill-opacity="0.85"/>')
        f.write("</svg>")
