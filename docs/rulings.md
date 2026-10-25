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
