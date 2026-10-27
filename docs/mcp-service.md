# Runbook: the Sykehustomta service (connector, drafts and versions)

What runs: `server.mjs`, one Node process. It serves `public/` as Caddy does today, and adds:

| Path | What |
|---|---|
| `POST /mcp` | the connector for chat apps (mcp.mjs), MCP **2026-07-28** over Streamable HTTP (JSON answers, no sessions, no SSE); older clients' `initialize` (2025-03-26 … 2025-11-25) still works |
| `GET /api/utkast/<id>` | a draft's tried changes, read by the page's `?utkast=<id>` and by the chat app |
| `GET /api/versjon/<id>`, `GET /api/versjoner` | a saved version of the after (versions.mjs), for `?versjon=<id>`; all of them, newest first |
| `GET /mcp/server-card` | the Server Card (SEP-2127, `application/mcp-server-card+json`, CORS `*`, an hour's cache, ETag): who the server is and where `/mcp` is, no tools |
| `GET /api/bim/<sha>/<mesh.json, model.ifc, model.glb>` | what a construction's script made (bim.mjs, U3570), by the sha of its script and parameters |
| `GET /favicon.ico`, `/apple-touch-icon.png`, `/apple-touch-icon-precomposed.png` | the Gulden mark (`public/icons/`, gulden-ai's), also linked from the page and named in serverInfo.icons and on each tool |
| `GET /mcp-app.js` (static) | the in-chat view, MCP Apps **2026-01-26** (`ui://sykehus/bygget`, `text/html;profile=mcp-app`) |

Needs: Node 22 or newer (node:sqlite, ESM module detection). No npm packages. About 150 MB memory.

## Start

```
PORT=8090 DOCS=/media/sykehus/docs.sqlite PUBLIC_ORIGIN=https://sykehus.gulden.no node server.mjs
```

- `DOCS`: the document store (docs.sqlite from the release dokumenter-2026-10-24, read-only). Without it the
  document tools answer "not loaded" and the rest works.
- `PUBLIC_ORIGIN`: the origin written into links and into the chat app's `<base>`; without it, `https://<Host>`.
- The data files (`public/data/site.json`, `floors.json`) are read at start: **restart after each deploy**.
- Drafts live in memory for a day (at most 500, 200 changes each). A restart drops them, by design: what is to be
  kept is saved as a version.
- `SYKEHUS_VERSIONS_DIR`: where versions are kept, one JSON file each (on its own volume; back it up). Without it,
  new_version says versions are not kept here, and the rest works.
- `SYKEHUS_PROXY_SECRET`: the `Remote-User` header counts as the login only when `X-Sykehus-Proxy-Auth` carries this
  secret (compared in constant time). Anton sends both on its internal calls; Caddy adds the secret after forward_auth
  on the consent routes. The edge strips both headers from everything clients send.
- `SYKEHUS_TOKENS`: a JSON file `{ "<sha256 hex of the token>": "<login>" }` for MCP clients such as Claude Code
  (`Authorization: Bearer <token>`). Only the hashes are stored; re-read at start.
- OAuth for claude.ai (auth.mjs, hagekart's server): `/.well-known/oauth-*`, `/oauth/register`, `/oauth/token` open;
  `/oauth/authorize` and `/oauth/approve` behind the gulden.no login (forward_auth, then `header_up X-Sykehus-Proxy-Auth`).
  Grants (token hashes only) in `SYKEHUS_VERSIONS_DIR/_oauth.json`.
- A tool that keeps a version answers HTTP 401 with the sign-in challenge without a login; looking, trying (drafts)
  and reading versions stay open. Tool calls are counted per login and per hashed address; anonymous calls are held
  to 600 an hour per address, a login to 1000. `GET /api/bruk` gives the counts for the last 14 days, to the proxy
  secret or from this machine only.
- Signing in on the page and Anton's pill (login.mjs, assistant.mjs), all four needed or «Logg inn» stays hidden:
  `SYKEHUS_COOKIE_SECRET` (32+ characters, signs the 90-day cookie), `SYKEHUS_ASSISTANT_URL` (gulden-ai's internal
  base URL), `SYKEHUS_ASSISTANT_TOKEN` (the bearer for it); optional `SYKEHUS_CODE_PATH` (default
  `/internal/sykehus/code`) and `SYKEHUS_ASSISTANT_PREFIX` (default `/internal/sykehus`, + `/chat`, `/approve`,
  `/cancel`, `/history`). The cookie counts on the page's `/api/*` only, never on `/mcp`. `/api/anton/strom` is
  server-sent events: no response buffering at the edge (`flush_interval -1`). Someone signed in on gulden.no needs no
  code: `/api/*` behind laser_authz (anonymous passes) with `header_up X-Sykehus-Proxy-Auth`, and Remote-User counts.
- Wishes (wishes.mjs): kept in `SYKEHUS_VERSIONS_DIR/_wishes/`. `SYKEHUS_ADMINS` (default `morten`) see all on the
  page and answer; `SYKEHUS_ADMIN_TOKEN` (24+ characters, Bearer) reads `GET /api/onsker` and `GET /api/bruk` from
  outside the box; `SYKEHUS_WISH_WEBHOOK`, when set, gets each new wish as JSON. The proxy secret is no admin: the
  edge adds it to every page request.

## Caddy

Either proxy everything to the process, or keep serving `public/` statically and proxy only:

```
handle /mcp* { reverse_proxy 127.0.0.1:8090 }
handle /api/* { reverse_proxy 127.0.0.1:8090 }
handle /.well-known/oauth-* { reverse_proxy 127.0.0.1:8090 }
handle /oauth/* { reverse_proxy 127.0.0.1:8090 }   # authorize and approve: forward_auth first, then header_up the secret
```

On every route: `request_header -Remote-User` and `request_header -X-Sykehus-Proxy-Auth` before anything else.

**A new public path needs the edge's matcher.** On gulden-prod `public/` is not proxied whole: caddy-public sends to
sykehus-mcp only the paths in its `@sykehusoauth` list, so a path this server starts to answer (as `/mcp/server-card`,
`/favicon.ico` and `/apple-touch-icon*.png` did on 2026-10-26) answers 404 from the edge until it is added there and
caddy-public is restarted. Say so with the deploy.

Constructions (U3570) and files brought in (U3571, `/api/import`) need `SYKEHUS_WORKER` or `GULDEN_WORKER` (the worker
on the internal network, `http://gulden-worker:8070`; it is its own repo, github.com/morteng/gulden-worker, with its
AppArmor and seccomp profiles and selftest). STEP is read by the FreeCAD image: `SYKEHUS_WORKER_FREECAD` or
`GULDEN_WORKER_FREECAD` (`http://gulden-worker-freecad:8070`). Without them a construction or a file is refused in plain
words and the rest works. Their files are kept in `SYKEHUS_VERSIONS_DIR/bim/`. `/api/import` takes up to 100 MB: the
edge's body limit for that path must allow it. Anton's `find_models` and `fetch_model` (U3571 S4, signed in only) fetch
from the hosts in `fetchimport.mjs` FETCH_HOSTS and nowhere else (https, no private addresses, 100 MB, 60 s): the
service needs egress to those.

The chat app runs in the chat host's sandboxed frame on the host's own origin, and loads `mcp-app.js`, the viewer,
`data/*` and the textures from this site as a module script: those must carry `Access-Control-Allow-Origin: *`
(server.mjs sends it on every static file and on `/api/utkast/`; where Caddy serves `public/` itself, add
`header Access-Control-Allow-Origin *` there). Without it the connector's tools work and the in-chat picture stays
empty. Chat hosts call `/mcp` server to server. The server checks `Origin` on
`/mcp` (https origins or localhost only) and limits tool calls to 3000 an hour.

## Check after start

```
curl -s https://sykehus.gulden.no/mcp -H 'content-type: application/json' -H 'mcp-method: server/discover' \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}'
```

answers `supportedVersions` starting with `2026-07-28` and `capabilities.extensions["io.modelcontextprotocol/ui"]`.
The test suite runs the same against a local server: `DOCS=<docs.sqlite> node --test tests/*.mjs`.

## Checking the model (check_model)

`check_model` (read-only; target is a version or draft, as the other read tools) exports the target's IFC the way `GET /api/ifc`
does and sends it to the worker's `ifccheck` step (gulden-worker: ifctester, ifcclash, ifcdiff). `what` is `standard` (a default IDS:
names, materials, predefined types, storey elevations, project/site/building, metres), `clashes` (classes `a`, `b`, `tolerance_mm`) or
`changes` (a diff against the shared before, or against `against`). It answers in Norwegian counts, then the first findings by name,
and `todo`. It needs `SYKEHUS_WORKER` and a worker image with the step (gulden-worker, branch ifc-check); without either it says the
check cannot run and gives no result. The whole IFC is checked, the old wings too, so a run can take up to a minute.

## Connecting a chat app

Claude: Settings → Connectors → Add custom connector → `https://sykehus.gulden.no/mcp`, no login. Adding it to
Morten's or his father's account is their own act.

## A garden on a roof (T4)

`try_change` kinds `surface`, `path`, `trees`, `paint` and `fell` take `on` (a wing, by name or id) and `kote` (one of that
roof's levels from `about_wing` roof.levels; left out, the level under most of the shape). What is laid stands flat at that
kote, inside that level's rectangles (`public/roof.js`), as its own layer: a roof's surfaces never join, block or take from
the ground's, and a ground `fell` leaves a roof's trees. A surface, path or tree past the roof edge is refused with the metres
and m²; a brush stroke is cut at the edge and `after.roof_say` says by how many m². Water is not laid on a roof (use the pool
part). Each roof record has `on`, `kote` and `soil_depth_m` (assumed: a lawn 0.2 m, a bed 0.4 m, a tree by its height 0.3 to
1.2 m; for the engineer's load check, not a calculation). Its trees carry the kote as an eighth item and the wing as a ninth.
A new volume on the same roof whose foot is at that kote and covers the garden shows it as `under` (a greenhouse over a
lawn). The viewer draws roof surfaces and trees at the kote. The IFC export carries ground landscape only where it changes the
ground (a pool's basin and the terrain); a roof garden has no ground to change, so it adds no IFC element: the same rule.
**For people:** say to Anton «lag en plen med sti og tre på taket av Sentralblokka» (a greenhouse over it is a second step,
on the same roof); the lawn shows on the roof in 3D. When it sticks out past the edge, Anton says by how many metres.

## For people: drag with faint lines and typed numbers (U3878)

- When you drag a new building or a corner of a lawn, pool or path, faint dashed lines show what it lines up with: the middle of a wall, square to a wall, along a building's own direction, the mirror of a corner («symmetri») or half way between two walls («lik avstand»). Let go where a line shows and it stays exactly there.
- To set an exact number, press a digit while you drag (a building: «Lengde», «Bredde», «Retning» or «Flytt»; a corner: «Lengde»; an edge: «Flytt»), type it and press Enter. Esc drops what you typed. Hold Alt (Option) to turn all snapping off. On a touch screen use the two buttons that show while you drag: «Uten fest» and «Skriv mål».

## For people: ask Anton to measure and to check what sits on a roof (T1, T2)

- «Mål» in the top bar gives a distance, a height difference and a run between two points. Anton has the same numbers in the tool `measure`, and more: ask it «Står Palmehagen parallelt med takkanten på Sentralblokka, og hvor mye stikker den ut?» and it answers with the angle between the two axes in degrees (parallel means under 0,5°), how far to the side of the roof's axis the part stands, and how many metres (and m²) it sticks out past the roof edge. With one thing only («les tilbake Palmehagen») it gives the corners, the direction, length and width, the foot and top kote and the area. The distance is taken from the middle of each footprint at its foot; for a wing, from the middle of its biggest roof level.
- Two new parts that meet on one roof, in plan and in height, are refused when Anton tries them: the answer names both and the m² («Bassenget overlapper «Palmehagen» (61,2 m²) på taket til Sentralblokka»). Say «la dem stå slik» and Anton sends them again with `allow_overlap: true`; they are then kept, and the answer lists the meeting. Ask «Kolliderer noe på taket i Badeland?» and Anton runs `check_fit`: it names each pair and the m², what sticks out past a roof edge, what is off the lot, and says so when there is none.
- Operator: `measure` and `check_fit` read the version or draft like the other read tools (target). The maths is in `public/roof.js` (`measureParts`, `roofCollisions`) and `public/design.js` (`checkFit`, the refusal in `collideCheck`); `measure` imports distance, height difference and run from `renderkit/measure.js`, one copy with the page. A part's foot kote is stored to 0,1 m (`base_kote`), so a read-back says 73,2 where the roof level is 73,16.

## For people: ask Anton for areas and a cost range (T6)

- Say «Hvor mange kvadratmeter blir forslaget mitt, og hva koster det omtrent?». Anton (tool `summary`) answers with BTA per new volume (etasjer × fotavtrykk, «beregnet»), what is torn down (m² and m³), the ground laid per kind (m²), the earthwork (cut, fill, net m³) and a cost range. Each price in the range has its source and is «antatt»; with no price list yet Anton says the cost is «ikke målt» and gives no number. BRA shows only when a sourced factor is in the list.
- Operator: the logic is `area.mjs`; the prices are `rules/costs.json` (empty until Morten supplies sourced prices: `{ item, quantity, unit, nok_low, nok_high, source }`; `loadCosts` refuses a price with no source and the tool then errors with that line). Deploy `area.mjs` and `rules/costs.json` by name with `mcp.mjs`.
## For people: ask Anton for a plan or a section with dimensions (T5)

- Ask «Vis meg et snitt gjennom Sentralblokka med kotene» and Anton draws a section (`draw_section`) and looks at it: the cut through the building with the ground, every roof level and its kote (73,16, 69,91 and 66,41), the height between them, the storeys' kote on the left, dimension lines along the bottom and a centre axis, and a small arrow for where north lies. It says the kotes in words too. Without «på tvers» or «på langs» Anton picks the cut that goes through most of the roof levels; you can ask for a cut through a new building by its name. «Tegn en plan av Sentralblokka» (`draw_plan`) gives the roof seen from above, north up, with length, width, the axis direction, a kote on each roof level and a scale bar; «i 1:500» sets the scale, and if it does not fit the answer names the scale that does. The length and width on the drawing are the same numbers as in «Mål» and `measure`. The picture is Anton's own to look at: it tells you what it shows in words, and nothing in the model changes. When something is wrong, say what you see and Anton draws it again.
- Operator: the drawing is made in `public/drawing.js` (primitives and words; every number comes from `measureParts`, `roofOf`, `roofPieces` and `groundAt`, one copy) and written to a PNG by `drawing-png.mjs` (its own 5 x 7 dot font, `drawing-font.mjs`); `drawtools.mjs` holds the two tools, spread into `TOOLS` in `mcp.mjs`. The picture is returned to Anton only; the person's page has no drawing mode yet.
