"""The room stamps of a scanned plan, read by the Mac's own text recognition (Vision, tools/ocr.swift), into a trace:
each stamp is the room code ("FS 205", "V 651", "M 606C", "SB 12.315"), the name under it and, under that, the area ("20,8",
"21,4 m²"), standing at one left edge. The trace's rooms are replaced; its walls and placement are kept.

  python -I tools/scanrooms.py <pdf> <page> public/data/skann/index.json <trace.json> [--debug words.json]

How: the page is drawn so a stamp's letters are about 20 pixels high, read in overlapping tiles (once as it lies and
once turned a quarter, which finds the text written up the page) and the words of two tiles merged. A word is a code
by its form; the name is the line just under it (its top within two code heights, its left edge or middle within
three), the area the number under the name. A code without a name is skipped. Only on macOS (needs swiftc, PyMuPDF,
Pillow)."""
import sys, json, re, os, subprocess, tempfile
import pymupdf
from PIL import Image

opts = {k: sys.argv[i + 1] for i, k in enumerate(sys.argv) if k == "--debug"}
args = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and sys.argv[i - 1] not in opts]
pdf, page, index, tf = args[:4]
t = json.load(open(tf, encoding="utf-8"))
sheet = next(s for s in json.load(open(index, encoding="utf-8"))["sheets"] if s["id"] == t["id"])
ocr = os.path.join(tempfile.gettempdir(), "sykehus-ocr")
if not os.path.exists(ocr) or os.path.getmtime(ocr) < os.path.getmtime(os.path.join(os.path.dirname(__file__), "ocr.swift")):
    subprocess.run(["swiftc", "-O", os.path.join(os.path.dirname(__file__), "ocr.swift"), "-o", ocr], check=True)

zoom = max(3.0, sheet["scale"] / 40)                     # 1:100 at 3, 1:200 at 5 pixels a point
pg = pymupdf.open(pdf)[int(page) - 1]
pix = pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csGRAY)
im = Image.frombytes("L", (pix.width, pix.height), pix.samples); W, H = im.size
T, words = 1600, []
with tempfile.TemporaryDirectory() as td:
    f = os.path.join(td, "t.png")
    for rot in (0, 90, 270):
        r = im if rot == 0 else im.rotate(-rot, expand=True)
        for y in range(0, r.size[1], T - 200):
            for x in range(0, r.size[0], T - 200):
                r.crop((x, y, min(x + T, r.size[0]), min(y + T, r.size[1]))).save(f)
                for o in json.loads(subprocess.run([ocr, f], capture_output=True).stdout or b"[]"):
                    x0, y0, x1, y1 = o["box"]; x0 += x; x1 += x; y0 += y; y1 += y
                    if rot == 90: x0, y0, x1, y1 = y0, H - x1, y1, H - x0      # turned back: (px, py) was (H - py, px)
                    if rot == 270: x0, y0, x1, y1 = W - y1, x0, W - y0, x1     # (px, py) was (py, W - px)
                    words.append({"t": o["t"].strip(), "conf": o["conf"], "b": [v / zoom for v in (x0, y0, x1, y1)]})
# the same place read twice (two tiles, or two turns, one of them reading it upside down): the surer reading, or the
# longer where one holds the other ("FS 205" over "205")
def same(a, b):
    ix = min(a["b"][2], b["b"][2]) - max(a["b"][0], b["b"][0]); iy = min(a["b"][3], b["b"][3]) - max(a["b"][1], b["b"][1])
    area = lambda w: (w["b"][2] - w["b"][0]) * (w["b"][3] - w["b"][1])
    return ix > 0 and iy > 0 and ix * iy > 0.5 * min(area(a), area(b))
uniq = []
for w in sorted(words, key=lambda w: -w["conf"]):
    u = next((u for u in uniq if same(w, u)), None)
    if u is None: uniq.append(w)
    elif len(w["t"]) > len(u["t"]) and u["t"].lower() in w["t"].lower(): uniq[uniq.index(u)] = w
if "--debug" in opts: json.dump(uniq, open(opts["--debug"], "w"), ensure_ascii=False)

CODE = re.compile(r"^(FS|VN|ØN|SB|M|V|S) ?(\d{3}[A-Z]?)\b")
# Sentralblokka writes the storey in the code ("SB 12.315"); Vision often reads the SB as 58, S8, 88 or $8
SBCODE = re.compile(r"^(?:[S5$38][B8359]\s?)?(\d{1,2})[.,](\d{3}[A-Z]?)\b")
floor = (re.match(r"\d+", sheet.get("storey") or "") or [None])[0]
def code_of(t):
    m = SBCODE.match(t)
    if m: return f"SB {floor or m.group(1)}.{m.group(2)}"   # the sheet's own storey where the reading lost a digit
    m = CODE.match(t)
    if m: return f"{'FS' if m.group(1) in ('FS', 'S') else m.group(1)} {m.group(2)}"
AREA = re.compile(r"^(\d{1,3}[,.]\d)( ?m.*)?$")
NAME = re.compile(r"^[A-Za-zÆØÅæøåÄÖÜäöü][A-Za-zÆØÅæøåÄÖÜäöü .,/\-0-9]{1,40}$")
under = lambda a, b, h: 0.4 * h <= b["b"][1] - a["b"][1] <= 2.2 * h and (abs(b["b"][0] - a["b"][0]) < 3 * h or abs((b["b"][0] + b["b"][2]) - (a["b"][0] + a["b"][2])) / 2 < 3 * h)
# Vision here reads no Norwegian: the letters it drops in the words the stamps use, and a name written twice
NORSK = [("KJOKKEN", "KJØKKEN"), ("Kjokken", "Kjøkken"), ("KJOLERO", "KJØLERO"), ("MOTE", "MØTE"), ("Mote", "Møte"), ("NY DOR", "NY DØR"),
         ("ä", "å"), ("Ä", "Å"), ("Dusi", "Dusj"), ("FORSTEHJ", "FØRSTEHJ"),
         ("UNDERSOK", "UNDERSØK"), ("RONTGEN", "RØNTGEN"), ("FONTGEN", "RØNTGEN"), ("KORFIDOR", "KORRIDOR"), ("AUDIONETRI", "AUDIOMETRI"), ("VESTISYLE", "VESTIBYLE")]
def clean(n):
    for a, b in NORSK: n = n.replace(a, b)
    w = n.split()
    if len(w) > 2 and len({x[:6] for x in w}) == 1: n = min(w, key=len)
    return n.rstrip("-")
rooms, codes = [], []
for c in sorted(uniq, key=lambda w: -w["conf"]):
    code = code_of(c["t"])
    if not code or c["conf"] < 0.5: continue
    if any(code == k and abs(c["b"][0] - p[0]) < 15 and abs(c["b"][1] - p[1]) < 15 for k, p in codes): continue
    h = c["b"][3] - c["b"][1]
    names = [n for n in uniq if n is not c and n["conf"] >= 0.5 and NAME.match(n["t"]) and not code_of(n["t"]) and under(c, n, h)]
    if not names: continue
    n = min(names, key=lambda n: (n["b"][1], -n["conf"]))
    areas = [a for a in uniq if AREA.match(a["t"]) and a["conf"] >= 0.5 and under(n, a, h)]
    a = min(areas, key=lambda a: a["b"][1], default=None)
    codes.append((code, c["b"]))
    rooms.append({"name": clean(n["t"]), "code": code, "area_m2": float(AREA.match(a["t"]).group(1).replace(",", ".")) if a else None,
                  "at": [round((n["b"][0] + n["b"][2]) / 2, 2), round((n["b"][1] + n["b"][3]) / 2, 2)]})
t["rooms"] = rooms
t["traced"] = re.sub(r"; rom .*$", "", t.get("traced", "")) + "; rom lest maskinelt fra stemplene (tools/scanrooms.py), ikke kontrollert"
json.dump(t, open(tf, "w", encoding="utf-8"), ensure_ascii=False)
print(f"{t['id']}: {len(rooms)} rooms, {sum(r['area_m2'] is not None for r in rooms)} with area, from {len(uniq)} words")
