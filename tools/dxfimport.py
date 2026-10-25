"""FDV drawings (as-built DWG from Vestre Viken / Sykehusbygg, PLAN.md milestone 6) into public/data/floors.json: each
storey of each wing as a floor "fdv-<id>", in the same walls/rooms shape as the traced drawings, replacing the floors
it is better than.

  python -I tools/dxfimport.py tools/fdv.json [<id> ...] [--floors <floors.json>, default public/data/floors.json]

Run after tools/trace-import.mjs (so a floor it replaces stays replaced) and before roompoly.py and ifc.py.

A DWG is first saved as DXF (ODA File Converter, free: DWG -> DXF 2018, or LibreDWG's dwg2dxf). tools/fdv.json lists
the sheets, each:

  {"id": "sb-12", "file": "<path>.dxf", "storey": "12. etasje", "wing": "sentralblokka", "kote": 58.11, "height": 3.76,
   "how": "fra FDV", "source": "Vestre Viken FDV, SB plan 12, as built 2019",
   "place": "utm" | "cp", "cp": "x,y,site_x,site_y;x,y,site_x,site_y"  (drawing units, for "cp"),
   "walls": "(?i)vegg|wall" (layer names, a regular expression), "rooms": "(?i)rom|room|area" (layers of the stamps),
   "replaces": ["spor-sb-12"]}

How: the drawing's units are its $INSUNITS (millimetres where it says none and the numbers are large). With
"place": "utm" the drawing is in EUREF89 UTM 33 (EPSG:25833), as FDV drawings often are, and it is only moved to the
site's origin; with "cp" two or more points place it (a similarity, as the traced sheets). Walls: closed polylines,
solids and hatches on the wall layers are walls as drawn; lines and open polylines on them are paired, two faces 5 to
65 cm apart running side by side at least 40 cm, at any angle, and the wall is the stretch they share. Rooms: a block
on the room layers with attributes (ROMNR / ROMNAVN / AREAL, or NR / NAVN / AREA: the tag holds the word) is a
stamp; so is text there, a name with the area ("12,4 m²") and the room number within 1,5 m of it. The DXF is data:
ezdxf reads it, nothing in it runs. Needs ezdxf."""
import sys, json, math, re, cmath
import ezdxf
from ezdxf import bbox

ORIGIN = (230311.0, 6633185.0)                          # site metres from EPSG:25833 (as site.json)
UNITS = {1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1.0}
import os
argv = sys.argv[1:]
floors_file = argv.pop(argv.index("--floors") + 1) if "--floors" in argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "data", "floors.json")
argv = [a for a in argv if a != "--floors"]
spec_file, only = argv[0], set(argv[1:])
specs = json.load(open(spec_file, encoding="utf-8"))["sheets"]
data = json.load(open(floors_file, encoding="utf-8"))


def fit_of(cp):
    """the similarity through the control points, least squares (as fitOf in public/trace.js, without the y flip)"""
    a = [complex(p[0], p[1]) for p in cp]; b = [complex(p[2], p[3]) for p in cp]
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    k = sum((q - mb) * (p - ma).conjugate() for p, q in zip(a, b)) / sum(abs(p - ma) ** 2 for p in a)
    return lambda x, y: (lambda z: (z.real, z.imag))(k * (complex(x, y) - ma) + mb)


def r2(p): return [round(p[0], 2), round(p[1], 2)]


def pair_lines(segs, tmin=0.05, tmax=0.65, lmin=0.4):
    """two faces of a wall: segments (metres) of one direction, tmin..tmax apart, sharing at least lmin of their run"""
    by = {}
    for (x0, y0), (x1, y1) in segs:
        L = math.hypot(x1 - x0, y1 - y0)
        if L < lmin: continue
        a = math.atan2(y1 - y0, x1 - x0) % math.pi
        by.setdefault(round(math.degrees(a) * 2) / 2 % 180, []).append(((x0, y0), (x1, y1)))
    walls = []
    for deg, ss in by.items():
        a = math.radians(deg); c, s = math.cos(a), math.sin(a)
        # in the direction's own frame: u along, v across
        ls = sorted((-x * s + y * c, *sorted((x * c + y * s, X * c + Y * s))) for (x, y), (X, Y) in [(p, q) for p, q in ss])
        used = set()
        for i, (v, u0, u1) in enumerate(ls):
            for j in range(i + 1, len(ls)):
                v2, w0, w1 = ls[j]
                if v2 - v > tmax: break
                lo, hi = max(u0, w0), min(u1, w1)
                if v2 - v >= tmin and hi - lo >= lmin and (i, j) not in used:
                    used.add((i, j))
                    back = lambda u, vv: (u * c - vv * s, u * s + vv * c)
                    walls.append([back(lo, v), back(hi, v), back(hi, v2), back(lo, v2), back(lo, v)])
                    break
    return walls


AREA = re.compile(r"(\d+(?:[ .]\d{3})*[,.]\d+)\s*m[²2]")
for sp in specs:
    if only and sp["id"] not in only: continue
    doc = ezdxf.readfile(sp["file"]); msp = doc.modelspace()
    u = UNITS.get(doc.header.get("$INSUNITS", 0))
    if u is None:   # no units given: millimetres if the drawing is large in its numbers
        ext = bbox.extents(msp); u = 0.001 if ext.has_data and max(ext.size.x, ext.size.y) > 2000 else 1.0
    if sp.get("place", "cp") == "utm":
        to = lambda x, y: (x * u - ORIGIN[0], y * u - ORIGIN[1])
    else:
        cp = [[float(v) for v in q.split(",")] for q in sp["cp"].split(";")]
        f = fit_of([[x * u, y * u, X, Y] for x, y, X, Y in cp]); to = lambda x, y: f(x * u, y * u)
    wl, rl = re.compile(sp.get("walls", r"(?i)vegg|wall")), re.compile(sp.get("rooms", r"(?i)rom|room|area"))
    walls, segs, rooms = [], [], []
    for e in msp:
        layer, t = e.dxf.get("layer", ""), e.dxftype()
        if wl.search(layer):
            if t == "LINE":
                segs.append((to(e.dxf.start.x, e.dxf.start.y), to(e.dxf.end.x, e.dxf.end.y)))
            elif t in ("LWPOLYLINE", "POLYLINE"):
                pts = [to(p[0], p[1]) for p in (e.get_points("xy") if t == "LWPOLYLINE" else [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices])]
                if e.closed and len(pts) >= 3: walls.append([r2(p) for p in pts + [pts[0]]])
                else: segs += list(zip(pts, pts[1:]))
            elif t == "SOLID" or t == "HATCH":
                if t == "SOLID": paths = [[(v[0], v[1]) for v in (e.dxf.vtx0, e.dxf.vtx1, e.dxf.vtx3, e.dxf.vtx2)]]
                else:   # a hatch's outlines: polyline paths by their points, edge paths by their edges' starts
                    paths = [[(v[0], v[1]) for v in p.vertices] if hasattr(p, "vertices") else [(g.start[0], g.start[1]) for g in p.edges if hasattr(g, "start")] for p in e.paths]
                for p in paths:
                    pts = [to(x, y) for x, y in p]
                    if len(pts) >= 3: walls.append([r2(q) for q in pts + [pts[0]]])
        if rl.search(layer):
            if t == "INSERT" and e.attribs:
                at = {a.dxf.tag.upper(): a.dxf.text.strip() for a in e.attribs}
                pick = lambda *keys: next((v for k, v in at.items() if any(w in k for w in keys) and v), None)
                name, code, area = pick("NAVN", "NAME"), pick("ROMNR", "NUMMER", "NR", "NO"), pick("AREAL", "AREA")
                if name:
                    m = AREA.search(area + " m2") if area else None
                    rooms.append({"name": name, "code": code, "area_m2": float(m.group(1).replace(" ", "").replace(".", "").replace(",", ".")) if m else None,
                                  "at": r2(to(e.dxf.insert.x, e.dxf.insert.y))})
            elif t in ("TEXT", "MTEXT"):
                s = (e.plain_text() if t == "MTEXT" else e.dxf.text).strip()
                if s: rooms.append({"_t": s, "at": r2(to(e.dxf.insert.x, e.dxf.insert.y))})
    # loose text: a name with an area and a room number near it makes a stamp
    texts = [r for r in rooms if "_t" in r]; rooms = [r for r in rooms if "_t" not in r]
    near = lambda a, b: math.hypot(a["at"][0] - b["at"][0], a["at"][1] - b["at"][1]) < 1.5
    for n in texts:
        if AREA.search(n["_t"]) or re.fullmatch(r"[\w.\-]*\d[\w.\-]*", n["_t"]): continue
        a = next((x for x in texts if x is not n and AREA.search(x["_t"]) and near(n, x)), None)
        c = next((x for x in texts if x is not n and re.fullmatch(r"[A-ZÆØÅ]{0,3}\s?[\d.]+[A-Z]?", x["_t"]) and near(n, x)), None)
        if a or c:
            rooms.append({"name": n["_t"], "code": c["_t"] if c else None,
                          "area_m2": float(AREA.search(a["_t"]).group(1).replace(" ", "").replace(".", "").replace(",", ".")) if a else None, "at": n["at"]})
    drawn = len(walls); walls += [[r2(p) for p in w] for w in pair_lines(segs)]
    fid = f"fdv-{sp['id']}"
    gone = set(sp.get("replaces", [])) | {fid}
    data["floors"] = [f for f in data["floors"] if f["id"] not in gone]
    data["floors"].append({"id": fid, "name": sp["storey"], "wing": sp["wing"], "kote": sp["kote"], "height": sp["height"], "how": sp.get("how"),
                           "source": sp["source"], "walls": walls, "rooms": [{k: v for k, v in r.items() if v is not None} for r in rooms]})
    print(f"{fid}: {len(walls)} walls ({drawn} drawn as shapes, {len(walls) - drawn} from {len(segs)} lines in pairs), {len(rooms)} rooms; replaced {sorted(gone - {fid}) or 'nothing'}")
json.dump(data, open(floors_file, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
