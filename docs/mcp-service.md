# Runbook: the Sykehustomta service (connector and drafts)

What runs: `server.mjs`, one Node process. It serves `public/` as Caddy does today, and adds:

| Path | What |
|---|---|
| `POST /mcp` | the connector for chat apps (mcp.mjs), MCP **2026-07-28** over Streamable HTTP (JSON answers, no sessions, no SSE); older clients' `initialize` (2025-03-26 … 2025-11-25) still works |
| `GET /api/utkast/<id>` | a draft's tried changes, read by the page's `?utkast=<id>` and by the chat app |
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
- Drafts live in memory for a day (at most 500, 200 changes each). A restart drops them: that is by design until
  saving with a login exists (docs/rulings.md).

## Caddy

Either proxy everything to the process, or keep serving `public/` statically and proxy only:

```
handle /mcp* { reverse_proxy 127.0.0.1:8090 }
handle /api/* { reverse_proxy 127.0.0.1:8090 }
```

No CORS needed for the website itself; chat hosts call `/mcp` server to server. The server checks `Origin` on
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
