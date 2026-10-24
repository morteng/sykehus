"""An index of the drawings in the document store, for building the digital twin: what each sheet shows, of which
part of the hospital, whether it is the building as it stands or a proposal, and whether its lines can be read
(a CAD export) or it is a scan (a picture of paper, to be traced by eye).

  python3 -I tools/drawings.py <docs.sqlite> <files dir> <out.tsv>

Read from each document's title and its own text (title block, labels): the kind (plan, fasade, snitt,
situasjon, himling, brann, detalj), the floors it names, eksisterende / ny, the scale, the architect, and every
kote written on it (+23,54). "lines" is how a page's drawing is made: vector when the page has many path
operators and no picture covering it, scan when one picture covers the page. The files are data: PyMuPDF reads
them (it runs no scripts in a PDF). Needs PyMuPDF (pip install pymupdf)."""
import sys, re, sqlite3, csv
import fitz   # PyMuPDF

db, files, out = sys.argv[1:4]
con = sqlite3.connect(db)
docs = con.execute("select id, title, kind, year, file, ext, pages, has_text, sheet from docs where kind in ('tegning','figur','plan') order by year, title").fetchall()
text = {d: t for d, t in con.execute("select doc, group_concat(text, ' ') from pages group by doc")}

KIND = [("himling", r"himling"), ("brann", r"brann"), ("situasjon", r"situasjon|sitplan|utomhus|kart"), ("snitt", r"snitt"),
        ("fasade", r"fasade|oppriss"), ("plan", r"plan|etasje|etg|plantegning"), ("detalj", r"detalj|utsnitt")]
WORD = {"første": 1, "andre": 2, "tredje": 3, "fjerde": 4, "femte": 5, "sjette": 6, "sjuende": 7, "syvende": 7}

def floors(s):
    f = set()
    for m in re.finditer(r"(\d{1,2})\s*\.?\s*(?:etg|etasje|et\b)|plan\s*(\d{1,2})\b|(u)\.?\s*(?:etg|etasje)|(kjeller|underetasje|sokkel)", s, re.I):
        if m.group(1) or m.group(2): f.add(str(int(m.group(1) or m.group(2))))
        else: f.add("U")
    for w, n in WORD.items():
        if re.search(w + r"\s+etasje", s, re.I): f.add(str(n))
    return sorted(f, key=lambda v: (v != "U", int(v) if v.isdigit() else 0))

def lines(path):
    """vector: the first page draws its lines; scan: one picture covers most of it; mixed: both"""
    try:
        d = fitz.open(path); p = d[0]; area = p.rect.width * p.rect.height
        paths = len(p.get_drawings())
        cover = max([r.width * r.height for x in p.get_images(full=True) for r in p.get_image_rects(x[0])] or [0]) / area
        kind = "vector" if paths > 300 and cover < 0.5 else "scan" if cover >= 0.5 and paths < 300 else "mixed" if cover >= 0.5 else "text"
        return kind, f"{p.rect.width:.0f}x{p.rect.height:.0f}", paths
    except Exception:
        return "?", "", 0

rows = []
for id_, title, kind, year, file, ext, pages, has_text, sheet in docs:
    t = text.get(id_, "") or ""; s = f"{title} {t[:4000]}"
    k = next((name for name, rx in KIND if re.search(rx, title, re.I)), None) or next((name for name, rx in KIND if re.search(rx, t[:1500], re.I)), "annet")
    state = ("eksisterende+ny" if re.search(r"eksisterende|eks\.?\b", s, re.I) and re.search(r"\bny\b|ombygging|nytt", s, re.I)
             else "eksisterende" if re.search(r"eksisterende|eks\.?\b|ajourført", s, re.I) else "ny" if re.search(r"\bny\b|ombygging|nytt|revidert", s, re.I) else "")
    scale = sorted(set(re.findall(r"1\s*:\s*(\d{2,4})\b", s)), key=int)
    arch = next((a for a in ["Ottar", "Arkitektgruppen Cubus", "LPO", "Nordic", "Link", "Rambøll", "Sweco", "Norconsult", "COWI", "Multiconsult", "Hille Melbye", "Narud Stokke Wiig", "Arcasa", "Spacegroup"] if re.search(a, s, re.I)), "")
    kotes = sorted(set(float(k.replace(",", ".")) for k in re.findall(r"\+\s?(\d{1,3},\d{2})\b", t)))
    ln, size, paths = lines(f"{files}/{file}") if ext == "pdf" else ("picture", "", 0)
    rows.append([id_, year or "", title, k, " ".join(floors(s)), state, ln, paths, pages, size, " ".join("1:" + v for v in scale), arch, " ".join(f"{v:.2f}" for v in kotes[:30])])

with open(out, "w", newline="") as f:
    w = csv.writer(f, delimiter="\t", lineterminator="\n")
    w.writerow(["id", "year", "title", "kind", "floors", "state", "lines", "paths", "pages", "page_pt", "scale", "architect", "kotes"])
    w.writerows(rows)
from collections import Counter
print(len(rows), "drawings;", dict(Counter(r[3] for r in rows)), dict(Counter(r[6] for r in rows)))
