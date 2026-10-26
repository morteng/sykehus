"""The worker's sandbox, tried from outside (U3531): jobs that try to get out, and what each got. Run it from a
container on the worker's network (sykehus-mcp), or anywhere that reaches the worker:
  python3 -I selftest.py http://worker:8070 [host:port that a job must not reach, e.g. sykehus-mcp:8080]
Prints one line a probe and exits 1 if any job got out. After it, `docker exec <worker> ps -e` should show the
service's python and nothing a job left behind.
"""
import json
import re
import sys
import urllib.request

W = sys.argv[1].rstrip("/")
INNER = sys.argv[2] if len(sys.argv) > 2 else "sykehus-mcp:8080"


def job(script, caps=None, then=None):
    body = json.dumps({"script": script, "params": {"inner": INNER}, **({"caps": caps} if caps else {}), **({"then": then} if then else {})}).encode()
    r = urllib.request.Request(f"{W}/jobs?wait=120", body, {"content-type": "application/json"})
    return json.loads(urllib.request.urlopen(r, timeout=180).read())


TRY = '''
import json, os, socket
P = json.load(open("params.json"))
def tried(f):
    try:
        return "GOT " + str(f())[:120]
    except BaseException as e:
        return "refused: " + type(e).__name__
h, p = P["inner"].rsplit(":", 1)
def ls(d):
    return sorted(os.listdir(d))
out = {
  "net_outside": tried(lambda: socket.create_connection(("1.1.1.1", 53), 3)),
  "net_inner": tried(lambda: socket.create_connection((h, int(p)), 3)),
  "net_worker": tried(lambda: socket.create_connection(("worker", 8070), 3)),
  "dns": tried(lambda: socket.getaddrinfo("worker", 8070)),
  "interfaces": tried(lambda: sorted(n for _, n in socket.if_nameindex())),
  "jobs_dir": tried(lambda: ls("/jobs") or (_ for _ in ()).throw(FileNotFoundError("empty"))),
  "blobs": tried(lambda: ls("/jobs/.blobs")),
  "write_service": tried(lambda: open("/srv/worker/x", "w").write("x")),
  "write_etc": tried(lambda: open("/etc/x", "w").write("x")),
  "proc": tried(lambda: ls("/proc")),
  "pid1": tried(lambda: open("/proc/1/cmdline", "rb").read()),
  "service_root": tried(lambda: ls("/proc/1/root/jobs")),
  "kill_parent": tried(lambda: os.kill(os.getppid(), 0) or os.getppid()),
  "env": sorted(os.environ),
  "uid": os.getuid(),
}
print(json.dumps(out))
'''

probes = []
ok_all = True


def say(name, ok, got):
    global ok_all
    ok_all &= ok
    print(f"{'ok  ' if ok else 'OUT '} {name:15} {got}")


j = job(TRY)
r = j.get("result") or {}
if j.get("state") != "done":
    say("probe job", False, f"{j.get('state')} {j.get('errors')} {str(j.get('log'))[-400:]}")
else:
    for k in ("net_outside", "net_inner", "net_worker", "dns", "jobs_dir", "blobs", "write_service", "write_etc"):
        say(k, str(r.get(k, "")).startswith("refused"), r.get(k))
    say("interfaces", r.get("interfaces") in ("GOT []", "GOT ['lo']"), r.get("interfaces"))
    say("proc", r.get("proc") in ("GOT []", "refused: FileNotFoundError"), r.get("proc"))   # an empty /proc: no process of the service or another job
    for k in ("pid1", "service_root"):
        say(k, str(r.get(k, "")).startswith("refused"), r.get(k))
    say("kill_parent", r.get("kill_parent") in ("GOT 0", "GOT 1") or str(r.get("kill_parent")).startswith("refused"), r.get("kill_parent"))   # its parent is bwrap's, pid 0/1 in its own namespace
    # the sandbox's own names only: PWD from bwrap's --chdir, LC_CTYPE from Python's locale coercion, and the KiCad
    # image's KICAD*_DIR paths (where its libraries are; the service passes them in)
    say("env", {e for e in r.get("env", []) if not re.fullmatch(r"KICAD\d*_[A-Z0-9]+_DIR", e)} <= {"HOME", "PATH", "MPLCONFIGDIR", "QT_QPA_PLATFORM", "PYTHONDONTWRITEBYTECODE", "LC_CTYPE", "PWD"}, r.get("env"))

j = job("x = bytearray(6 << 30)\n")
say("memory", (j.get("errors") or [{}])[0].get("code") == "memory_limit", (j.get("state"), j.get("errors")))
j = job("while True: pass\n", caps={"s": 5})
say("time", (j.get("errors") or [{}])[0].get("code") == "time_limit", (j.get("state"), j.get("errors"), j.get("seconds")))
j = job("import os\nn = 0\ntry:\n    while n < 2000:\n        if os.fork() == 0:\n            import time; time.sleep(5); os._exit(0)\n        n += 1\nexcept OSError as e:\n    print('{\"forks\": %d}' % n)\n")
say("processes", (j.get("result") or {}).get("forks", 9999) < 300, (j.get("state"), j.get("result")))
j = job("open('big', 'wb').write(b'0' * (100 << 20))\n")
say("file_size", (j.get("errors") or [{}])[0].get("code") == "too_big", (j.get("state"), (j.get("errors") or [{}])[0].get("code")))
j = job("import json\nopen('out.txt', 'w').write('hei')\nprint(json.dumps({'ok': 1}))\n")
say("control", j.get("state") == "done" and [o["name"] for o in j.get("outputs", [])] == ["out.txt"], (j.get("state"), j.get("outputs")))
# the engines work with an empty /proc: an IFC through the mesh step; FreeCAD's STEP through check, where there is FreeCAD
IFC = "import ifcopenshell.api as A\nf = A.run('project.create_file', version='IFC4'); p = A.run('root.create_entity', f, ifc_class='IfcProject'); A.run('unit.assign_unit', f, length={'is_metric': True, 'raw': 'METERS'})\nc = A.run('context.add_context', f, context_type='Model'); b = A.run('context.add_context', f, context_type='Model', context_identifier='Body', target_view='MODEL_VIEW', parent=c)\nw = A.run('root.create_entity', f, ifc_class='IfcWall'); A.run('geometry.assign_representation', f, product=w, representation=A.run('geometry.add_wall_representation', f, context=b, length=5, height=3, thickness=0.2))\nf.write('model.ifc')\n"
# the engine this image has: the KiCad image has no IfcOpenShell, but kicad-cli
ENGINE = json.loads(urllib.request.urlopen(f"{W}/health", timeout=10).read()).get("engine")
if ENGINE == "kicad":
    j = job("import subprocess, json\nv = subprocess.run(['kicad-cli', 'version'], capture_output=True, text=True).stdout.strip()\nprint(json.dumps({'kicad': v}))\n")
    say("kicad_engine", j.get("state") == "done" and bool((j.get("result") or {}).get("kicad")), (j.get("state"), j.get("result"), j.get("errors")))
else:
    j = job(IFC, then=["mesh"])
    say("ifc_engine", j.get("state") == "done" and "mesh.json" in [o["name"] for o in j.get("outputs", [])], (j.get("state"), j.get("errors")))
if ENGINE == "freecad":
    j = job("import FreeCAD, Part, Import\nd = FreeCAD.newDocument('t'); o = d.addObject('Part::Feature', 'Box'); o.Shape = Part.makeBox(10, 20, 30); d.recompute(); Import.export([o], 'box.step')\n", then=["check"])
    say("freecad_engine", j.get("state") == "done" and (j.get("check") or {}).get("files", {}).get("box.step", {}).get("size") == [10.0, 20.0, 30.0], (j.get("state"), j.get("errors"), str(j.get("log"))[-300:]))
print("all held" if ok_all else "A JOB GOT OUT")
sys.exit(0 if ok_all else 1)
