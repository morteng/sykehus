#!/bin/sh
# U3570 bake-off on the box. Builds the images, runs the control try, then A1 B1 A2 B2 A3 B3:
# ask the model (harness, with network), run the script (a fresh worker, no network), one fix try if it failed,
# check what it made (full worker), and write RUNS/results.md. Stops asking at the cap (2 USD).
#   bake.sh RUNS ENV_FILE        e.g. bake.sh /srv/bake/u3570 /srv/stack/.env
set -u
here=$(cd "$(dirname "$0")" && pwd)
runs=$(mkdir -p "$1" && cd "$1" && pwd); envf=$2

docker build -q -t freecad-worker -f "$here/Dockerfile" "$here" >/dev/null || exit 1
docker build -q -t freecad-worker-lite -f "$here/Dockerfile.lite" "$here" >/dev/null || exit 1
docker build -q -t bake-harness -f "$here/Dockerfile.harness" "$here" >/dev/null || exit 1
docker run --rm freecad-worker cat /opt/versions.json > "$runs/versions-full.json"
docker run --rm freecad-worker-lite cat /opt/versions.json > "$runs/versions-lite.json"
docker image ls --format '{{.Repository}} {{.Size}}' | grep -E '^(freecad-worker|freecad-worker-lite|bake-harness) ' > "$runs/images.txt"

# The harness: network, the env file read-only and read by name; it never runs a worker
harness() { docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$runs:/runs" -v "$envf:/run/bake.env:ro" bake-harness "$@" --env-file /run/bake.env; }

# A script in a fresh worker: its dir only, no network. Writes run.log, status (exit code), time.txt
work() {
  d=$1; img=$2
  t0=$(date +%s.%N)
  "$here/run.sh" "$d" "$img" python script.py > "$d/run.log" 2>&1
  s=$?
  awk "BEGIN { printf \"%.1f\", $(date +%s.%N) - $t0 }" > "$d/time.txt"
  [ $s -eq 0 ] && { [ -f "$d/greenhouse.ifc" ] && [ -f "$d/greenhouse.glb" ] || s=99; }
  echo $s > "$d/status"
  return $s
}

mkdir -p "$runs/control"; cp "$here/control.py" "$runs/control/script.py"
work "$runs/control" freecad-worker; sed 's/^/  /' "$runs/control/run.log"

for n in 1 2 3; do
  for r in A B; do
    t=$r$n; img=freecad-worker; [ $r = B ] && img=freecad-worker-lite
    harness ask $t; a=$?
    [ $a -eq 3 ] && break 2
    [ $a -ne 0 ] && continue
    d="$runs/$t"
    if ! work "$d" $img; then
      harness fix $t && { d="$runs/$t-fix"; work "$d" $img; }
    fi
    TOOLS="$here" LIMIT=400 "$here/run.sh" "$d" freecad-worker python /tools/check.py | tail -2
  done
done
docker run --rm --user "$(id -u):$(id -g)" -e RUNS_HOST="$runs" -v "$runs:/runs" bake-harness table
