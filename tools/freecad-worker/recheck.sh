#!/bin/sh
# Check again what the tries made, with no model call: each try dir in RUNS with a greenhouse.ifc, in a fresh
# freecad-worker (rebuilt from this Dockerfile, now with lark for the open test), then the table.
#   recheck.sh RUNS          e.g. recheck.sh /srv/bake/u3570
set -u
here=$(cd "$(dirname "$0")" && pwd); runs=$(cd "$1" && pwd)
docker build -q -t freecad-worker -f "$here/Dockerfile" "$here" >/dev/null || exit 1
docker build -q -t freecad-worker-lite -f "$here/Dockerfile.lite" "$here" >/dev/null || exit 1
docker image ls --format '{{.Repository}} {{.Size}}' | grep -E '^(freecad-worker|freecad-worker-lite) ' > "$runs/images.txt"; cat "$runs/images.txt"
for d in "$runs"/*/; do
  [ -f "$d/greenhouse.ifc" ] || continue
  printf '%s ' "$(basename "$d")"
  TOOLS="$here" LIMIT=400 "$here/run.sh" "$d" freecad-worker python /tools/check.py | tail -1
  python3 -c "import json,sys; c=json.load(open(sys.argv[1])); print('  glb', c['glb'], '| FreeCAD', c.get('freecad'))" "$d/check.json"
done
docker build -q -t bake-harness -f "$here/Dockerfile.harness" "$here" >/dev/null && docker run --rm --user "$(id -u):$(id -g)" -e RUNS_HOST="$runs" -v "$runs:/runs" bake-harness table
