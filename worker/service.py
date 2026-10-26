"""The worker (U3531): runs a script someone else wrote, with no network and no files outside its job, and hands back
what it made. One container on the stack's internal network; shared by sykehus (U3570, IfcOpenShell scripts) and Fab
(U3558, FreeCAD scripts, in the FreeCAD image). Python's standard library only, so it runs in either image.

  POST /jobs[?wait=S]   {script, params?, files?: {name: base64}, then?: ["mesh", "glb"], caps?: {s, mem_mb}}
                        → 202 {id} or, with wait, the job when it is done (up to S seconds)
  GET  /jobs/<id>       {id, state: queued|running|done|failed|refused, result, files: {name: url}, errors: [{code,
                        line, message}], log, seconds}
  GET  /jobs/<id>/files/<name>   the bytes
  GET  /health          {ok, engine, versions, queue}

A job: script.py and params.json (and the files) in an empty folder; `python script.py` there under bubblewrap
(--unshare-all: no network; the image read-only; only the job folder writable; no environment; rlimits on CPU time,
memory, processes and file size; a wall clock). Its result is the last line of its output that is a JSON object.
then: built-in steps of this image on what it made (trusted code, run the same way): mesh writes mesh.json from the
IFC (triangles by class, for a viewer), glb a glTF of it. Errors carry a stable code and English words, for an app to
put in its own language: script_error (with line), no_output, time_limit, memory_limit, network_refused,
file_refused, too_big, bad_request.
"""
import base64
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(os.environ.get("WORKER_JOBS", "/jobs"))
HERE = pathlib.Path(__file__).resolve().parent
KEEP_S = 3600                      # a job's folder is kept an hour
MAX_BODY = 8 << 20                 # 8 MB in
MAX_OUT = 64 << 20                 # 64 MB out, all files
CAPS = {"s": 300, "mem_mb": 4096}
SLOTS = threading.Semaphore(int(os.environ.get("WORKER_SLOTS", "1")))
DEV = os.environ.get("WORKER_UNSAFE_DEV") == "1"   # no bubblewrap: only on a developer's machine, never on the box
jobs, lock = {}, threading.Lock()


def sandboxed(cmd, work, caps):
    """the command under bubblewrap with rlimits; or, in DEV, as it is (the rlimits still)"""
    lim = ["prlimit", f"--cpu={caps['s']}", f"--as={caps['mem_mb'] << 20}", "--nproc=256", f"--fsize={MAX_OUT}", "--"]
    if DEV:
        return lim + cmd if shutil.which("prlimit") else cmd
    return ["bwrap", "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL",
            "--ro-bind", "/", "/", "--tmpfs", "/tmp", "--tmpfs", str(ROOT), "--bind", str(work), "/work",
            "--proc", "/proc", "--dev", "/dev", "--chdir", "/work", "--clearenv",
            "--setenv", "HOME", "/tmp", "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin:/opt/conda/bin",
            "--setenv", "MPLCONFIGDIR", "/tmp", "--setenv", "QT_QPA_PLATFORM", "offscreen", "--setenv", "PYTHONDONTWRITEBYTECODE", "1",
            "--"] + lim + cmd


def classify(log, code, timed_out):
    """what went wrong, as a code and a line for the script's own fault"""
    if timed_out:
        return [{"code": "time_limit", "message": "The script ran out of time."}]
    if re.search(r"Network is unreachable|Temporary failure in name resolution|Name or service not known|getaddrinfo failed", log):
        return [{"code": "network_refused", "message": "The script tried to reach the network; there is none here."}]
    if re.search(r"Read-only file system|Permission denied: '/(?!work)", log):
        return [{"code": "file_refused", "message": "The script tried to write outside its own folder; only its folder can be written."}]
    if re.search(r"MemoryError|std::bad_alloc|Cannot allocate memory", log) or code in (-9, 137):
        return [{"code": "memory_limit", "message": "The script used more memory than it may."}]
    tb = re.findall(r'File "(?:[^"]*/)?script\.py", line (\d+)', log)
    last = [l for l in log.strip().splitlines() if l.strip()][-1:] or ["(no output)"]
    return [{"code": "script_error", "line": int(tb[-1]) if tb else None, "message": last[0][:500]}]


def run_job(j):
    work = ROOT / j["id"]
    with SLOTS:
        j["state"] = "running"; t0 = time.time()
        caps = {**CAPS, **{k: min(int(v), CAPS[k]) for k, v in (j.get("caps") or {}).items() if k in CAPS}}
        try:
            p = subprocess.run(sandboxed([sys.executable, "-I", "script.py"], work, caps), cwd=work, capture_output=True,
                               text=True, timeout=caps["s"] + 30)
            log, code, late = (p.stdout + p.stderr)[-20000:], p.returncode, False
        except subprocess.TimeoutExpired as e:
            log, code, late = ((e.stdout or b"").decode(errors="replace") + (e.stderr or b"").decode(errors="replace"))[-20000:] if isinstance(e.stdout, bytes) else str(e.stdout or ""), -1, True
        j["log"] = log
        said = [l for l in (log or "").splitlines() if l.strip().startswith("{")]
        try:
            j["result"] = json.loads(said[-1]) if said else None
        except ValueError:
            j["result"] = None
        if code != 0 or late:
            j["errors"] = classify(log, code, late)
            j["state"] = "refused" if j["errors"][0]["code"] in ("network_refused", "file_refused", "time_limit", "memory_limit") else "failed"
        else:
            for step in j.get("then") or []:
                shutil.copy(HERE / "steps" / f"{step}.py", work / f".step-{step}.py")
                q = subprocess.run(sandboxed([sys.executable, "-I", f".step-{step}.py"], work, caps), cwd=work, capture_output=True, text=True, timeout=caps["s"] + 30)
                (work / f".step-{step}.py").unlink(missing_ok=True)
                if q.returncode != 0:
                    j["errors"] = [{"code": "no_output" if "no IFC" in q.stderr else "script_error", "message": (q.stderr.strip().splitlines() or ["the step failed"])[-1][:500], "step": step}]
                    j["state"] = "failed"; break
            else:
                j["state"] = "done"
        j["files"] = {f.name: f"/jobs/{j['id']}/files/{f.name}" for f in sorted(work.iterdir())
                      if f.is_file() and not f.name.startswith(".") and f.name not in ("script.py", "params.json") and f.name not in j["inputs"]}
        if sum((work / n).stat().st_size for n in j["files"]) > MAX_OUT:
            j["state"], j["errors"], j["files"] = "failed", [{"code": "too_big", "message": "What the script made is more than 64 MB."}], {}
        j["seconds"] = round(time.time() - t0, 1)
        j["done"].set()


def sweep():
    while True:
        time.sleep(300)
        with lock:
            for k in [k for k, j in jobs.items() if time.time() - j["t"] > KEEP_S]:
                shutil.rmtree(ROOT / k, ignore_errors=True); jobs.pop(k, None)


def view(j):
    return {k: j.get(k) for k in ("id", "state", "result", "files", "errors", "log", "seconds")}


def versions():
    out = {"python": sys.version.split()[0]}
    for m in ("ifcopenshell", "FreeCAD"):
        try:
            mod = __import__(m)
            out[m.lower()] = getattr(mod, "version", None) or ".".join(mod.Version()[:3])
        except Exception:
            pass
    return out


VERSIONS = None


class H(BaseHTTPRequestHandler):
    def send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code); self.send_header("content-type", ctype); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def log_message(self, f, *a):
        sys.stderr.write("worker %s\n" % (f % a))

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/health":
            return self.send(200, {"ok": True, "sandbox": "dev" if DEV else "bwrap", "versions": VERSIONS, "queue": sum(1 for j in jobs.values() if j["state"] in ("queued", "running"))})
        m = re.fullmatch(r"/jobs/([0-9a-f]{32})(?:/files/([A-Za-z0-9._-]{1,80}))?", path)
        j = m and jobs.get(m.group(1))
        if not j:
            return self.send(404, {"errors": [{"code": "bad_request", "message": "No such job."}]})
        if not m.group(2):
            return self.send(200, view(j))
        f = ROOT / j["id"] / m.group(2)
        if m.group(2) not in (j.get("files") or {}) or not f.is_file():
            return self.send(404, {"errors": [{"code": "bad_request", "message": "No such file."}]})
        self.send(200, f.read_bytes(), "application/octet-stream")

    def do_POST(self):
        path, _, q = self.path.partition("?")
        if path != "/jobs":
            return self.send(404, {"errors": [{"code": "bad_request", "message": "POST /jobs"}]})
        n = int(self.headers.get("content-length") or 0)
        if n > MAX_BODY:
            return self.send(413, {"errors": [{"code": "too_big", "message": "A job is at most 8 MB."}]})
        try:
            a = json.loads(self.rfile.read(n))
            assert isinstance(a.get("script"), str) and a["script"].strip()
            assert all(s in ("mesh", "glb") for s in a.get("then") or [])
        except Exception:
            return self.send(400, {"errors": [{"code": "bad_request", "message": "A job is JSON with a script (text), and then from mesh, glb."}]})
        jid = uuid.uuid4().hex; work = ROOT / jid; work.mkdir(parents=True)
        (work / "script.py").write_text(a["script"]); (work / "params.json").write_text(json.dumps(a.get("params") or {}))
        inputs = []
        for name, b64 in (a.get("files") or {}).items():
            if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", name) or name.startswith("."):
                continue
            (work / name).write_bytes(base64.b64decode(b64)); inputs.append(name)
        os.chmod(work, 0o777)
        j = {"id": jid, "t": time.time(), "state": "queued", "then": a.get("then"), "caps": a.get("caps"), "inputs": inputs, "done": threading.Event()}
        with lock:
            jobs[jid] = j
        threading.Thread(target=run_job, args=(j,), daemon=True).start()
        wait = re.search(r"(?:^|&)wait=(\d+)", q)
        if wait:
            j["done"].wait(min(int(wait.group(1)), 900))
            return self.send(200, view(j))
        self.send(202, {"id": jid})


if __name__ == "__main__":
    ROOT.mkdir(parents=True, exist_ok=True)
    if not DEV and not shutil.which("bwrap"):
        sys.exit("worker: no bubblewrap; set WORKER_UNSAFE_DEV=1 only on a developer's machine")
    VERSIONS = versions()
    threading.Thread(target=sweep, daemon=True).start()
    port = int(os.environ.get("PORT", "8070"))
    print(f"worker on :{port} ({'dev, no sandbox' if DEV else 'bwrap'})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
