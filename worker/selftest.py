"""The worker's sandbox, tried from outside (U3531): jobs that try to get out, and what each got. Run it from a
container on the worker's network (sykehus-mcp), or anywhere that reaches the worker:
  python3 -I selftest.py http://worker:8070 [host:port that a job must not reach, e.g. sykehus-mcp:8080]
Prints one line a probe and exits 1 if any job got out. After it, `docker exec <worker> ps -e` should show the
service's python and nothing a job left behind.
"""
import json
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
  "interfaces": tried(lambda: [l.split(":")[0].strip() for l in open("/proc/net/dev").read().splitlines()[2:]]),
  "jobs_dir": tried(lambda: ls("/jobs") or (_ for _ in ()).throw(FileNotFoundError("empty"))),
  "blobs": tried(lambda: ls("/jobs/.blobs")),
  "write_service": tried(lambda: open("/srv/worker/x", "w").write("x")),
  "write_etc": tried(lambda: open("/etc/x", "w").write("x")),
  "pids": tried(lambda: sorted(int(x) for x in os.listdir("/proc") if x.isdigit())),
  "pid1": tried(lambda: open("/proc/1/cmdline", "rb").read().split(b"\\0")[0].decode(errors="replace")),
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
    say("pids", r.get("pids", "").startswith("GOT [") and r["pids"].count(",") <= 3, r.get("pids"))
    say("pid1", r.get("pid1", "").startswith("GOT ") and "python" not in r["pid1"], r.get("pid1"))
    say("env", set(r.get("env", [])) <= {"HOME", "PATH", "MPLCONFIGDIR", "QT_QPA_PLATFORM", "PYTHONDONTWRITEBYTECODE", "LC_CTYPE"}, r.get("env"))

j = job("x = bytearray(6 << 30)\n")
say("memory", (j.get("errors") or [{}])[0].get("code") == "memory_limit", (j.get("state"), j.get("errors")))
j = job("while True: pass\n", caps={"s": 5})
say("time", (j.get("errors") or [{}])[0].get("code") == "time_limit", (j.get("state"), j.get("errors"), j.get("seconds")))
j = job("import os\nn = 0\ntry:\n    while n < 2000:\n        if os.fork() == 0:\n            import time; time.sleep(5); os._exit(0)\n        n += 1\nexcept OSError as e:\n    print('{\"forks\": %d}' % n)\n")
say("processes", (j.get("result") or {}).get("forks", 9999) < 300, (j.get("state"), j.get("result")))
j = job("open('big', 'wb').write(b'0' * (100 << 20))\n")
say("file_size", j.get("state") != "done", (j.get("state"), (j.get("errors") or [{}])[0].get("code")))
j = job("import json\nopen('out.txt', 'w').write('hei')\nprint(json.dumps({'ok': 1}))\n")
say("control", j.get("state") == "done" and [o["name"] for o in j.get("outputs", [])] == ["out.txt"], (j.get("state"), j.get("outputs")))
print("all held" if ok_all else "A JOB GOT OUT")
sys.exit(0 if ok_all else 1)
