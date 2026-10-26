"""The job that makes a KiCad project from a spec and checks it (U3582), while steps/make.py is being tried as a script:

  python3 -I worker/examples/make_job.py [spec.json] [key] > job.json
  curl -s -X POST "$WORKER/jobs?wait=300" -H content-type:application/json --data @job.json

The script is steps/make.py, the spec goes in as board.json, then erc, drc and step. Once it holds, it is a built-in
step (then: ["make", "erc", "drc", "step"], no script).
"""
import base64
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "keychain-board.json"
key = sys.argv[2] if len(sys.argv) > 2 else None
job = {"script": (HERE.parent / "steps" / "make.py").read_text(),
       "files": {"board.json": base64.b64encode(spec.read_bytes()).decode()},
       "then": ["erc", "drc", "step"]}
if key:
    job["key"] = key
print(json.dumps(job))
