"""Vector linework from one page of a CAD-exported PDF: filled shapes (walls are filled grey in these drawings) and stroked lines.

  python3 -I tools/pdfpaths.py <file.pdf> <page 1..> <out.json> [out.svg]

Follows the content stream (q/Q/cm, path operators, fills and strokes, Form XObjects) and writes every path in page
points (origin bottom left, y up), with its fill or stroke colour and line width. Curves are flattened to 8 segments.
Text is not read here. The PDF is data: pypdf parses it, nothing in it runs."""
import sys, json
from pypdf import PdfReader
from pypdf.generic import ContentStream

path, pageno, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
svg = sys.argv[4] if len(sys.argv) > 4 else None
reader = PdfReader(path)
page = reader.pages[pageno - 1]

def mul(a, b):  # 3x2 affine [a b c d e f]: a then b
    return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]]
def ap(m, x, y): return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])

shapes = []
def run(content, res, ctm0):
    st = {"ctm": ctm0, "fill": [0], "stroke": [0], "lw": 1.0}
    stack, subs, cur = [], [], None
    def flush(kind):
        nonlocal subs, cur
        if cur: subs.append(cur)
        polys = [s for s in subs if len(s) > 1]
        if polys:
            scale = (abs(st["ctm"][0] * st["ctm"][3] - st["ctm"][1] * st["ctm"][2])) ** 0.5
            shapes.append({"k": kind, "fill": st["fill"], "stroke": st["stroke"], "lw": round(st["lw"] * scale, 3), "p": [[[round(x, 2), round(y, 2)] for x, y in s] for s in polys]})
        subs, cur = [], None
    for ops, op in ContentStream(content, reader).operations:
        o = op.decode() if isinstance(op, bytes) else op
        n = [float(v) for v in ops if isinstance(v, (int, float)) or hasattr(v, "as_numeric")] if o in ("m", "l", "c", "v", "y", "re", "cm", "w", "g", "G", "rg", "RG", "k", "K", "sc", "SC", "scn", "SCN") else []
        if o == "q": stack.append(dict(st))
        elif o == "Q": st = stack.pop() if stack else st
        elif o == "cm": st["ctm"] = mul(n, st["ctm"])
        elif o == "w": st["lw"] = n[0]
        elif o in ("g", "rg", "k", "sc", "scn"): st["fill"] = n
        elif o in ("G", "RG", "K", "SC", "SCN"): st["stroke"] = n
        elif o == "m":
            if cur: subs.append(cur)
            cur = [ap(st["ctm"], n[0], n[1])]
        elif o == "l" and cur is not None: cur.append(ap(st["ctm"], n[0], n[1]))
        elif o in ("c", "v", "y") and cur is not None:
            p0 = cur[-1]; pts = [ap(st["ctm"], n[i], n[i + 1]) for i in range(0, len(n), 2)]
            if o == "v": pts = [p0] + pts
            if o == "y": pts = pts + [pts[-1]]
            c1, c2, p3 = pts[-3], pts[-2], pts[-1]
            for i in range(1, 9):
                t = i / 8; u = 1 - t
                cur.append((u ** 3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * p3[0], u ** 3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * p3[1]))
        elif o == "re":
            if cur: subs.append(cur)
            x, y, w, h = n; m = st["ctm"]
            subs.append([ap(m, x, y), ap(m, x + w, y), ap(m, x + w, y + h), ap(m, x, y + h), ap(m, x, y)]); cur = None
        elif o == "h" and cur: cur.append(cur[0])
        elif o in ("f", "F", "f*"): flush("fill")
        elif o in ("S", "s"): flush("stroke")
        elif o in ("B", "B*", "b", "b*"): flush("both")
        elif o == "n": subs, cur = [], None
        elif o == "Do":
            name = ops[0]; xo = (res.get("/XObject") or {}).get(name)
            if xo is not None:
                xo = xo.get_object()
                if xo.get("/Subtype") == "/Form":
                    m = [float(v) for v in xo.get("/Matrix", [1, 0, 0, 1, 0, 0])]
                    run(xo, xo.get("/Resources") or res, mul(m, st["ctm"]))

run(page.get_contents(), page.get("/Resources") or {}, [1, 0, 0, 1, 0, 0])
W, H = float(page.mediabox.width), float(page.mediabox.height)
json.dump({"file": path.split("/")[-1], "page": pageno, "w": W, "h": H, "shapes": shapes}, open(out, "w"))
from collections import Counter
print(len(shapes), "paths;", Counter((s["k"], tuple(round(v, 2) for v in (s["fill"] if s["k"] != "stroke" else s["stroke"]))) for s in shapes).most_common(8))
if svg:
    def col(c):
        if len(c) == 1: v = int(c[0] * 255); return f"rgb({v},{v},{v})"
        if len(c) == 3: return "rgb(%d,%d,%d)" % tuple(int(v * 255) for v in c)
        if len(c) == 4: k = c[3]; return "rgb(%d,%d,%d)" % tuple(int(255 * (1 - v) * (1 - k)) for v in c[:3])
        return "black"
    with open(svg, "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W * 2}" height="{H * 2}"><rect width="100%" height="100%" fill="white"/><g transform="translate(0 {H}) scale(1 -1)">')
        for s in shapes:
            d = " ".join("M" + " L".join(f"{x},{y}" for x, y in p) for p in s["p"])
            if s["k"] == "stroke": f.write(f'<path d="{d}" fill="none" stroke="{col(s["stroke"])}" stroke-width="{max(0.1, s["lw"])}"/>')
            else: f.write(f'<path d="{d}" fill="{col(s["fill"])}" fill-rule="evenodd" stroke="none"/>')
        f.write("</g></svg>")
