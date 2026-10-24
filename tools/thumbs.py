"""Small pictures of the drawings the wing cards name, so the card shows each sheet and a click opens it.

  python3 -I tools/thumbs.py public/data/site.json <sheets folder> public/data/ark

<sheets folder> holds the pages as PNG, <doc>-p<page>.png (twin-pack/sheets, made from the document store). Writes
<doc>-p<page>.jpg, 480 px across, for each wing source that has one, and index.json naming them. Needs Pillow."""
import sys, os, json
from PIL import Image

site, sheets, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
pages = set()
for w in json.load(open(site, encoding="utf-8")).get("wings", []):
    for d in w.get("sources", []):
        doc = (d.get("url") or "").rsplit("/", 1)[-1].split(".")[0]
        if doc: pages.add(f"{doc}-p{d.get('page') or 1}")
index = {}
for p in sorted(pages):
    src = os.path.join(sheets, p + ".png")
    if not os.path.exists(src): continue
    im = Image.open(src).convert("RGB"); im.thumbnail((480, 480), Image.LANCZOS)
    im.save(os.path.join(out, p + ".jpg"), quality=80, optimize=True)
    index[p] = f"data/ark/{p}.jpg"
json.dump(index, open(os.path.join(out, "index.json"), "w"), indent=1)
print(len(index), "pictures of", len(pages), "pages")
