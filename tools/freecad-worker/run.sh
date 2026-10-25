#!/bin/sh
# Run one command in a fresh worker: no network, read-only root, only DIR mounted (at /work),
# 2 CPUs at low weight, 4 GB, 256 processes, LIMIT seconds (300). TOOLS, if set, is mounted read-only at /tools.
#   run.sh DIR IMAGE CMD...
set -eu
dir=$(cd "$1" && pwd); image=$2; shift 2
tools=""; [ -n "${TOOLS:-}" ] && tools="-v $(cd "$TOOLS" && pwd):/tools:ro"
# shellcheck disable=SC2086
exec docker run --rm --network none --read-only --tmpfs /tmp:rw,size=512m \
  --cpus 2 --cpu-shares 256 --memory 4g --memory-swap 4g --pids-limit 256 \
  --cap-drop ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e MPLCONFIGDIR=/tmp \
  -v "$dir:/work" $tools -w /work "$image" \
  timeout -k 5 "${LIMIT:-300}" nice -n 10 "$@"
