"""U3570 bake-off: ask claude-opus-5-5 for the greenhouse script, per route, and keep the cost.

Runs in the harness container (network, never a worker). It writes the scripts; bake.sh runs them in workers.
  ask TRY  --env-file F    TRY is A1..A3 / B1..B3: the route is its letter. Writes /runs/TRY/script.py
  fix TRY  --env-file F    the same conversation, with the failure from /runs/TRY/run.log: writes /runs/TRY-fix/script.py
  table                    /runs/results.md from the checks and the ledger
The key is read from the env file by name and is never printed. The ledger stops new calls at the cap.
"""
import argparse
import json
import os
import pathlib
import re
import sys

MODEL = "claude-opus-5-5"
CAP = 2.00                                     # USD, all calls together
PRICE = {"input_tokens": 4.00, "output_tokens": 20.00,             # USD per million tokens (Opus 5.5)
         "cache_creation_input_tokens": 5.00, "cache_read_input_tokens": 0.40}
RUNS = pathlib.Path(os.environ.get("RUNS", "/runs"))
TASK = (pathlib.Path(__file__).parent / "task.txt").read_text()

ROUTES = {
    "A": ("Use FreeCAD's BIM workbench from Python (FreeCAD {freecad}): Arch Structure for the frame members, "
          "Arch Panel or a curtain wall for the glass, Arch Slab (or a structure) for the slab, and a door, with the "
          "parameters in a FreeCAD Spreadsheet. Export the IFC with FreeCAD's IFC exporter and the glTF with FreeCAD. "
          "IfcOpenShell {ifcopenshell} is installed, as FreeCAD's IFC exporter uses it."),
    "B": ("Use ifcopenshell.api (IfcOpenShell {ifcopenshell}) to write the IFC directly: IfcMember for the frame, "
          "IfcPlate for the glass, IfcSlab, IfcDoor, and the parameters in a property set. Make the glTF from the "
          "IFC with ifcopenshell.geom. FreeCAD is not installed."),
}
ENV = ("It runs as `python script.py` in an empty directory: Linux, Python {python}, headless (no display), no network, "
       "2 CPUs, 4 GB, 300 s. Installed: {installed}. Reply with the whole script in one ```python block.")


def key_from(path):
    for line in pathlib.Path(path).read_text().splitlines():
        m = re.match(r"\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=\s*(.*)$", line)
        if m:
            return m.group(1).strip().strip("'\"")
    sys.exit("no ANTHROPIC_API_KEY in the env file")


def ledger():
    p = RUNS / "ledger.jsonl"
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []


def cost_of(usage):
    return sum((usage.get(k) or 0) * v / 1e6 for k, v in PRICE.items())


def prompt_for(route):
    v = json.loads((RUNS / f"versions-{'full' if route == 'A' else 'lite'}.json").read_text())
    installed = ("FreeCAD with its BIM workbench (`import FreeCAD, Arch`), IfcOpenShell, numpy, matplotlib" if route == "A"
                 else "IfcOpenShell (ifcopenshell, ifcopenshell.api, ifcopenshell.geom), numpy")
    return TASK.strip() + "\n\n" + ROUTES[route].format(**v) + "\n" + ENV.format(installed=installed, **v)


def call(messages, tag, env_file):
    import anthropic
    spent = sum(r["usd"] for r in ledger())
    worst = max([0.25] + [r["usd"] for r in ledger()])        # the dearest call so far, or a quarter
    if spent + worst > CAP:
        print(f"cap: {spent:.3f} spent, the next could be {worst:.3f}; {CAP:.2f} is the cap. Not calling.")
        sys.exit(3)
    client = anthropic.Anthropic(api_key=key_from(env_file))
    # No refusal fallback: a fallback would answer with another model, and this measures Opus 5.5.
    with client.messages.stream(model=MODEL, max_tokens=32000, messages=messages,
                                extra_body={"output_config": {"effort": "medium"}}) as s:
        msg = s.get_final_message()
    usage = msg.usage.model_dump()
    rec = {"try": tag, "model": msg.model, "stop": msg.stop_reason, "usage": usage, "usd": round(cost_of(usage), 4)}
    with open(RUNS / "ledger.jsonl", "a") as f:
        f.write(json.dumps(rec) + "\n")
    print(f"{tag}: {msg.stop_reason}, {usage['input_tokens']} in, {usage['output_tokens']} out, "
          f"{rec['usd']:.3f} USD; {spent + rec['usd']:.3f} in all")
    return msg


def save(msg, messages, out):
    out.mkdir(parents=True, exist_ok=True)
    content = [b.model_dump(exclude_none=True) for b in msg.content]
    (out / "conversation.json").write_text(json.dumps(messages + [{"role": "assistant", "content": content}], indent=1))
    text = "".join(b.text for b in msg.content if b.type == "text")
    (out / "reply.md").write_text(text)
    blocks = re.findall(r"```(?:python|py)?\s*\n(.*?)```", text, re.S)
    if not blocks:
        print("no python block in the reply")
        sys.exit(4)
    (out / "script.py").write_text(max(blocks, key=len))


def ask(tag, env_file):
    route = tag[0]
    messages = [{"role": "user", "content": prompt_for(route)}]
    save(call(messages, tag, env_file), messages, RUNS / tag)


def fix(tag, env_file):
    conv = json.loads((RUNS / tag / "conversation.json").read_text())
    log = (RUNS / tag / "run.log").read_text(errors="replace")
    missing = [n for n in ("greenhouse.ifc", "greenhouse.glb") if not (RUNS / tag / n).exists()]
    note = f" These were not written: {', '.join(missing)}." if missing else ""
    conv.append({"role": "user", "content": f"It failed (exit {(RUNS / tag / 'status').read_text().strip()}).{note} "
                 f"The end of its output:\n```\n{log[-4000:]}\n```\nSend the whole corrected script."})
    save(call(conv, tag + "-fix", env_file), conv, RUNS / (tag + "-fix"))


def yn(b):
    return "–" if b is None else ("ja" if b else "nei")


def table():
    led = {r["try"]: r for r in ledger()}
    host = os.environ.get("RUNS_HOST", str(RUNS))
    rows = ["| try | runs | after fix | IFC4 | glb | Member/Plate/Slab/Door | base | apex | slab | module | rafters | door | params | opens in FreeCAD | run s | USD | shot |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in ("A", "B"):
        for n in (1, 2, 3):
            t = f"{r}{n}"
            if not (RUNS / t).exists():
                continue
            first = (RUNS / t / "status").exists() and (RUNS / t / "status").read_text().strip() == "0"
            fixd = RUNS / f"{t}-fix"
            after = None if first or not fixd.exists() else (fixd / "status").exists() and (fixd / "status").read_text().strip() == "0"
            d = RUNS / t if first or not fixd.exists() else fixd
            c = json.loads((d / "check.json").read_text()) if (d / "check.json").exists() else {}
            k = c.get("checks", {})
            cl = c.get("classes", {})
            usd = sum(led.get(x, {}).get("usd", 0) for x in (t, t + "-fix"))
            fc = c.get("freecad", {})
            rows.append("| " + " | ".join([
                t, yn(first), yn(after), yn(c.get("schema") == "IFC4" if c else None), yn(c.get("glb", {}).get("ok") if c else None),
                "/".join(str(cl.get(x, 0)) for x in ("IfcMember", "IfcPlate", "IfcSlab", "IfcDoor")) if c else "–",
                *(yn(k.get(x, {}).get("ok")) if c else "–" for x in ("base", "apex", "slab", "module", "rafters", "door", "params")),
                (f"{fc.get('objects', 0)} obj" + ("" if fc.get("ok") else " (" + str(fc.get("error", "nei"))[:40] + ")")) if c else "–",
                str(c.get("run_s", "–")), f"{usd:.3f}", f"{host}/{d.name}/shot.png" if (d / "shot.png").exists() else "–"]) + " |")
    total = sum(x["usd"] for x in led.values())
    sizes = (RUNS / "images.txt").read_text().strip() if (RUNS / "images.txt").exists() else ""
    ctrl = (RUNS / "control" / "run.log").read_text().strip() if (RUNS / "control" / "run.log").exists() else ""
    out = "\n".join(rows) + f"\n\nIn all: {total:.3f} USD of {CAP:.2f}.\n\nImages:\n```\n{sizes}\n```\n\nControl try:\n```\n{ctrl}\n```\n"
    (RUNS / "results.md").write_text(out)
    print(out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["ask", "fix", "table"])
    ap.add_argument("tag", nargs="?")
    ap.add_argument("--env-file")
    a = ap.parse_args()
    if a.what == "table":
        table()
    else:
        if not a.tag or not re.fullmatch(r"[AB][1-3]", a.tag) or not a.env_file:
            sys.exit("ask/fix need a try (A1..B3) and --env-file")
        (ask if a.what == "ask" else fix)(a.tag, a.env_file)
