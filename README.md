# Sykehustomta

Gamle Drammen sykehus (Dronninggata 28, gnr. 114 bnr. 272) in 3D and in plan, floor by floor, for working on
reusing the buildings. Open to everyone to look at and try; saving needs a login (to come).

    PORT=8090 node server.mjs

The page: the site in 3D; a storey cuts every wing 1,2 m above its floor; "Plan" looks straight down with a scale
bar; a wing's card cuts it across or along its middle ("Tverrsnitt", "Lengdesnitt"), looked at square on, with what
the cut goes through filled (outer walls an assumed 0,35 m, slabs at the wing's storeys, inner walls where a plan is
drawn) and the storeys' kote beside it. The drawn sections in the archive (`public/data/sections.json`, by hand: the
wing, across or along, a point the cut goes through, the way the sheet looks; `public/data/snitt/` the sheets as JPEG)
cut the model where the sheet does and show the sheet in the card.
"Fasade" N Ø S V looks at a wing's facade square on from that side, with what stands in front of it taken away
(windows from the drawings where a facade sheet exists, marked *). In the plan a 10 m grid lies on whole UTM tens. "Skriv ut" prints the plan or the section on A4 across at a whole
scale (1:200, 1:500 ...) with the names, a title block, scale bar, north and the drawings it is made from.

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
  gives none; --check compares with the stamped areas, median about 14 % off). Where the traced walls leave a gap,
  the free space is shared out between the stamps nearby (`poly_how: "delt"`), kept only where the stamps bear it out.
  Run after trace-import.mjs.
- `python -I tools/ifc.py public/data/site.json public/data/floors.json public/data/sykehus.ifc [wing id ...]`: the
  buildings as IFC4 (BIM) for "Last ned som BIM-modell": the high block (Sentralblokka, `ENVELOPE`) with windows from the bay rule on its real storey height (U3637); a building its storeys, outer walls with the
  facades' windows and doors as real openings, slabs, roofs, the drawn plans' walls and rooms, sources on each element; quantities (Qto_*), NS 3451 parts,
  Status EXISTING and the wings' assumed materials (site.json `materials`) for schedules and takeoffs.
  Run last. Needs IfcOpenShell (0.8 or newer) and node (it reads public/bays.js and renderkit/materials.js); FreeCAD 1.1 opens the file.
- `python3 -I tools/massing.py public/data/site.json <dom.tif> <x0,y0,x1,y1>`: clean massing for the buildings on the
  lot (flat-roofed blocks on each building's grid, at the roof levels the laser finds), written into site.json.
- `python3 -I tools/trees.py public/data/site.json <dom.tif> <dtm.tif> <x0,y0,x1,y1>`: the trees, from where the laser
  surface stands over the ground outside the buildings (position, height, crown), written into site.json.
- `python3 -I tools/facades.py <forsyning.jpg> <tower.jpg>`: the facade colours, measured on photos in the case
  documents (the page draws the facades from them).
- `node tools/floors.mjs <drawings folder> <work folder>`: `public/data/floors.json`, the walls of each drawing in
  `tools/plans.json`, placed on the site from its control points and stood at its kote.
- Scanned plans (`public/data/skann/index.json` names them): `python -I tools/scanwalls.py <pdf> <page>
  public/data/skann/index.json <id> <trace.json>` finds the walls in the scan (or `- - ... --lines <linewalls.json>
  [--rooms <rooms.json>]` for a vector sheet), `python -I tools/tracefit.py <trace.json> public/data/site.json [--block]
  [--turn deg]` places it on its building's outline (two control points), and the page with `?spor` opens the trace
  mode: the sheet under the map, place it by point pairs, draw, move and delete walls and room stamps, download the
  trace. Traces are kept in `tools/traces/`; `node tools/trace-import.mjs` puts them in floors.json as floors
  `spor-<id>`. Run order: floors.mjs, trace-import.mjs, dxfimport.py, roompoly.py, ifc.py.
- FDV drawings, when they come (`docs/twin/fdv-request.md`): `python -I tools/dxfimport.py tools/fdv.json` takes each
  storey listed there (a DXF; a DWG saved as DXF first) into floors.json as `fdv-<id>`: walls from the wall layers
  (shapes as drawn, line pairs paired), room stamps from blocks or text, placed from UTM 33 or by control points, and
  the traced floors it `replaces` taken out. `python -I tests/dxfimport_check.py` runs it on a made-up drawing. Needs
  ezdxf.
- Room stamps on the traced sheets: `python -I tools/scanrooms.py <pdf> <page> public/data/skann/index.json
  <trace.json> [--debug words.json]` reads a scan's stamps (code, name, area) with the Mac's own text recognition
  (`tools/ocr.swift`, compiled on first use; macOS only) into the trace; its words, given to scanwalls.py as `--mask`,
  keep text from being taken for walls. `python -I tools/stamps.py <pdf> <page> <rooms.json>` reads the stamps of a
  vector sheet that writes them turned a quarter (SB 11), for scanwalls.py `--rooms`.
- `python3 -I tools/thumbs.py public/data/site.json twin-pack/sheets public/data/ark`: small pictures of the drawings
  the wing cards name (a click opens the PDF at the page). Needs Pillow.
- `python3 -I tools/ingest.py <sources> <data dir> [report.md]`: the document store (`docs.sqlite`, full text).

`tools/osm-buildings.mjs`, `tools/osm-rings.mjs`, `public/tex-grass.jpg` and `public/vendor/` are copied from hagekart
(each says so, or `docs/tex-credits.txt` does).

`public/renderkit/` is the `render` kit of the kits repo (github.com/morteng/kits, private, MIT; U3814, it was the renderkit repo), the 3D kit shared with laser: the sun
(`sun.js`), the quality levels (`quality.js`; this site's table and keys are in `public/quality.js`), EZ-Tree
(`ez-tree.js`) with its bark and leaf pictures, and the camera rig (`camera.js`, laser's too): a change of storey, a
building in focus and the home view ease there from where the view is, at the speed it has, and a drag, a wheel, a pinch
or the zoom buttons stop the move at once. It is taken by sha, never edited here: `renderkit.lock.json` names the
sha and each file's git blob id. Take a new sha with `node <kits>/tools/take.mjs <sha> renderkit.lock.json` (and `uikit.lock.json` at the same sha);
`node --test` fails when a copy is not the file at the locked sha. The kit is pinned to three 0.186.1, the version
this site vendors. The words of the picture camera (viewpoints, looks) are this site's own, `public/photo-set.js`; the kit's `photo.js` holds the maths.

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

## The connector

`node server.mjs` serves the site, the MCP connector at `/mcp` (MCP 2026-07-28, MCP Apps 2026-01-26: wings, storeys,
rooms, openings, documents, the building in 3D in the chat) and drafts of tried changes (`?utkast=<id>`, not saved).
Runbook: `docs/mcp-service.md`; decisions: `docs/rulings.md`. Tests: `node --test tests/*.mjs`.
