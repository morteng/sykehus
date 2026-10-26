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

## Connecting a chat app

Claude: Settings → Connectors → Add custom connector → `https://sykehus.gulden.no/mcp`, no login. Adding it to
Morten's or his father's account is their own act.

## For people: drag with faint lines and typed numbers (U3878)

- When you drag a new building or a corner of a lawn, pool or path, faint dashed lines show what it lines up with: the middle of a wall, square to a wall, along a building's own direction, the mirror of a corner («symmetri») or half way between two walls («lik avstand»). Let go where a line shows and it stays exactly there.
- To set an exact number, press a digit while you drag (a building: «Lengde», «Bredde», «Retning» or «Flytt»; a corner: «Lengde»; an edge: «Flytt»), type it and press Enter. Esc drops what you typed. Hold Alt (Option) to turn all snapping off. On a touch screen use the two buttons that show while you drag: «Uten fest» and «Skriv mål».
