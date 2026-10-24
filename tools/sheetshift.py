"""How far one drawing sheet's page is shifted from another's, when both carry the same background (the Ottar 2013
sheets all hold the same site and street linework, in a light grey stroke, placed a little differently on each page).

  python3 -I tools/sheetshift.py <reference plan.json> <other plan.json>     (both from pdfpaths.py)

Pairs background strokes of the same shape (end-to-end vector and point count) and takes the median offset of the
pairs; prints it, and how many pairs agree within 0.05 pt. A page point on the other sheet = reference point + offset,
so control points carry over by adding it."""
import sys, json
from collections import defaultdict
import numpy as np

GREY = 0.67
def background(f):
    p = json.load(open(f))
    return [np.array(s["p"][0]) for s in p["shapes"] if s["k"] == "stroke" and all(abs(v - GREY) < 0.01 for v in s["stroke"]) and len(s["p"][0]) > 1]
key = lambda r: (round(r[-1][0] - r[0][0], 1), round(r[-1][1] - r[0][1], 1), len(r))

ref, other = background(sys.argv[1]), background(sys.argv[2])
starts = defaultdict(list)
for r in ref: starts[key(r)].append(r[0])
d = np.array([r[0] - a for r in other for a in starts.get(key(r), [])])
if not len(d): sys.exit("no shared background")
m = np.median(d, 0); agree = int((np.hypot(*(d - m).T) < 0.05).sum())
print(json.dumps({"offset": [round(float(m[0]), 3), round(float(m[1]), 3)], "agree": agree, "strokes": len(other)}))
if agree < len(other) * 0.5: sys.exit("fewer than half the background strokes agree: not the same background")
