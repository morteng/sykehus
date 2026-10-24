# Sykehustomta

Gamle Drammen sykehus (Dronninggata 28, gnr. 114 bnr. 272) in 3D and in plan, floor by floor, for working on
reusing the buildings. Open to everyone to look at and try; saving needs a login (to come).

    PORT=8090 node server.mjs

Data, built by the tools (Python runs with `-I`; the drawings are downloaded files and read as data):

- `node tools/site.mjs <lot.json> <dom.tif> <dtm.tif> <x0,y0,x1,y1> [osm.json]`: `public/data/site.json`, the lot,
  the buildings (OpenStreetMap outlines, Kartverket laser heights) and the terrain.
- `python3 -I tools/massing.py public/data/site.json <dom.tif> <x0,y0,x1,y1>`: clean massing for the buildings on the
  lot (flat-roofed blocks on each building's grid, at the roof levels the laser finds), written into site.json.
- `node tools/floors.mjs <drawings folder> <work folder>`: `public/data/floors.json`, the walls of each drawing in
  `tools/plans.json`, placed on the site from its control points and stood at its kote.
- `python3 -I tools/ingest.py <sources> <data dir> [report.md]`: the document store (`docs.sqlite`, full text).

`tools/osm-buildings.mjs`, `tools/osm-rings.mjs`, `public/sun.js` and `public/vendor/` are copied from hagekart
(each says so); they are to move to a shared module once both apps are stable.

## Licence and data

The code is MIT (`LICENSE`); three.js in `public/vendor/` is MIT too (`LICENSE-three.txt`).

`public/data/site.json` is built from open data: building outlines © OpenStreetMap contributors (ODbL 1.0,
openstreetmap.org/copyright), laser heights and terrain © Kartverket (hoydedata.no, CC BY 4.0), the lot outline
from Kartverket's matrikkel. The derived site.json is shared under the ODbL.

The floor walls in `public/data/floors.json` are traced from the existing-situation drawings in Drammen kommune's
public building-case archive (each floor names its source drawing and architect). The documents themselves are not
in this repository; build the document store locally with the tools.
