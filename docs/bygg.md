# bygg: the built world on one shell (U3920)

sykehus is the first module of bygg. Its address is **bygg.gulden.no/sykehus**; hage follows as the second module.

## What this repo does for the move
- The server answers under the mount `/sykehus` (env `BYGG_MOUNT`, default `/sykehus`, empty turns it off) and at its own root, both at once.
  The prefix is taken off before any route runs; `/sykehus` alone goes to `/sykehus/` (308, the query kept).
- `/sykehus/mcp` is the connector (JSON-RPC POST). OAuth metadata, links and server card written under the mount carry it
  (`https://<PUBLIC_ORIGIN>/sykehus/...`); at the old root they stay as they were, so a person is never signed out by the rename.
- The page, the manifest and the Prospekt page use relative addresses, so they work at both places.

## Not in this repo (edge, release and core own these)
- bygg.gulden.no routes `/sykehus/*` to this app; sykehus.gulden.no forwards to bygg.gulden.no/sykehus with 308, `/mcp` included, and the old
  host goes on `stack/moved-hosts.list`; the old issuer's metadata stays served (forwarded or by alias).
- The one-server MCP at bygg.gulden.no/mcp, the gulden-ai maps (`wording()`, `FAMILY`, `sykehus_remote.py` to `bygg_remote.py`), the bygg skill set,
  the merged runbook with hagekart, and the hage module.
- The path-inserted well-known form (`/.well-known/oauth-protected-resource/sykehus/mcp`) is for the edge to map onto the mount.

## For people
Sykehustomta ligger nå på bygg.gulden.no/sykehus. Den gamle adressen sykehus.gulden.no tar deg dit av seg selv, og bokmerkene dine virker som før.
Du blir ikke logget ut. Chat-appen med den gamle adressen virker også.
