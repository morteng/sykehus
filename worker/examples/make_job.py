"""The job that makes a KiCad project from a spec and checks it (U3582), on the KiCad worker:

  python3 -I worker/examples/make_job.py [spec.json] [key] [--script] > job.json
  curl -s -X POST "$WORKER/jobs?wait=300" -H content-type:application/json --data @job.json

The spec goes in as board.json; then make (steps/make.py, built into the image), route (Freerouting), erc, drc and step. --script sends
steps/make.py as the job's script instead, to try a change to it before the image is built again.
"""
import base64
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
args = [a for a in sys.argv[1:] if not a.startswith("--")]
spec = pathlib.Path(args[0]) if args else HERE / "keychain-board.json"
key = args[1] if len(args) > 1 else None
job = {"files": {"board.json": base64.b64encode(spec.read_bytes()).decode()}, "then": ["make", "route", "erc", "drc", "step", "glb"]}
if "--script" in sys.argv:
    job["script"] = (HERE.parent / "steps" / "make.py").read_text(); job["then"] = ["route", "erc", "drc", "step", "glb"]
if key:
    job["key"] = key
print(json.dumps(job))
