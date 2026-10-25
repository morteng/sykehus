"""The walls of a scanned floor plan, found in the picture, as a trace (the file trace.js opens and tools/trace-import.mjs
reads): rectangles along the sheet's own axes, in the sheet's points (PDF points, y down).

  python -I tools/scanwalls.py <pdf> <page> <scan index.json> <sheet id> <out.json> [x0,y0,x1,y1 (pt, the plan's part of the page)] [--debug out.png]
     [--mask words.json (the text tools/scanrooms.py read, --debug, blanked first)]
  python -I tools/scanwalls.py - - <scan index.json> <sheet id> <out.json> --lines <linewalls.json> [--rooms <rooms.json>]   (a vector sheet)

How: the page is drawn at about 8 pixels a point's worth of 1:200 (4 000 px across an A3), made black and white, and
turned straight (the angle where the dark rows and columns stand sharpest). A wall is drawn as a dark band at least
as thick as `tmin` metres, or as two lines closer than `wall_gap` (the scan index; 0,25 m), which are filled first:
thin lines (text, doors, furniture, dimension lines, hatching) are taken away by opening
with a square that size; what is left is opened again with a long flat and a long tall bar, which keeps the straight
runs, horizontal and vertical apart; each run becomes one rectangle. Dark filled symbols the size of a wall stay
(lift shafts, columns): those are kept, as the vector drawings keep them too.

The trace comes out unplaced (no cp): tools/tracefit.py places it on its building. Needs PyMuPDF, numpy, scipy."""
import sys, json, math
import numpy as np
import pymupdf
from scipy import ndimage as ndi

opts = {k: sys.argv[i + 1] for i, k in enumerate(sys.argv) if k in ("--debug", "--lines", "--rooms", "--mask")}
args = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and sys.argv[i - 1] not in opts]
pdf, page, index, sid, out = args[:5]
region = [float(v) for v in args[5].split(",")] if len(args) > 5 else None
debug = opts.get("--debug")
sheet = next(s for s in json.load(open(index, encoding="utf-8"))["sheets"] if s["id"] == sid)

if "--lines" in opts:
    # a vector sheet drawn in lines: the walls tools/linewalls.py paired, and the stamps tools/rooms.py read, from
    # page points y up to the trace's points y down
    lw = json.load(open(opts["--lines"], encoding="utf-8")); Hp = lw["h"]
    walls = [[[round(x, 2), round(Hp - y, 2)] for x, y in r] for sh in lw["shapes"] for r in sh["p"]]
    rooms = [{"name": r["name"], "area_m2": r.get("area_m2"), "code": r.get("code"), "at": [round(r["at"][0], 2), round(Hp - r["at"][1], 2)]}
             for r in (json.load(open(opts["--rooms"], encoding="utf-8")) if "--rooms" in opts else [])]
    trace = {k: sheet.get(k) for k in ("id", "storey", "kote", "height", "how", "wing", "building", "doc", "page", "title", "size")}
    trace.update(cp=[], walls=walls, rooms=rooms, traced="vegger fra vektortegningens linjer (tools/linewalls.py)" + (", rom fra tegningens stempler (tools/rooms.py eller stamps.py)" if rooms else ""))
    json.dump(trace, open(out, "w", encoding="utf-8")); print(f"{sid}: {len(walls)} walls, {len(rooms)} rooms from the vector drawing"); sys.exit(0)
doc = pymupdf.open(pdf); pg = doc[int(page) - 1]
W, H = pg.rect.width, pg.rect.height
m_per_pt = sheet["scale"] * 25.4 / 72 / 1000                 # metres a point at the sheet's scale
zoom = m_per_pt / 0.02                                         # pixels a point: about 2 cm a pixel
zoom = min(zoom, 6000 / W)
pix = pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csGRAY)
img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
m_px = m_per_pt / zoom                                          # metres a pixel
dark = img < int(sheet.get("dark", 150))                        # the scan's grey counts as ink below this
if "--mask" in opts:
    # the words tools/scanrooms.py read (its --debug file, page points): text is not wall, so it is blanked first
    for w in json.load(open(opts["--mask"], encoding="utf-8")):
        if w["conf"] < 0.3: continue
        x0, y0, x1, y1 = [int(round(v * zoom)) for v in w["b"]]
        dark[max(0, y0 - 2):y1 + 2, max(0, x0 - 2):x1 + 2] = False
if region:
    x0, y0, x1, y1 = [int(round(v * zoom)) for v in region]
    keep = np.zeros_like(dark); keep[y0:y1, x0:x1] = True; dark &= keep

# straight: the small turn (±2°) that makes the dark profile sharpest
def sharp(a):
    r = ndi.rotate(dark[::4, ::4].astype(np.float32), a, reshape=False, order=0)
    return (r.sum(0) ** 2).sum() + (r.sum(1) ** 2).sum()
angles = np.arange(-2, 2.01, 0.1); best = max(angles, key=sharp)
angles = np.arange(best - 0.1, best + 0.101, 0.02); best = float(max(angles, key=sharp))
straight = ndi.rotate(dark, best, reshape=False, order=0) if abs(best) > 0.005 else dark

run = max(4, int(round(float(sheet.get("run", 0.6)) / m_px)))     # a wall runs at least 0.6 m straight (the scan index may say more)
rects = []
# 1. walls filled solid, or drawn as two lines the scan has run together: straight dark bands at least `tmin` thick
#    (single lines, text and furniture are thinner and are taken away by the square), runs at least `run` long
tmin = max(2, int(round(float(sheet.get("tmin", 0.07)) / m_px)))
# a coarse scan (SB 12, 150 dpi: a pixel is 15 cm at 1:200) draws a wall as two one-pixel lines with a pixel of white
# between: `close` (metres, the scan index) fills that gap first, each way apart so corners do not fill
src = straight
if sheet.get("close"):
    k = max(2, int(round(float(sheet["close"]) / m_px)))
    src = ndi.binary_closing(straight, structure=np.ones((k, 1))) | ndi.binary_closing(straight, structure=np.ones((1, k)))
thick = ndi.binary_opening(src, structure=np.ones((tmin, tmin)))
for st in (np.ones((1, run)), np.ones((run, 1))):
    lab, n = ndi.label(ndi.binary_opening(thick, structure=st))
    for ys, xs in ndi.find_objects(lab):
        h, w = ys.stop - ys.start, xs.stop - xs.start
        if max(h, w) >= run and min(h, w) <= float(sheet.get("tmax", 1.2)) / m_px: rects.append((xs.start, ys.start, xs.stop, ys.stop))
# 2. walls drawn as two lines: long thin straight lines (text and furniture are not continuous that far), paired with
#    a parallel line `pair` metres away (6 to 22 cm unless the index says) along at least `run` of both; the wall is the band between them
pmin, pmax = sheet.get("pair", [0.06, 0.22])                    # how far apart a wall's two lines are (the scan index)
gmin, gmax, lw = int(round(pmin / m_px)), int(round(pmax / m_px)), max(2, int(round(float(sheet.get("lw", 0.07)) / m_px)))   # lw: how thick one drawn line is at most
def lines(img, horiz):
    lab, n = ndi.label(ndi.binary_opening(img, structure=np.ones((1, run)) if horiz else np.ones((run, 1))))
    out = []
    for ys, xs in ndi.find_objects(lab):
        across, along = (ys, xs) if horiz else (xs, ys)
        if across.stop - across.start <= lw: out.append(((across.start + across.stop) / 2, along.start, along.stop))
    return sorted(out)
for horiz in (True, False):
    ls = lines(straight, horiz)
    for i, (c, a0, a1) in enumerate(ls):
        for c2, b0, b1 in ls[i + 1:]:
            if c2 - c > gmax: break
            lo, hi = max(a0, b0), min(a1, b1)
            if c2 - c >= gmin and hi - lo >= run:
                t0, t1 = int(c), int(math.ceil(c2)) + 1
                rects.append((lo, t0, hi, t1) if horiz else (t0, lo, t1, hi))
# back to the page: undo the turn about the picture's centre, then pixels to points
cy, cx = (np.array(straight.shape) - 1) / 2
a = math.radians(best)
def unturn(x, y):
    dx, dy = x - cx, y - cy
    return (cx + dx * math.cos(a) - dy * math.sin(a)) / zoom, (cy + dx * math.sin(a) + dy * math.cos(a)) / zoom
walls = []
for x0, y0, x1, y1 in rects:
    r = [unturn(x, y) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
    walls.append([[round(x, 2), round(y, 2)] for x, y in r + [r[0]]])
trace = {k: sheet.get(k) for k in ("id", "storey", "kote", "height", "how", "wing", "building", "doc", "page", "title", "size")}
trace.update(cp=[], walls=walls, rooms=[], traced=f"vegger funnet maskinelt i skannet (tools/scanwalls.py, rettet {best:.2f}°), ikke kontrollert vegg for vegg")
json.dump(trace, open(out, "w", encoding="utf-8"))
print(f"{sid}: {len(walls)} walls, turned {best:.2f}°, {m_px * 100:.1f} cm a pixel")
if debug:
    from PIL import Image, ImageDraw
    im = Image.fromarray(img).convert("RGB"); d = ImageDraw.Draw(im)
    for w in walls: d.polygon([(x * zoom, y * zoom) for x, y in w], outline=(220, 20, 40), fill=(220, 20, 40))
    im.save(debug)
