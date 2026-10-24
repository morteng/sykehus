# Sykehustomta

Gamle Drammen sykehus (Dronninggata 28, gnr. 114 bnr. 272) in 3D and in plan, floor by floor, for working on
reusing the buildings. Open to everyone to look at and try; saving needs a login (to come).

    PORT=8090 node server.mjs

Data, built by the tools (Python runs with `-I`; the drawings are downloaded files and read as data):

- `node tools/site.mjs <lot.json> <dom.tif> <dtm.tif> <x0,y0,x1,y1> [osm.json]`: `public/data/site.json`, the lot,
  the buildings (OpenStreetMap outlines, Kartverket laser heights) and the terrain.
- `python -I tools/wingparts.py <sit.json> <georef.json> <parts.json> [parts.png]`: the parts of the hospital block as
  the 1:1000 site plan draws them (from `pdfpaths.py` and `georef.py`). Needs shapely.
- `python -I tools/wings.py public/data/site.json <parts.json> tools/wings.json <dom.tif> <dtm.tif> <x0,y0,x1,y1>`: the
  block as its wings (`tools/wings.json`, by hand from the documents) in place of the OSM outlines, with names, years
  and sources. Run massing.py after it. Needs shapely.
- `python -I tools/elevations.py public/data/site.json tools/elevations.json <documents folder> <dom.tif> <x0,y0,x1,y1>`:
  windows and doors from the vector facade drawings, placed along their walls in kote, and the operating module (on
  its frame, only the facades show it). Run after massing.py. Needs PyMuPDF.
- `python -I tools/roompoly.py public/data/floors.json public/data/site.json [--check]`: each room stamp's outline,
  the space between the drawn walls around it, and its area measured (`area_calc`, shown as "ca." where the drawing
  gives none; --check compares with the stamped areas, median about 14 % off). Run after floors.mjs.
- `python -I tools/ifc.py public/data/site.json public/data/floors.json public/data/sykehus.ifc [wing id ...]`: the
  buildings as IFC4 (BIM) for "Last ned som BIM-modell": a building per wing, its storeys, outer walls with the
  facades' windows and doors as real openings, slabs, roofs, the drawn plans' walls and rooms, sources on each element.
  Run last. Needs IfcOpenShell (0.8 or newer); FreeCAD 1.1 opens the file.
- `python3 -I tools/massing.py public/data/site.json <dom.tif> <x0,y0,x1,y1>`: clean massing for the buildings on the
  lot (flat-roofed blocks on each building's grid, at the roof levels the laser finds), written into site.json.
- `python3 -I tools/trees.py public/data/site.json <dom.tif> <dtm.tif> <x0,y0,x1,y1>`: the trees, from where the laser
  surface stands over the ground outside the buildings (position, height, crown), written into site.json.
- `python3 -I tools/facades.py <forsyning.jpg> <tower.jpg>`: the facade colours, measured on photos in the case
  documents (the page draws the facades from them).
- `node tools/floors.mjs <drawings folder> <work folder>`: `public/data/floors.json`, the walls of each drawing in
  `tools/plans.json`, placed on the site from its control points and stood at its kote.
- `python3 -I tools/ingest.py <sources> <data dir> [report.md]`: the document store (`docs.sqlite`, full text).

`tools/osm-buildings.mjs`, `tools/osm-rings.mjs`, `public/tex-grass.jpg` and `public/vendor/` are copied from hagekart
(each says so, or `docs/tex-credits.txt` does).

`public/renderkit/` is renderkit (github.com/morteng/renderkit, private, MIT), the 3D kit shared with laser: the sun
(`sun.js`), the quality levels (`quality.js`; this site's table and keys are in `public/quality.js`), EZ-Tree
(`ez-tree.js`) with its bark and leaf pictures, and the camera rig (`camera.js`, laser's too): a change of storey, a
building in focus and the home view ease there from where the view is, at the speed it has, and a drag, a wheel, a pinch
or the zoom buttons stop the move at once. It is taken by sha, never edited here: `renderkit.lock.json` names the
sha and each file's git blob id. Take a new sha with `node <renderkit>/tools/take.mjs <sha> renderkit.lock.json`;
`node --test` fails when a copy is not the file at the locked sha. renderkit is pinned to three 0.186.1, the version
this site vendors.

## Licence and data

The code is MIT (`LICENSE`); three.js in `public/vendor/` is MIT too (`LICENSE-three.txt`), and so is EZ-Tree
(`docs/LICENSE-ez-tree.txt`) and renderkit. The grass, bark and leaf pictures are CC0 or MIT (`docs/tex-credits.txt`). Add
`?q=low`, `?q=mid` or `?q=high` to the address to choose how much 3D the page draws.

`public/data/site.json` is built from open data: building outlines © OpenStreetMap contributors (ODbL 1.0,
openstreetmap.org/copyright), laser heights and terrain © Kartverket (hoydedata.no, CC BY 4.0), the lot outline
from Kartverket's matrikkel. The derived site.json is shared under the ODbL.

The floor walls in `public/data/floors.json` are traced from the existing-situation drawings in Drammen kommune's
public building-case archive (each floor names its source drawing and architect). The documents themselves are not
in this repository; build the document store locally with the tools.
