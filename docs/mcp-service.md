# Runbook: the Sykehustomta service (connector, drafts and versions)

What runs: `server.mjs`, one Node process. It serves `public/` as Caddy does today, and adds:

| Path | What |
|---|---|
| `POST /mcp` | the connector for chat apps (mcp.mjs), MCP **2026-07-28** over Streamable HTTP (JSON answers, no sessions, no SSE); older clients' `initialize` (2025-03-26 … 2025-11-25) still works |
| `GET /api/utkast/<id>` | a draft's tried changes, read by the page's `?utkast=<id>` and by the chat app |
| `GET /api/versjon/<id>`, `GET /api/versjoner` | a saved version of the after (versions.mjs), for `?versjon=<id>`; all of them, newest first |
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
  server-sent events: no response buffering at the edge (`flush_interval -1`).

## Caddy

Either proxy everything to the process, or keep serving `public/` statically and proxy only:

```
handle /mcp* { reverse_proxy 127.0.0.1:8090 }
handle /api/* { reverse_proxy 127.0.0.1:8090 }
handle /.well-known/oauth-* { reverse_proxy 127.0.0.1:8090 }
handle /oauth/* { reverse_proxy 127.0.0.1:8090 }   # authorize and approve: forward_auth first, then header_up the secret
```

On every route: `request_header -Remote-User` and `request_header -X-Sykehus-Proxy-Auth` before anything else.

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
