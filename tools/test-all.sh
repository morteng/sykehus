#!/usr/bin/env bash
# The full sykehus test run (U3896): every tests/**/*.test.mjs under node --test, then ONE count line.
# Run it in the node container on prod: bash tools/test-all.sh. Exit 0 only when nothing failed.
# Quote the last line («sykehus full run: ...») in a landing report.
set -u
cd "$(dirname "$0")/.." || exit 2
mapfile -t files < <(find tests -name '*.test.mjs' | sort)
[ "${#files[@]}" -gt 0 ] || { echo "sykehus full run: no test files" >&2; exit 2; }
out=$(mktemp); trap 'rm -f "$out"' EXIT
node --test "${files[@]}" >"$out" 2>&1; rc=$?
# the failing tests, by name (node prints «✖ name» lines)
grep -E '^\s*(✖|not ok) ' "$out" | sort -u | head -n 40
n() { grep -E "^(ℹ|#) $1 " "$out" | tail -n1 | awk '{print $3}'; }
echo "sykehus full run: ${#files[@]} files, $(n tests) tests, $(n pass) pass, $(n fail) fail, $(n skipped) skipped, $(n cancelled) cancelled"
[ "$rc" -eq 0 ] && [ "$(n fail)" = 0 ] && [ "$(n cancelled)" = 0 ]
