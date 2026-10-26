"""The worker (U3531): runs a script someone else wrote, with no network and no files outside its job, and hands back
what it made. One container on the stack's internal network; shared by sykehus (U3570, IfcOpenShell scripts) and Fab
(U3558, FreeCAD scripts, in the FreeCAD image). Python's standard library only, so it runs in either image.

  POST /blobs           the bytes of a file (a STEP, a KiCad part, an image) → {sha256, bytes}; kept a week
  GET  /blobs/<sha256>  the bytes
  POST /jobs[?wait=S]   {script, params?, inputs?: {name: sha256}, files?: {name: base64}, then?: ["mesh", "glb",
                        "check"] (the KiCad image: "make", "route", "erc", "drc", "step", "glb", "outline", "render", no script),
                        mesh?: {linear_mm, angular_deg}, expect?: {...}, caps?: {s, mem_mb}, key?}
                        → 202 {id} or, with wait, the job when it is done (up to S seconds). key (or the
                        Idempotency-Key header): the same key within the hour is the same job, not a second run
  GET  /jobs/<id>       {id, state: queued|running|done|failed|refused, result, outputs: [{name, sha256, bytes, url}],
                        files: {name: url}, check, errors: [{code, line, message}], log, seconds}
  GET  /jobs/<id>/files/<name>   the bytes (also at /blobs/<sha256>, as long as the blob is kept)
  GET  /health          {ok, engine, steps, versions, queue}

A job: script.py and params.json (and the files) in an empty folder; `python script.py` there under bubblewrap
(--unshare-all: no network; the image read-only; only the job folder writable; an empty /proc; no environment; rlimits on CPU time,
memory, processes and file size; a wall clock). Its result is the last line of its output that is a JSON object.
then: built-in steps of this image on what it made (trusted code, run the same way): mesh writes mesh.json from the
IFC (triangles by class, for a viewer) and, in the FreeCAD image, each STEP / BREP / FCStd (the inputs too) as one
mesh per part at mesh's tolerance (<stem>.<n>.stl, <stem>.glb, <stem>.parts.json with each part's placement); glb a
glTF of the IFC; check a report on every file it made (check.json, and the
job's check): solids, valid, closed, volume, box, the solids that overlap (STEP, BREP, FCStd with FreeCAD; STL; IFC),
and each of expect's numbers against what was measured, so an app knows without opening the files whether the part
is what was asked. A job whose check fails is still done: check.ok is false and check.failed says which. Errors carry a stable code and English words, for an app to
put in its own language: script_error (with line), no_output, time_limit, memory_limit, network_refused,
file_refused, too_big, bad_request, missing_input (an inputs sha the worker does not have: POST it to /blobs),
kicad_error (kicad-cli could not read the board or schematic, or none was sent; with step); the KiCad steps' findings
in the job's kicad (steps/kicad.py);
sandbox_unavailable when bubblewrap cannot make its namespaces here (its words
in /health's sandbox_error).
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
BLOBS = pathlib.Path(os.environ.get("WORKER_BLOBS", str(ROOT / ".blobs")))   # under ROOT: hidden from the jobs (a tmpfs there)
BLOB_KEEP_S, BLOB_CAP, MAX_BLOB = 7 * 86400, 4 << 30, 64 << 20   # a week, 4 GB in all, 64 MB each
# the KiCad image's steps: make and route their own (steps/make.py, route.py), the rest kicad-cli's (steps/kicad.py
# <step>); glb there is the board's (kicad-cli), not the IFC's, which that image has no IfcOpenShell for
KICAD_OWN, KICAD_CLI = ("make", "route"), ("erc", "drc", "step", "glb", "outline", "render")
KICAD = KICAD_OWN + KICAD_CLI if shutil.which("kicad-cli") else ()
STEPS = ("check",) + KICAD if KICAD else ("mesh", "glb", "check")
DEV = os.environ.get("WORKER_UNSAFE_DEV") == "1"   # no bubblewrap: only on a developer's machine, never on the box
jobs, lock = {}, threading.Lock()


def sandboxed(cmd, work, caps):
    """the command under bubblewrap with rlimits; or, in DEV, as it is (the rlimits still). /proc is an empty tmpfs:
    Docker's masked /proc refuses a new proc mount, and the container's own (which the ro-bind of / would bring in)
    would show the service's processes, and through /proc/<pid>/root its files; the pid namespace is still the job's"""
    # the CPU cap soft, so the job gets SIGXCPU at it (time_limit), and SIGKILL 5 s on
    lim = ["prlimit", f"--cpu={caps['s']}:{caps['s'] + 5}", f"--as={caps['mem_mb'] << 20}", "--nproc=256", f"--fsize={MAX_OUT}", "--"]
    if DEV:
        return lim + cmd if shutil.which("prlimit") else cmd
    return ["bwrap", "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL",
            "--ro-bind", "/", "/", "--tmpfs", "/tmp", "--tmpfs", str(ROOT), "--bind", str(work), "/work",
            "--tmpfs", "/proc", "--dev", "/dev", "--chdir", "/work", "--clearenv",
            "--setenv", "HOME", "/tmp", "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin:/opt/conda/bin",
            "--setenv", "MPLCONFIGDIR", "/tmp", "--setenv", "QT_QPA_PLATFORM", "offscreen", "--setenv", "PYTHONDONTWRITEBYTECODE", "1",
            *[x for k, v in os.environ.items() if k.startswith("KICAD") for x in ("--setenv", k, v)],
            "--"] + lim + cmd


def classify(log, code, timed_out, seconds=0, cap=CAPS["s"]):
    """what went wrong, as a code and a line for the script's own fault. Killed by a signal: SIGXCPU (24) is the CPU
    cap; SIGKILL at or past the cap is the CPU cap's hard end, before it the memory cap (or the kernel's OOM)"""
    if code in (-24, 152) or (code in (-9, 137) and seconds >= cap - 0.5):
        timed_out = True
    if timed_out:
        return [{"code": "time_limit", "message": "The script ran out of time."}]
    if re.search(r"Network is unreachable|Temporary failure in name resolution|Name or service not known|getaddrinfo failed", log):
        return [{"code": "network_refused", "message": "The script tried to reach the network; there is none here."}]
    if re.search(r"Read-only file system|Permission denied: '/(?!work)", log):
        return [{"code": "file_refused", "message": "The script tried to write outside its own folder; only its folder can be written."}]
    if re.search(r"File too large", log):
        return [{"code": "too_big", "message": "The script wrote a file larger than 64 MB."}]
    if re.search(r"MemoryError|std::bad_alloc|Cannot allocate memory", log) or code in (-9, 137):
        return [{"code": "memory_limit", "message": "The script used more memory than it may."}]
    tb = re.findall(r'File "(?:[^"]*/)?script\.py", line (\d+)', log)
    last = [l for l in log.strip().splitlines() if l.strip()][-1:] or ["(no output)"]
    return [{"code": "script_error", "line": int(tb[-1]) if tb else None, "message": last[0][:500]}]


def put_blob(path_or_bytes):
    """the bytes kept by their sha256 (the same bytes, the same blob): its sha"""
    import hashlib
    b = path_or_bytes if isinstance(path_or_bytes, bytes) else pathlib.Path(path_or_bytes).read_bytes()
    sha = hashlib.sha256(b).hexdigest(); f = BLOBS / sha
    if not f.exists():
        BLOBS.mkdir(parents=True, exist_ok=True); t = BLOBS / f".{sha}.{uuid.uuid4().hex}"; t.write_bytes(b); t.replace(f)
    else:
        os.utime(f)
    return sha, len(b)


def run_job(j):
    work = ROOT / j["id"]
    with SLOTS:
        j["state"] = "running"; t0 = time.time()
        caps = {**CAPS, **{k: min(int(v), CAPS[k]) for k, v in (j.get("caps") or {}).items() if k in CAPS}}
        try:
            # a job of steps alone (KiCad on a board) has no script to run
            p = subprocess.run(sandboxed([sys.executable, "-I", "script.py"], work, caps), cwd=work, capture_output=True,
                               text=True, timeout=caps["s"] + 30) if (work / "script.py").exists() else subprocess.CompletedProcess([], 0, "", "")
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
            j["errors"] = classify(log, code, late, time.time() - t0, caps["s"])
            j["state"] = "refused" if j["errors"][0]["code"] in ("network_refused", "file_refused", "time_limit", "memory_limit") else "failed"
        else:
            if j.get("expect") is not None:
                (work / ".expect.json").write_text(json.dumps(j["expect"]))
            if j.get("mesh") is not None:
                (work / ".mesh.json").write_text(json.dumps(j["mesh"]))
            for step in j.get("then") or []:
                src = "kicad" if step in KICAD_CLI and KICAD else step
                shutil.copy(HERE / "steps" / f"{src}.py", work / f".step-{src}.py")
                q = subprocess.run(sandboxed([sys.executable, "-I", f".step-{src}.py", *([step] if src == "kicad" else [])], work, caps), cwd=work, capture_output=True, text=True, timeout=caps["s"] + 30)
                (work / f".step-{src}.py").unlink(missing_ok=True)
                if q.returncode != 0:
                    # the step's own words in the job's log too (its last line is the error's message)
                    j["log"] = ((j.get("log") or "") + f"\n--- step {step} ---\n" + (q.stdout + q.stderr)[-8000:]).strip()
                    j["errors"] = [{"code": "kicad_error" if src == "kicad" else "no_output" if "no IFC" in q.stderr else "script_error", "message": (q.stderr.strip().splitlines() or ["the step failed"])[-1][:500], "step": step}]
                    j["state"] = "failed"; break
            else:
                j["state"] = "done"
        try:
            unpacked = set(json.loads((work / ".unpacked").read_text())) if (work / ".unpacked").exists() else set()
        except ValueError:
            unpacked = set()
        j["files"] = {f.name: f"/jobs/{j['id']}/files/{f.name}" for f in sorted(work.iterdir())
                      if f.is_file() and not f.name.startswith(".") and f.name not in ("script.py", "params.json") and f.name not in j["inputs"] and f.name not in unpacked}
        if sum((work / n).stat().st_size for n in j["files"]) > MAX_OUT:
            j["state"], j["errors"], j["files"] = "failed", [{"code": "too_big", "message": "What the script made is more than 64 MB."}], {}
        j["outputs"] = []
        for n in j["files"]:
            sha, size = put_blob(work / n)
            j["outputs"].append({"name": n, "sha256": sha, "bytes": size, "url": f"/blobs/{sha}"})
        if "kicad.json" in j["files"]:
            try:
                j["kicad"] = json.loads((work / "kicad.json").read_text())
            except ValueError:
                j["kicad"] = None
        if "check.json" in j["files"] and "check" in (j.get("then") or []):
            try:
                j["check"] = json.loads((work / "check.json").read_text())
            except ValueError:
                j["check"] = None
        j["seconds"] = round(time.time() - t0, 1)
        j["done"].set()


def sweep():
    while True:
        time.sleep(300)
        with lock:
            for k in [k for k, j in jobs.items() if time.time() - j["t"] > KEEP_S]:
                shutil.rmtree(ROOT / k, ignore_errors=True); jobs.pop(k, None)
        # blobs: a week from last use, and the oldest first past the cap
        fs = sorted((f for f in BLOBS.glob("[0-9a-f]" * 64)), key=lambda f: f.stat().st_mtime) if BLOBS.is_dir() else []
        total = sum(f.stat().st_size for f in fs)
        for f in fs:
            if time.time() - f.stat().st_mtime > BLOB_KEEP_S or total > BLOB_CAP:
                total -= f.stat().st_size; f.unlink(missing_ok=True)


def view(j):
    return {k: j.get(k) for k in ("id", "state", "result", "outputs", "files", "check", "kicad", "errors", "log", "seconds")}


def versions():
    out = {"python": sys.version.split()[0]}
    if shutil.which("kicad-cli"):
        try:
            out["kicad"] = subprocess.run(["kicad-cli", "version"], capture_output=True, text=True, timeout=30).stdout.strip()
        except Exception:
            pass
    for m in ("ifcopenshell", "FreeCAD"):
        try:
            mod = __import__(m)
            out[m.lower()] = getattr(mod, "version", None) or ".".join(mod.Version()[:3])
        except Exception:
            pass
    return out


VERSIONS = None
SANDBOX_ERR = None   # what bubblewrap said when it could not make its namespaces here (then no job runs)


def probe():
    """bubblewrap tried once at start, as a job runs it: its exact words if it cannot"""
    w = ROOT / ".probe"; w.mkdir(parents=True, exist_ok=True)
    try:
        p = subprocess.run(sandboxed(["true"], w, CAPS), capture_output=True, text=True, timeout=30)
        return None if p.returncode == 0 else (p.stderr.strip() or f"exit {p.returncode}")
    except Exception as e:
        return str(e)


class H(BaseHTTPRequestHandler):
    def send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code); self.send_header("content-type", ctype); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def log_message(self, f, *a):
        sys.stderr.write("worker %s\n" % (f % a))

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/health":
            return self.send(200 if not SANDBOX_ERR else 503, {"ok": not SANDBOX_ERR, "engine": "kicad" if "kicad" in (VERSIONS or {}) else "freecad" if "freecad" in (VERSIONS or {}) else "ifcopenshell", "steps": list(STEPS), "sandbox": "dev" if DEV else "bwrap", **({"sandbox_error": SANDBOX_ERR} if SANDBOX_ERR else {}), "versions": VERSIONS, "queue": sum(1 for j in jobs.values() if j["state"] in ("queued", "running"))})
        b = re.fullmatch(r"/blobs/([0-9a-f]{64})", path)
        if b:
            f = BLOBS / b.group(1)
            return self.send(200, f.read_bytes(), "application/octet-stream") if f.is_file() else self.send(404, {"errors": [{"code": "missing_input", "message": "No such blob."}]})
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
        if path == "/blobs":
            n = int(self.headers.get("content-length") or 0)
            if n > MAX_BLOB:
                return self.send(413, {"errors": [{"code": "too_big", "message": "A blob is at most 64 MB."}]})
            sha, size = put_blob(self.rfile.read(n))
            return self.send(200, {"sha256": sha, "bytes": size, "url": f"/blobs/{sha}"})
        if path != "/jobs":
            return self.send(404, {"errors": [{"code": "bad_request", "message": "POST /jobs or /blobs"}]})
        if SANDBOX_ERR:
            return self.send(503, {"errors": [{"code": "sandbox_unavailable", "message": "The sandbox cannot start here: " + SANDBOX_ERR}]})
        n = int(self.headers.get("content-length") or 0)
        if n > MAX_BODY:
            return self.send(413, {"errors": [{"code": "too_big", "message": "A job is at most 8 MB."}]})
        try:
            a = json.loads(self.rfile.read(n))
            assert isinstance(a.get("script"), str) and a["script"].strip() or (a.get("script") is None and a.get("then"))
            assert all(s in STEPS for s in a.get("then") or [])
            mesh = a.get("mesh") or {}
            assert isinstance(mesh, dict) and set(mesh) <= {"linear_mm", "angular_deg"} and 0.001 <= float(mesh.get("linear_mm", 0.1)) <= 10 and 1 <= float(mesh.get("angular_deg", 15)) <= 90
            key = a.get("key") or self.headers.get("Idempotency-Key")
            assert key is None or (isinstance(key, str) and 0 < len(key) <= 120)
            assert all(re.fullmatch(r"[A-Za-z0-9._-]{1,80}", k) and not k.startswith(".") and re.fullmatch(r"[0-9a-f]{64}", str(v)) for k, v in (a.get("inputs") or {}).items())
        except Exception:
            return self.send(400, {"errors": [{"code": "bad_request", "message": "A job is JSON with a script (text; none for steps alone), inputs as {name: sha256}, then from " + ", ".join(STEPS) + ", mesh as {linear_mm 0.001-10, angular_deg 1-90}, key a string."}]})
        wait = re.search(r"(?:^|&)wait=(\d+)", q)
        with lock:
            again = next((x for x in jobs.values() if key and x.get("key") == key), None)
        if again:   # the same key: the job it started, done or still running
            if wait:
                again["done"].wait(min(int(wait.group(1)), 900))
                return self.send(200, view(again))
            return self.send(202, {"id": again["id"]})
        missing = [k for k, v in (a.get("inputs") or {}).items() if not (BLOBS / v).is_file()]
        if missing:
            return self.send(400, {"errors": [{"code": "missing_input", "message": "Not here (POST them to /blobs first): " + ", ".join(missing), "names": missing}]})
        jid = uuid.uuid4().hex; work = ROOT / jid; work.mkdir(parents=True)
        if a.get("script"):
            (work / "script.py").write_text(a["script"])
        (work / "params.json").write_text(json.dumps(a.get("params") or {}))
        inputs = []
        for name, b64 in (a.get("files") or {}).items():
            if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", name) or name.startswith("."):
                continue
            (work / name).write_bytes(base64.b64decode(b64)); inputs.append(name)
        for name, sha in (a.get("inputs") or {}).items():
            shutil.copyfile(BLOBS / sha, work / name); os.utime(BLOBS / sha); inputs.append(name)
        os.chmod(work, 0o777)
        j = {"id": jid, "t": time.time(), "state": "queued", "then": a.get("then"), "caps": a.get("caps"), "expect": a.get("expect"), "mesh": a.get("mesh"), "key": key, "inputs": inputs, "done": threading.Event()}
        with lock:
            jobs[jid] = j
        threading.Thread(target=run_job, args=(j,), daemon=True).start()
        if wait:
            j["done"].wait(min(int(wait.group(1)), 900))
            return self.send(200, view(j))
        self.send(202, {"id": jid})


if __name__ == "__main__":
    ROOT.mkdir(parents=True, exist_ok=True)
    if not DEV and not shutil.which("bwrap"):
        sys.exit("worker: no bubblewrap; set WORKER_UNSAFE_DEV=1 only on a developer's machine")
    VERSIONS = versions()
    SANDBOX_ERR = None if DEV else probe()
    if SANDBOX_ERR:
        print(f"worker: bubblewrap cannot start here: {SANDBOX_ERR}", flush=True)
    threading.Thread(target=sweep, daemon=True).start()
    port = int(os.environ.get("PORT", "8070"))
    print(f"worker on :{port} ({'dev, no sandbox' if DEV else 'bwrap'})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
