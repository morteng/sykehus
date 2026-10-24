"""Builds the document store: every file under a sources folder into DATA_DIR/docs.sqlite, with its text for search.

  python3 -I tools/ingest.py <sources dir> <data dir> [report.md ...]

The files are treated as data only: pypdf parses PDFs (nothing in them runs), Word files are read as zipped XML.
Each distinct file (by content) is copied to <data dir>/files/<id><ext> once; the same drawing filed in several
building cases keeps one copy and lists every case. The server opens docs.sqlite read-only; run this again to
rebuild it (it is replaced whole, atomically).

Search text is folded (æ→ae, ø→o, å→a, lower case) so "rontgen" finds "røntgen"; the page text is kept as written."""
import sys, os, re, json, hashlib, shutil, sqlite3, zipfile, csv, html
from pypdf import PdfReader

SRC, DATA = sys.argv[1], sys.argv[2]
REPORTS = sys.argv[3:]
FILES = os.path.join(DATA, "files")
os.makedirs(FILES, exist_ok=True)

def fold(s):
    s = s.lower()
    for a, b in (("æ", "ae"), ("ø", "o"), ("å", "a"), ("ä", "a"), ("ö", "o"), ("é", "e"), ("ü", "u")): s = s.replace(a, b)
    return s

def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()

# where a downloaded drawing came from: the research agent's manifest (file -> url -> journal row)
URLS = {}
for root, _, files in os.walk(SRC):
    for fn in files:
        if fn == "_MANIFEST.tsv":
            with open(os.path.join(root, fn), newline="") as f:
                for row in csv.DictReader(f, delimiter="\t"): URLS[row["filename"]] = (row.get("source_url") or "", row.get("journal_row") or "")

CASE = re.compile(r"^(\d\d)-(\d{5})-(\d+)__(.*)$")
def describe(rel, fn):
    """title, kind, year, case from the file name and folder"""
    stem, ext = os.path.splitext(fn)
    m = CASE.match(stem)
    if m:
        yy, nr, part, rest = m.groups()
        t = re.sub(r"^(VEDLEGG|Vedlegg)[_ ]+[A-Z]?[\d.]*[_ ]*-?[_ ]*", "", rest)
        return t.replace("_", " ").strip(" -") or rest, "tegning", 2000 + int(yy), f"{yy}/{nr}-{part}"
    top = rel.split(os.sep)[0]
    y = re.match(r"^(\d{4})", fn)
    title = re.sub(r"^\d{4}(-\d\d)?_", "", stem).replace("_", " ").replace("-", " ").strip()
    kind = {"kulturminnesok": "kulturminne", "DIVE_figurer": "figur", "samlerapport_figurer": "figur"}.get(top)
    if not kind:
        low = fn.lower()
        kind = "plan" if "or-bsv" in low or "planinitiativ" in low or "plankart" in low or "oppstartsmote" in low else "saksdokument" if ext.lower() == ".docx" else "rapport"
    return title, kind, int(y.group(1)) if y else None, None

def pdf_pages(path):
    r = PdfReader(path)
    out, sheet = [], None
    for i, p in enumerate(r.pages):
        if i == 0: sheet = f"{round(float(p.mediabox.width) * 25.4 / 72)}x{round(float(p.mediabox.height) * 25.4 / 72)}"
        try: t = p.extract_text() or ""
        except Exception: t = ""
        out.append(re.sub(r"[ \t]+", " ", t).strip()[:20000])
    return out, sheet

def docx_pages(path):
    with zipfile.ZipFile(path) as z: x = z.read("word/document.xml").decode("utf8", "replace")
    paras = [html.unescape(re.sub(r"<[^>]+>", "", p)) for p in re.findall(r"<w:p[ >].*?</w:p>", x, flags=re.S)]
    text = "\n".join(p for p in paras if p.strip())
    return [text[i:i + 6000] for i in range(0, len(text), 6000)] or [""], None

def json_pages(path):
    d = json.load(open(path))
    return [json.dumps(d, ensure_ascii=False, indent=1)[:20000]], None

tmp = os.path.join(DATA, "docs.sqlite.new")
if os.path.exists(tmp): os.remove(tmp)
db = sqlite3.connect(tmp)
db.executescript("""
CREATE TABLE docs (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, year INTEGER, file TEXT NOT NULL, ext TEXT NOT NULL,
  bytes INTEGER NOT NULL, pages INTEGER NOT NULL, has_text INTEGER NOT NULL, sheet TEXT, names TEXT NOT NULL, cases TEXT NOT NULL, urls TEXT NOT NULL);
CREATE TABLE pages (doc TEXT NOT NULL, n INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (doc, n));
CREATE VIRTUAL TABLE fts USING fts5(doc UNINDEXED, n UNINDEXED, title, text, tokenize = "unicode61 remove_diacritics 2");
""")
seen = {}
paths = []
for root, _, files in os.walk(SRC):
    for fn in sorted(files):
        if fn.startswith(".") or fn == "_MANIFEST.tsv" or fn.endswith("_alle_vedlegg.json") or fn.endswith(".tsv"): continue
        paths.append(os.path.join(root, fn))
paths += REPORTS
for path in sorted(paths):
    fn = os.path.basename(path); rel = os.path.relpath(path, SRC) if path.startswith(SRC) else fn
    ext = os.path.splitext(fn)[1].lower()
    h = sha(path); did = h[:12]
    title, kind, year, case = describe(rel, fn)
    url, journal = URLS.get(fn, ("", ""))
    if did in seen:
        d = seen[did]
        if case and case not in d["cases"]: d["cases"].append(case)
        if url and url not in d["urls"]: d["urls"].append(url)
        d["names"].append(fn); continue
    try:
        if ext == ".pdf": pages, sheet = pdf_pages(path)
        elif ext == ".docx": pages, sheet = docx_pages(path)
        elif ext == ".json": pages, sheet = json_pages(path)
        elif ext == ".md": pages, sheet = [open(path).read()[i:i + 8000] for i in range(0, os.path.getsize(path) + 1, 8000)], None; kind = "notat"; title = "Research report: the old Drammen sykehus (" + fn + ")"
        elif ext in (".jpg", ".png", ".jp2"): pages, sheet = [""], None
        else: continue
    except Exception as e:
        print("skip", fn, e, file=sys.stderr); continue
    pages = [p for p in pages] or [""]
    shutil.copyfile(path, os.path.join(FILES, did + ext))
    seen[did] = {"id": did, "title": title, "kind": kind, "year": year, "file": did + ext, "ext": ext[1:], "bytes": os.path.getsize(path), "pages": pages,
                 "has_text": int(sum(len(p) for p in pages) > 200), "sheet": sheet, "names": [fn], "cases": [case] if case else [], "urls": [url] if url else []}

for d in seen.values():
    db.execute("INSERT INTO docs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (d["id"], d["title"], d["kind"], d["year"], d["file"], d["ext"], d["bytes"], len(d["pages"]), d["has_text"], d["sheet"],
               json.dumps(d["names"], ensure_ascii=False), json.dumps(d["cases"]), json.dumps(d["urls"])))
    for n, t in enumerate(d["pages"], 1):
        db.execute("INSERT INTO pages VALUES (?,?,?)", (d["id"], n, t))
        db.execute("INSERT INTO fts VALUES (?,?,?,?)", (d["id"], n, fold(d["title"]), fold(t)))
db.commit(); db.close()
os.replace(tmp, os.path.join(DATA, "docs.sqlite"))
kinds = {}
for d in seen.values(): kinds[d["kind"]] = kinds.get(d["kind"], 0) + 1
print(f"{len(seen)} documents ({sum(d['bytes'] for d in seen.values()) / 1e6:.0f} MB), with text: {sum(d['has_text'] for d in seen.values())}; by kind: {kinds}")
