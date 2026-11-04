#!/usr/bin/env python3
# ruff: noqa: E501
"""live-turn.py: ONE live Anton turn through Sykehus's own chat (/api/anton), as the page does it. For a root door run by pm.

  python3 -I tools/live-turn.py [--base URL] [--wait S] [--version ID] "<message>"   (header JSON on stdin, see below)

Prints one JSON object, never a secret:
  {"answer", "tools": [{key,label}], "approvals": n, "versions": [{version,title,changes}], "history": [last items], "ended": "done|error|timeout|approval", "error"}
Exit 0 = ended `done`; 1 = `error`, no end or an approval was asked (the turn is stopped: a write needs a person); 2 = could not run.

How it signs in: a cookie needs a 4-digit code Morten makes, so the door signs in as the edge does (auth.mjs, like box-sykehus-call): the
caller (the root wrapper) writes {"headers": {"X-Edge-Auth": ..., "X-Edge-Assertion": ...}} on stdin, sub "okter". The headers stay in this
process and are never printed. The base is the sykehus container's address, not the internet (caddy strips these headers there).
Steps: open GET /api/anton/strom, POST /api/anton {text}, read the events whose reply_to is our turn id until done/error, then
GET /api/anton/historikk for the last items (the tool results Anton saw: the added list lives there).
"""

import json
import sys
import time
import urllib.error
import urllib.request

DEFAULT_BASE = "http://127.0.0.1:8090"


def parse(argv):
    o = {"base": DEFAULT_BASE, "wait": 600.0, "version": None, "text": None}
    it = iter(argv)
    for a in it:
        if a in ("--base", "--wait", "--version"):
            try:
                v = next(it)
                o[a[2:]] = float(v) if a == "--wait" else v
            except (StopIteration, ValueError):
                raise SystemExit(f"live-turn: {a} needs a value") from None
        elif a.startswith("--"):
            raise SystemExit(f"live-turn: unknown flag {a}")
        elif o["text"] is None:
            o["text"] = a
        else:
            raise SystemExit("live-turn: one message only")
    if not o["text"] or len(o["text"]) > 4000:
        raise SystemExit("live-turn: give one message of 1-4000 characters")
    return o


def events(resp, deadline):
    ev = None
    for raw in resp:
        if time.monotonic() > deadline:
            return
        line = raw.decode("utf-8", "replace").rstrip("\n")
        if line.startswith("event:"):
            ev = line[6:].strip()
        elif line.startswith("data:") and ev:
            try:
                yield ev, json.loads(line[5:])
            except ValueError:
                pass
            ev = None


def run(opts, headers, deadline=None):
    base = opts["base"].rstrip("/")
    deadline = deadline or time.monotonic() + opts["wait"]
    h = dict(headers)

    def req(path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        hh = {**h, **({"Content-Type": "application/json"} if data is not None else {})}
        return urllib.request.Request(base + path, data=data, headers=hh)

    out = {"answer": "", "tools": [], "approvals": 0, "versions": [], "history": [], "ended": "timeout", "error": None}
    resp = urllib.request.urlopen(req("/api/anton/strom"), timeout=opts["wait"])  # noqa: S310
    try:
        body = {"text": opts["text"], **({"version": opts["version"]} if opts["version"] else {})}
        turn = json.load(urllib.request.urlopen(req("/api/anton", body), timeout=60))["id"]  # noqa: S310
        for ev, d in events(resp, deadline):
            if not isinstance(d, dict):
                continue
            if ev == "steps":
                v = {k: d.get(k) for k in ("version", "title", "changes")}
                if v not in out["versions"]:
                    out["versions"].append(v)
                continue
            if d.get("reply_to") != turn:
                continue
            if ev == "text":
                out["answer"] += str(d.get("delta") or "")
            elif ev == "tool":
                out["tools"].append({"key": d.get("key"), "label": d.get("label")})
            elif ev == "approval":
                out["approvals"] += 1
                out["ended"] = "approval"
                try:
                    urllib.request.urlopen(req("/api/anton/stopp", {}), timeout=30)  # noqa: S310
                except OSError:
                    pass
                break
            elif ev == "error":
                out["ended"], out["error"] = "error", str(d.get("code") or "")
                break
            elif ev == "done":
                out["ended"] = "done"
                break
    finally:
        resp.close()
    try:
        j = json.load(urllib.request.urlopen(req("/api/anton/historikk"), timeout=30))  # noqa: S310
        items = j.get("items", []) if isinstance(j, dict) else j
        out["history"] = items[-8:] if isinstance(items, list) else []
    except (OSError, ValueError):
        pass
    out["answer"] = out["answer"].strip()
    return out


def main():
    opts = parse(sys.argv[1:])
    try:
        headers = {str(k): str(v) for k, v in json.load(sys.stdin)["headers"].items()}
    except (ValueError, KeyError, AttributeError):
        print('live-turn: stdin must be {"headers": {...}}', file=sys.stderr)
        return 2
    try:
        out = run(opts, headers)
    except urllib.error.HTTPError as e:
        print(f"live-turn: could not run: HTTP {e.code}", file=sys.stderr)
        return 2
    except (OSError, ValueError, KeyError) as e:
        print(f"live-turn: could not run: {type(e).__name__}", file=sys.stderr)
        return 2
    print(json.dumps(out, ensure_ascii=False))
    return 0 if out["ended"] == "done" else 1


if __name__ == "__main__":
    sys.exit(main())
