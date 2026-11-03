#!/usr/bin/env bash
# U3896: the full sykehus test run, the one command the landing gate runs (node container on prod) and a
# builder can run by hand. Runs every tests/*.test.mjs in one `node --test` and ends with ONE quotable line:
#   sykehus full run: <files> files, <tests> tests, <pass> pass, <fail> fail, <skipped> skipped, <cancelled> cancelled
# Exit code is node's (0 all pass, non-zero any fail). A landing quotes that line.
set -uo pipefail
cd "$(dirname "$0")/.."
shopt -s nullglob
files=(tests/*.test.mjs)
[ "${#files[@]}" -gt 0 ] || { echo "sykehus full run: NO TEST FILES FOUND" >&2; exit 2; }
out=$(mktemp); trap 'rm -f "$out"' EXIT
node --test "${files[@]}" 2>&1 | tee "$out" | grep -E '^not ok|^# (tests|pass|fail|cancelled|skipped) ' 
rc=${PIPESTATUS[0]}
n() { sed -n "s/^# $1 //p" "$out" | tail -1; }
printf 'sykehus full run: %s files, %s tests, %s pass, %s fail, %s skipped, %s cancelled\n' \
  "${#files[@]}" "$(n tests)" "$(n pass)" "$(n fail)" "$(n skipped)" "$(n cancelled)"
exit "$rc"
