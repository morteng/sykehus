#!/usr/bin/env python3
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
import re
import sys
import time
import urllib.error
import urllib.request

DEFAULT_BASE = "http://127.0.0.1:8090"
ZZ_MARK = "live-turn: zz v1"  # the door (box-sykehus-turn) refuses a zztest turn for a client without this line
NAME_KEYS = ("name", "title", "project", "design", "version")


def card_args(d):
    for k in ("arguments", "args", "input", "params"):
        if isinstance(d.get(k), dict):
            return d[k]
    return {}


def walk(v):
    if isinstance(v, dict):
        for k, x in v.items():
            yield k, x
            yield from walk(x)
    elif isinstance(v, list):
        for x in v:
            yield from walk(x)


def judge(d, zz, spent):
    """(ok, target, why) for one card under the zztest policy: listed tool, no price above 0, zz-u<row>- names, budget left."""
    args = card_args(d)
    tool = str(d.get("tool") or d.get("key") or "")
    prefix = f"zz-u{zz['row']}-"
    names = [(k, x) for k, x in walk(args) if k in NAME_KEYS]
    target = next((str(x) for _, x in names if isinstance(x, str)), "")
    if tool not in zz["approve"]:
        return False, target, "tool not listed"
    if any(k == "price_usd" and not (isinstance(x, (int, float)) and not isinstance(x, bool) and x <= 0) for k, x in walk(args)):
        return False, target, "priced"
    if not names or any(not (isinstance(x, str) and x.startswith(prefix)) for _, x in names):
        return False, target, "name without prefix"
    if spent >= zz["budget"]:
        return False, target, "budget spent"
    return True, target, ""


def parse(argv):
    o = {"base": DEFAULT_BASE, "wait": 600.0, "version": None, "text": None, "zz_row": None, "zz_approve": "", "zz_budget": "0"}
    it = iter(argv)
    for a in it:
        if a in ("--base", "--wait", "--version", "--zz-row", "--zz-approve", "--zz-budget"):
            try:
                v = next(it)
                o[a[2:].replace("-", "_")] = float(v) if a == "--wait" else v
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
    if o["zz_row"] is not None:
        m = re.fullmatch(r"[Uu]?(\d{1,6})", str(o["zz_row"]))
        if not m or not o["zz_approve"]:
            raise SystemExit("live-turn: --zz-row needs a row number and --zz-approve a tool list")
        try:
            budget = int(o["zz_budget"])
        except ValueError:
            raise SystemExit("live-turn: --zz-budget needs a number") from None
        o["zz"] = {"row": m.group(1), "approve": {t.strip() for t in o["zz_approve"].split(",") if t.strip()}, "budget": budget}
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
    zz = opts.get("zz")
    if zz:
        out["approved"], out["cards"] = [], []
    resp = urllib.request.urlopen(req("/api/anton/strom"), timeout=opts["wait"])
    try:
        body = {"text": opts["text"], **({"version": opts["version"]} if opts["version"] else {})}
        turn = json.load(urllib.request.urlopen(req("/api/anton", body), timeout=60))["id"]
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
            elif ev == "approval" and zz:
                out["approvals"] += 1
                ok, target, _why = judge(d, zz, len(out["approved"]))
                tool = str(d.get("tool") or d.get("key") or "")
                decision = "accept" if ok else "reject"
                try:
                    urllib.request.urlopen(req("/api/anton/godkjenn", {"approval_id": d.get("id"), "decision": decision}), timeout=30)
                except OSError:
                    decision, ok = "reject", False
                out["cards"].append({"tool": tool, "target": target, "decision": decision, "card": d.get("id")})
                if ok:
                    out["approved"].append(tool)
                    continue
                out["ended"] = "approval"
                try:
                    urllib.request.urlopen(req("/api/anton/stopp", {}), timeout=30)
                except OSError:
                    pass
                break
            elif ev == "approval":
                out["approvals"] += 1
                out["ended"] = "approval"
                try:
                    urllib.request.urlopen(req("/api/anton/stopp", {}), timeout=30)
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
        j = json.load(urllib.request.urlopen(req("/api/anton/historikk"), timeout=30))
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
