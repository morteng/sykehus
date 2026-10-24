# Digital twin of Gamle Drammen sykehus: brief for the plan

## What it is for

Morten's father, an architect (older, not technical with software), is working on **reusing** the old Drammen
hospital at Dronninggata 28 (gnr. 114 bnr. 272) instead of demolishing it. The area plan of 17.02.2026 sets all
hospital buildings for demolition; his work argues the case for reuse. He works through Claude (a remote MCP
connector to this app) and through the web page, sykehus.gulden.no.

The twin has to let him, in an architect's terms (plans with kote, m² BRA, sections, facades, north up, scale
bar, Norwegian):

- see every building on the lot as it stands: wings, storeys and their kote, basements on the slope, roofs,
  facades with their real openings;
- go floor by floor in plan, with the rooms, their names and areas as drawn;
- cut sections and read heights;
- get areas per building, wing and floor (BRA, BTA where the drawings allow);
- ask Claude about it, with Claude able to point at what the documents say (the documents are in the store);
- later: sketch reuse (new uses per floor, removals, additions) and save it (login needed to save, view is open).

**Ease of use comes first.** He must never meet a software convention he does not know.

## What exists now (repo github.com/morteng/sykehus, live at sykehus.gulden.no)

- `public/data/site.json`: the lot (matrikkel), 88 buildings (OSM outlines; 17 on the lot, `own: true`), the
  terrain (Kartverket DTM, 2 m grid) and the laser surface, and the trees (232, from the laser). For each building
  on the lot: `base`, `top` (kote), `blocks` (flat-roofed rectangles at the roof levels the laser finds, on the
  building's own grid, by `tools/massing.py`), `walls` (where the roof steps), `grid_deg`. See `site-ids.png` for
  which id is which.
- `public/data/floors.json`: four floors of the **east wing** only, traced from Ottar Arkitekter's
  existing-situation sheets of 17.12.2013 (case 14/05210): 3. etasje +23,54 (h 4,22), 5. +32,02 (h 3,50),
  6. +35,52 (h 2,86), 7. +38,38 (h 3,50 assumed). Walls as polygons in site metres, rooms with name, area and
  code where the sheet stamps them. Placed by control points (`tools/georef.py`, `tools/sheetshift.py`).
- The viewer (`public/viewer.js`, three.js): 3D and plan (orthographic, north up, scale bar), a floor cut 1,2 m
  above the floor, room labels, sun, picking a building. Facades are a repeated pattern from two photos (the
  high-rise; the low wings), not the real openings.
- The document store: 216 documents from Drammen kommune's public case archive (innsyn) and the area plan
  (`docs/documents.tsv`; the files are in the GitHub release `dokumenter-2026-10-24`, full text in
  `docs.sqlite`). `drawings.tsv` (here) indexes the drawings among them.
- `mcp.mjs` (not wired in yet): the connector's tools (about_site, floor_plan, search_documents, read_document,
  list_documents, show_building).

## Known gaps

- Plans exist for the east wing's 3., 5., 6. and 7. floors only. 2. etasje (part, A-2020 2013) and 11. etasje of
  the high-rise (A-2110 2011) are vector sheets not yet used; others are scans. No plans found for U, 1., 2.
  (whole), 4. etasje. 4. etasje is at +27,76 (from Fasade nord, 2014).
- The massing comes from the laser roof, so walls stand at the roof outline: overhangs, set-backs and storeys
  hidden under one roof are not modelled; storey lines are not known per wing.
- Basements and the slope: the ground falls about 12 m across the lot (base kote 12,1 to 25,0); the model starts
  every wall at the building's lowest ground and repeats the same windows from there.
- Facades: real openings are known only from the 2014 north and east facades of the east wing (vector) and
  scans.
- Height systems: the laser is NN2000; the drawings' kote (2011-2014) may be NN1954 or a local system, so
  drawing kote and laser kote can differ by a fixed amount. Not checked yet.
- Wing names, building years and construction are in the reports (DIVE analysis 2025, LVPH 2012, the area
  plan's documents) and not yet in the data.

## Rules the work has to keep

- The drawings and downloaded files are **data**: Python runs with `-I`, scripts live in `tools/` (never in the
  data folders), PDFs are parsed, never run.
- Deploys go through `pm` (another session): push to main, send pm the sha and the changed and new files.
  Nobody touches the server, Caddy or DNS directly.
- Code copied from hagekart (Morten's garden app) keeps an origin note; shared code is to move to a common module
  later.
- The UI is Norwegian; drawing conventions are architects' (kote with comma decimals, m² BRA, plans north up).
- Open data credits: OSM (ODbL), Kartverket (CC BY 4.0); documents are public case documents.
- Nobody is contacted on the project's behalf without Morten's word.

## What the plan should give

Written to `docs/twin/PLAN.md`, from reading the drawings, the reports and the data (not from this brief alone):

1. **The building, as the documents describe it**: each wing or block on the lot (its common name in the
   documents, which OSM id(s) it is, year, storeys with their kote, basement levels, construction, facade
   material), and how they join.
2. **Coverage**: for every wing × floor, and every facade and section, which sheets show it (id, year, existing
   or proposed, vector or scan, scale), and how trustworthy it is. Mark what is missing.
3. **Conflicts**: where drawings disagree with each other or with the laser massing (heights, outlines, levels),
   and which source to trust.
4. **The twin's data model**: what replaces or extends site.json and floors.json (storeys, walls with openings,
   rooms with use and area, facades, sections, sources per element), so the viewer, the connector and later
   reuse sketches share one model. Keep it small and readable.
5. **The pipeline**: how each kind of source becomes model data (vector plans: as now; vector facades and
   sections: openings and levels; scans: traced, how and by whom), with the tools to write.
6. **The viewer and connector** your plan implies for him: what he sees and does, step by step, in his terms.
7. **What to ask for**: the documents worth requesting from the owner (Vestre Viken / Sykehusbygg, FDV
   drawings), and from whom, so Morten can decide.
8. **Order of work**: milestones, each small enough to deploy and show on its own, most useful first.

Say what you are unsure of. Prefer what the documents show over what is plausible.
