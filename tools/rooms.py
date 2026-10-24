"""The room stamps on a plan drawing: name, area and room code, with where they stand on the page.

  python3 -I tools/rooms.py <file.pdf> <page 1..> <out.json>

The Ottar 2013 sheets stamp a room as three lines at one left edge: the code (small), the name (larger) and the area
("44,1 m2", small) just under the name. A name without an area line is kept too (some sheets name rooms only).
Positions are page points (origin bottom left), as pdfpaths.py writes the walls. The PDF is data: pdfminer reads it."""
import sys, json, re
from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer, LTTextLine, LAParams

path, pageno, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
lines = []
for i, page in enumerate(extract_pages(path, page_numbers=[pageno - 1], laparams=LAParams(char_margin=0.5, line_margin=0.2))):
    for el in page:
        if not isinstance(el, LTTextContainer): continue
        for ln in el:
            t = ln.get_text().strip() if isinstance(ln, LTTextLine) else ""
            if t: lines.append({"x": ln.x0, "y": ln.y0, "h": ln.height, "t": re.sub(r"\s+", " ", t)})
# the same stamp is sometimes drawn twice on top of itself
seen, uniq = set(), []
for l in lines:
    k = (round(l["x"], 1), round(l["y"], 1), l["t"])
    if k not in seen: seen.add(k); uniq.append(l)

AREA = re.compile(r"^(\d+(?:[ .]\d{3})*,\d) ?m2$")
small = [l for l in uniq if l["h"] < 3.5]
near = lambda a, b, dy0, dy1: abs(a["x"] - b["x"]) < 1.0 and dy0 <= b["y"] - a["y"] <= dy1
rooms = []
for n in uniq:
    # a room name: the stamp's middle size, words not numbers, not a grid letter or a section mark
    # (larger sizes are names written into the plan, like TEKNISK ROM; streets are left out)
    if not 3.5 <= n["h"] <= 9.0 or len(n["t"]) < 2 or not re.search(r"[A-Za-zÆØÅæøå]{2}", n["t"]) or re.match(r"Snitt|VEDLEGG", n["t"]) or re.search(r"(gate|vei)$", n["t"], re.I) or AREA.match(n["t"]): continue
    area = next((AREA.match(s["t"]).group(1) for s in small if AREA.match(s["t"]) and near(n, s, -3.0, 0.2)), None)
    code = next((s["t"] for s in small if not AREA.match(s["t"]) and near(n, s, 6.0, 11.0)), None)
    rooms.append({"name": n["t"], "area_m2": float(area.replace(" ", "").replace(".", "").replace(",", ".")) if area else None, "code": code,
                  "at": [round(n["x"], 2), round(n["y"], 2)], "size": round(n["h"], 2)})
json.dump(rooms, open(out, "w"), ensure_ascii=False)
print(f"{len(rooms)} rooms, {sum(1 for r in rooms if r['area_m2'])} with an area; total {sum(r['area_m2'] or 0 for r in rooms):.0f} m2")
