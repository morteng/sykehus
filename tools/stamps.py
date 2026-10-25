"""The room stamps of a sheet that writes them turned a quarter (Ottar A-2110, Sentralblokka 11. etasje): side by side
from the same edge, the ceiling height ("2 700 mm"), the area ("22,4 m²"), the name (the largest) and the room code
("11.157"). Same output as tools/rooms.py (page points, origin bottom left), which is too slow on a 1:50 sheet.

  python -I tools/stamps.py <file.pdf> <page 1..> <out.json> [name size, default 11.7]

The PDF is data: PyMuPDF reads its text, nothing in it is run."""
import sys, json, re
import pymupdf

path, pageno, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
size = float(sys.argv[4]) if len(sys.argv) > 4 else 11.7
pg = pymupdf.open(path)[pageno - 1]
H = pg.rect.height
lines = []
for bl in pg.get_text("dict")["blocks"]:
    for ln in bl.get("lines", []):
        t = re.sub(r"\s+", " ", " ".join(s["text"] for s in ln["spans"])).strip()
        if t: lines.append({"b": ln["bbox"], "s": ln["spans"][0]["size"], "t": t})
AREA, CODE = re.compile(r"^(\d+(?:[ .]\d{3})*,\d) ?m[²2]$"), re.compile(r"^\d{2}\.\d{3}[A-Z]?$")
# a stamp's columns start at the same edge (y0) and stand within a few points of each other
beside = lambda a, n, lo, hi: abs(a["b"][1] - n["b"][1]) < 2 and lo <= a["b"][0] - n["b"][0] <= hi
rooms, seen = [], set()
for n in lines:
    if abs(n["s"] - size) > 0.05 or AREA.match(n["t"]) or CODE.match(n["t"]): continue
    code = next((c["t"] for c in lines if CODE.match(c["t"]) and beside(c, n, 5, 25)), None)
    area = next((a["t"] for a in lines if AREA.match(a["t"]) and beside(a, n, -15, -3)), None)
    if not code and not area: continue          # a heading or a legend, not a room
    x0, y0, x1, y1 = n["b"]; k = (n["t"], round(x0), round(y0))
    if k in seen: continue
    seen.add(k)
    rooms.append({"name": n["t"], "code": code, "area_m2": float(AREA.match(area).group(1).replace(" ", "").replace(".", "").replace(",", ".")) if area else None,
                  "at": [round((x0 + x1) / 2, 2), round(H - (y0 + y1) / 2, 2)]})
json.dump(rooms, open(out, "w", encoding="utf-8"), ensure_ascii=False)
print(f"{len(rooms)} rooms, {sum(r['area_m2'] is not None for r in rooms)} with area, {sum(r['area_m2'] or 0 for r in rooms):.1f} m2")
