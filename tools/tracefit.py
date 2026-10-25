"""Places a trace on its building: the turn, scale and shift that lay its walls best on the building's outline in
site.json (the laser and OpenStreetMap outline), written into the trace as two control points.

  python -I tools/tracefit.py <trace.json> public/data/site.json [--block] [--out placed.json] [--debug out.png]

How: the outline is drawn on a 25 cm grid as a band (its walls, worth most), its inside (worth a little) and the
outside (worth less than nothing: walls do not stand in the garden). For each turn (the outline's long side and the
three quarter turns from it, each ±1° in half degrees; where the scan index gives the sheet's north arrow, in degrees
clockwise from the sheet's up, only the quarter turn nearest it, since a nearly square building fits about as well
a quarter turn round) and each scale (the sheet's own ±6 %), the traced walls are
drawn on the same grid and the best shift found by correlation (FFT). The best of all is kept. Needs numpy, scipy,
Pillow, shapely."""
import sys, json, math
import numpy as np
from scipy.signal import fftconvolve
from scipy import ndimage as ndi
from PIL import Image, ImageDraw

args = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and sys.argv[i - 1] not in ("--out", "--debug", "--turn")]
tf, sf = args[:2]
out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else tf
debug = sys.argv[sys.argv.index("--debug") + 1] if "--debug" in sys.argv else None
t = json.load(open(tf, encoding="utf-8")); site = json.load(open(sf, encoding="utf-8"))
own = [b for b in site["buildings"] if (t.get("wing") and b.get("wing") == t["wing"]) or (t.get("building") and b["id"] == t["building"])]
if not own: sys.exit("no building for this trace")
# a sheet often draws the wings next to its own: with --block the walls are laid on the whole block's outline
rings = [b["ring"] for b in site["buildings"] if b.get("wing")] if "--block" in sys.argv else [b["ring"] for b in own]
G = 0.25
pts = np.array([p for r in rings for p in r]); x0, y0 = pts.min(0) - 30; x1, y1 = pts.max(0) + 30
nx, ny = int((x1 - x0) / G) + 1, int((y1 - y0) / G) + 1
def to_px(p): return ((p[0] - x0) / G, (y1 - p[1]) / G)
inside = Image.new("L", (nx, ny), 0); band = Image.new("L", (nx, ny), 0)
for r in rings:
    ImageDraw.Draw(inside).polygon([to_px(p) for p in r], fill=1)
    ImageDraw.Draw(band).line([to_px(p) for p in r], fill=1, width=int(0.8 / G))
inside, band = np.array(inside, float), np.array(band, float)
target = np.where(band > 0, 1.0, np.where(inside > 0, 0.08, -0.35))

# the outline's long side, for the turns to try
L, ang0 = 0, 0
for r in [b["ring"] for b in own]:
    for a, b in zip(r, r[1:]):
        l = math.hypot(b[0] - a[0], b[1] - a[1])
        if l > L: L, ang0 = l, math.atan2(b[1] - a[1], b[0] - a[0])
walls = [np.array(w, float) for w in t["walls"]]
allp = np.concatenate(walls); c = allp.mean(0)
sheets = json.load(open(sf.rsplit("/", 1)[0] + "/skann/index.json", encoding="utf-8"))["sheets"]
scale0 = next(s["scale"] for s in sheets if s["id"] == t["id"]) * 25.4 / 72 / 1000   # metres a point at the sheet's scale
best, perk = (-1e18,), {}   # the best of all, and of each quarter turn (to see how sure the turn is)
north = float(sys.argv[sys.argv.index("--turn") + 1]) if "--turn" in sys.argv else next((s.get("north") for s in sheets if s["id"] == t["id"]), None)   # --turn <deg>: only the quarter turn nearest it
def near_north(th):   # the sheet's north arrow, where the index gives it, only picks the quarter turn
    return north is None or abs((math.degrees(th) - north + 180) % 360 - 180) <= 45
for k in range(4):
    if not near_north(ang0 + k * math.pi / 2): continue
    for da in np.arange(-1, 1.01, 0.5):
        th = ang0 + k * math.pi / 2 + math.radians(da)
        for sc in scale0 * np.arange(0.94, 1.061, 0.01):
            cs, sn = math.cos(th), math.sin(th)
            def tr(p): u, v = (p[:, 0] - c[0]) * sc, -(p[:, 1] - c[1]) * sc; return np.stack([u * cs - v * sn, u * sn + v * cs], 1)
            ws = [tr(w) for w in walls]; q = np.concatenate(ws); qx0, qy1 = q[:, 0].min(), q[:, 1].max()
            kw, kh = int((q[:, 0].max() - qx0) / G) + 2, int((qy1 - q[:, 1].min()) / G) + 2
            if kw >= nx or kh >= ny: continue
            im = Image.new("L", (kw, kh), 0); d = ImageDraw.Draw(im)
            for w in ws: d.polygon([((x - qx0) / G, (qy1 - y) / G) for x, y in w], fill=1)
            ker = np.array(im, float)
            corr = fftconvolve(target, ker[::-1, ::-1], mode="valid")
            j = np.unravel_index(np.argmax(corr), corr.shape); v = corr[j] / max(ker.sum(), 1)
            if v > best[0]: best = (v, th, sc, x0 + j[1] * G - qx0, y1 - j[0] * G - qy1)
            if v > perk.get(k, (-1e18,))[0]: perk[k] = (v, math.degrees(th), sc / (25.4 / 72 / 1000))
v, th, sc, dx, dy = best
cs, sn = math.cos(th), math.sin(th)
def place(p):
    u, w = (p[0] - c[0]) * sc, -(p[1] - c[1]) * sc
    return [round(u * cs - w * sn + dx, 3), round(u * sn + w * cs + dy, 3)]
lo, hi = allp.min(0), allp.max(0)
t["cp"] = [[round(float(lo[0]), 2), round(float(lo[1]), 2), *place(lo)], [round(float(hi[0]), 2), round(float(hi[1]), 2), *place(hi)]]
t["placement"] = "maskinelt tilpasset bygningsomrisset"
json.dump(t, open(out, "w", encoding="utf-8"))
print("  each quarter turn:", "; ".join(f"{q[1]:.1f}° {q[0]:.3f} 1:{q[2]:.0f}" for k, q in sorted(perk.items())))
print(f"{t['id']}: score {v:.3f}, turn {math.degrees(th):.2f}°, 1:{sc / (25.4 / 72 / 1000):.0f}")
if debug:
    im = Image.fromarray(((target + 0.35) / 1.35 * 200).astype(np.uint8)).convert("RGB"); d = ImageDraw.Draw(im)
    for w in walls: d.polygon([to_px(place(p)) for p in w], fill=(220, 20, 40))
    im.save(debug)
