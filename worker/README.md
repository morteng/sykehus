# The worker has moved

The job service that runs constructions' scripts and reads imported files (U3531, U3570, U3571) is its own repo now:
**github.com/morteng/gulden-worker** (U3587). It moved with its history; the last version here was 07f7ad7.

sykehus reaches it through `SYKEHUS_WORKER` / `GULDEN_WORKER` (`http://gulden-worker:8070`) and, for STEP,
`SYKEHUS_WORKER_FREECAD` / `GULDEN_WORKER_FREECAD` (`http://gulden-worker-freecad:8070`); see `bim.mjs` and
`docs/mcp-service.md`. `tests/bim.test.mjs` uses a stub that answers the same way, so no worker is needed to test.
