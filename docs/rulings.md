# Rulings

Morten's decisions on how Sykehustomta is built, newest last. Each names when and how it reached this repo.

- **2026-10-24 21:31Z (via pm):** his father edits through an AI agent connected to the website, not in a local
  FreeCAD. site.json, floors.json and their sources stay the truth; the IFC ("Last ned som BIM-modell",
  tools/ifc.py) is an export, not an edit path. FreeCAD is a check tool on Morten's Mac.
- **2026-10-24 21:32Z (via pm):** if a shared FreeCAD worker runs on the server, tools/ifc.py also runs as a job in
  it (build() importable, IfcOpenShell only). pm gives the job API; the worker is not built here.
- **2026-10-24 21:52Z (via pm):** "just use the best version of everything possible": sykehus stays on three.js
  0.186.1; renderkit moves up to it.
- **2026-10-24 23:06Z (via pm):** "make sure to use very latest mcp app standards": the connector is built against
  the newest MCP specification and the official MCP Apps extension at their latest releases, read from the spec
  and the ext-apps repository, not from memory. As of 2026-10-25 that is **MCP 2026-07-28** (stateless requests
  with `_meta` protocol version, `server/discover`, `resultType`, `Mcp-Method`/`Mcp-Name` headers, cacheable
  lists, Streamable HTTP without sessions) and **MCP Apps 2026-01-26** (`io.modelcontextprotocol/ui`, ext-apps
  v2.0.3; `ui://` resources as `text/html;profile=mcp-app`, tools linked by `_meta.ui.resourceUri` only, the
  postMessage bridge `ui/initialize` … `ui/update-model-context`). Older clients' `initialize` still works.
  Authorization, when saving comes: OAuth per 2026-07-28, Client ID Metadata Documents rather than dynamic
  client registration.
- **2026-10-25 17:00Z (via pm):** «and the floating lables have to be optional, make the ui/ux nice and polished and
  simple and intuitive»: the names over the 3D view and plan (the wings', the rooms' stamps) have an on/off button,
  «Navn» in the bar (key N), remembered in that browser; a section's kote stay. And a polish pass on the page.
- **2026-10-25 17:15Z (via pm):** «just give sykehus a functional feedback tool so that lars can report his wants and
  wishes that the system cannot fulfill yet»: wishes.mjs and the connector's send_wish (after asking «Skal jeg sende
  dette som et ønske?»), «Ønsker» on the page for the signed in, kept under SYKEHUS_VERSIONS_DIR/_wishes/, Morten
  (SYKEHUS_ADMINS) sees all and answers, a webhook for his notices (SYKEHUS_WISH_WEBHOOK).
- **2026-10-25 17:14Z (Morten, in the sykehus session):** «always deply, no need to ask»: what passes its tests is
  pushed and sent to pm for deploy without asking first.
- **2026-10-25 17:24Z (via pm):** «let's also think about how he can use an ipad w/pen (i think he has one) to
  draw/write instructions to anton» and «on images of model he chooses, then draws on and sends (or clears?) something
  like that»: «Tegn» freezes the view he chose as a picture; Apple Pencil draws on it (pen only, the palm rests),
  2–3 colours, «Angre», «Tøm», «Avbryt»; words by iPadOS Scribble in the message box; «Send til Anton» sends the
  picture, each stroke as site metres (raycast) and the camera, so Anton can put a try_change where he drew. Design
  first: frames at iPad size for Morten to see before it is built, and built after the pill is live.
- **2026-10-25 17:31Z (via pm):** on the «Tegn» frames (docs/design/tegn): «the general idea is ok, yes». Built once the
  pill is live; before that only behind a hidden switch, tested with a stand-in Anton.
- **2026-10-25 17:31Z (Morten, in the sykehus session):** «we need to rethink the ui to be more anton-default, move the
  floors (do we need them as separate buttons? folow anton/gulden conventions more» and «the sidebar system fab uses is
  pretty nie. erhaos pm can task a designer to hep?»: a redesign, Anton first, with fab's sidebar; a designer's frames
  first (asked of pm), then built from them.
- **2026-10-25 17:39Z (via pm):** «the way user can select edges and objects in fab and then talk to anton about the
  selection is useful. can sykehus anton do that? should be integated through the kit?»: a click picks a wing, a
  building, a storey's room or a facade (shift adds, Esc or ✕ clears); a chip «Valgt: …» in the pill as Fab's
  pill-about; each message carries selection {items: [{kind, id, label, storey?}], ids, summary} with the connector's
  ids. The chip moves to the kit when the designer specs it. Behind ?valg until the pill is live.
