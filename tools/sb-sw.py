"""Sentralblokka's south-west end (210°) as it is built: the middle part steps in, it has no windows, and a balcony runs between
the two side parts on every storey (the wishes of 2026-10-28: wRkafPSR5DS, w6_3xCgLV3U, wrAHKl9gB-e, wxp5aF4qJLt). tools/massing.py
took the end from the laser, which saw a 6 x 2 m box standing out in the middle at roof 66.41; that box is not there. Run this
after massing.py when site.json is rebuilt (the numbers below are the massing's own, on its 1 m grid); it is safe to run twice.

  python -I tools/sb-sw.py public/data/site.json

What it does to buildings[sentralblokka]:
  - takes out the middle box (the block, its three walls) and joins the two 3 m back faces into one wall, 2 m behind the side
    parts' face: the middle part is recessed, side to side;
  - writes `blind`: the walls with no windows (every wall of this end, and the recess's two side faces); tools/ifc.py gives
    them none of the bay rule's windows (a rule, where no drawing of the facade exists);
  - writes `balconies`: one run along the new back wall, out to `depth` m, storeys 2 to 14, a slab at each floor and a railing at
    its edge, which tools/ifc.py writes as IfcSlab and IfcRailing (the depth and the railing are assumed: no drawing gives them).
Then regenerate the model: tools/ifc.py (sykehus.ifc) and tools/glb.py (hoyblokka.glb)."""
import sys, json, math

MID_BLOCK = [[-33.07, -35.94], [-32.01, -34.24], [-37.1, -31.06], [-38.16, -32.76]]   # the box that stood out, t 11-17 m, 2 m deep
GONE_WALLS = [[-33.07, -35.94, -32.01, -34.24], [-37.1, -31.06, -38.16, -32.76], [-33.07, -35.94, -38.16, -32.76],
              [-29.46, -35.83, -32.01, -34.24], [-37.1, -31.06, -39.64, -29.47]]   # its two sides and front, and the two back faces it split
BACK = [-29.46, -35.83, -39.64, -29.47]   # the joined back face, ground to the roof of the recess (66.41)
RING_GONE = [[-32.2, -34.13], [-33.28, -35.79], [-37.94, -32.8], [-36.87, -31.15]]   # the outline's corners round the box
END = (-35.0, -31.0)   # the end's middle, site m
SW_BEARING = (200, 220)   # a wall whose outward normal bears this way is at the south-west end
DEPTH = 1.5   # a balcony's depth (m): the most the area plan lets one stand out (design.js BALCONY_DEPTH); the recess is 2 m

def same(a, b): return all(abs(x - y) < 0.011 for x, y in zip(a, b))

def patch(site):
    b = next(x for x in site["buildings"] if x["id"] == "sentralblokka")
    blocks = [k for k in b["blocks"] if not all(any(abs(p[0] - q[0]) < 0.011 and abs(p[1] - q[1]) < 0.011 for q in MID_BLOCK) for p in k["p"])]
    if len(blocks) != len(b["blocks"]):
        assert len(b["blocks"]) - len(blocks) == 1, "the middle box is one block"
        b["blocks"] = blocks
        walls = [w for w in b["walls"] if not any(same(w[:4], g) for g in GONE_WALLS)]
        assert len(b["walls"]) - len(walls) == 5, "five walls round the box (the massing changed: teach this script)"
        walls.append([*BACK, None, 66.41]); b["walls"] = walls
        ring = [p for p in b["ring"] if not any(same(p, q) for q in RING_GONE)]
        assert len(b["ring"]) - len(ring) == 4, "four outline corners round the box"
        b["ring"] = ring; b["area_m2"] = b["area_m2"] - 11   # the box's 5.6 x 2 m
    def inside(pt, poly):
        return sum(((p[1] > pt[1]) != (q[1] > pt[1])) and pt[0] < (q[0] - p[0]) * (pt[1] - p[1]) / (q[1] - p[1]) + p[0] for p, q in zip(poly, poly[1:] + poly[:1])) % 2 == 1
    def bearing(w):   # the compass bearing a wall faces: tools/ifc.py's rule, the side no block is on
        x0, y0, x1, y1 = w[:4]; L = math.hypot(x1 - x0, y1 - y0); n = ((y1 - y0) / L, -(x1 - x0) / L)
        mid = ((x0 + x1) / 2 + n[0] * 0.5, (y0 + y1) / 2 + n[1] * 0.5)
        if any(inside(mid, k["p"]) for k in b["blocks"]): n = (-n[0], -n[1])
        return math.degrees(math.atan2(n[0], n[1])) % 360
    near = lambda w: math.hypot((w[0] + w[2]) / 2 - END[0], (w[1] + w[3]) / 2 - END[1]) < 25   # the roof steps at the far end face this way too
    sw = [w for w in b["walls"] if near(w) and SW_BEARING[0] <= bearing(w) <= SW_BEARING[1]]
    # the recess's two side faces: the side parts' ends, 2 m long, at the back face's two ends
    ends = (BACK[:2], BACK[2:])
    sides = [w for w in b["walls"] if abs(math.hypot(w[2] - w[0], w[3] - w[1]) - 2) < 0.1 and any(math.hypot(w[i] - e[0], w[i + 1] - e[1]) < 0.6 for i in (0, 2) for e in ends)]
    b["blind"] = [list(t) for t in sorted({tuple(w[:4]) for w in sw + sides})]
    b["balconies"] = [{"from": BACK[:2], "to": BACK[2:], "depth": DEPTH, "from_storey": 2, "to_storey": 14, "top": 66.41,
                       "src": "ønskene 2026-10-28 (wRkafPSR5DS, wxp5aF4qJLt): innsnittet i sørvestenden har balkonger hele veien ned; dybde og rekkverk antatt"}]
    return b

if __name__ == "__main__":
    f = sys.argv[1]; site = json.load(open(f)); b = patch(site)
    json.dump(site, open(f, "w"), separators=(",", ":"), ensure_ascii=False)
    print(f"{len(b['blocks'])} blocks, {len(b['walls'])} walls, {len(b['blind'])} blind walls, {len(b['balconies'])} balcony run")
