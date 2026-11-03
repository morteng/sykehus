"""U3930: the app run's one-ask entry on the FreeCAD worker (the shape U3928 proves on Fab). The worker's job API runs this
file's text as the job's script, with the version's own folder files beside it (each under an in__ name) and the ask in
params.json: {"restore": {in__x: x}, "ask": {"run": {"src", "name"}} | {"state": {"open": [..]}}}. It puts the files back
under their real names, raises the folder fence, runs the one ask and prints the answer as the last JSON line.

The fence (an audit hook that cannot be taken off): the script may not use the network, start or stop other programs,
load native code, or write a file outside this folder. FreeCAD's own exporters (Part.export, Mesh.export ...) write from
C++ where the hook cannot see, so they are wrapped with the same folder check. Document.saveAs is FreeCAD's own C++ write:
scripts name a file relative to this folder (the run starts here); an absolute name outside it is a known gap."""
import io
import json
import os
import sys
import traceback

HOME = os.path.realpath(os.getcwd())
APP_HOME = os.path.join(HOME, ".app-home")
TRACE = 30
SYNTAX_KIND, FENCE_KIND = "syntax", "write outside the folder"


class Fenced(Exception):
    pass


def inside(p):
    if isinstance(p, int):
        return True
    try:
        return (os.path.realpath(os.fsdecode(p)) + os.sep).startswith(HOME + os.sep)
    except (TypeError, ValueError):
        return False


def fence():
    writes = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC
    progs = {"subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "os.fork", "os.forkpty", "os.kill",
             "os.killpg", "pty.spawn", "os.startfile"}
    paths2 = {"os.rename", "os.link"}
    paths1 = {"os.remove", "os.rmdir", "os.mkdir", "os.chmod", "os.chown", "os.symlink", "os.truncate", "os.utime",
              "shutil.rmtree", "os.chflags", "os.setxattr", "os.removexattr"}

    def hook(ev, args):
        if ev.startswith("socket.") or ev in ("urllib.Request", "http.client.connect", "ftplib.connect", "smtplib.connect"):
            raise Fenced("it may not use the network")
        if ev in progs:
            raise Fenced("it may not start or stop other programs")
        if ev.startswith("ctypes."):
            raise Fenced("it may not load native code")
        if ev == "open" and args and ((isinstance(args[1], str) and any(c in args[1] for c in "wax+")) or (args[2] or 0) & writes):
            if not inside(args[0]):
                raise Fenced("it may only write files in its own folder")
        elif (ev in paths1 and args and not inside(args[0])) or (ev in paths2 and not (inside(args[0]) and inside(args[1]))):
            raise Fenced("it may only change files in its own folder")
    sys.addaudithook(hook)


def guard(fn):
    def call(*a, **k):
        for v in (*a, *k.values()):
            if isinstance(v, str) and v and not inside(v):
                raise Fenced("it may only write files in its own folder")
        return fn(*a, **k)
    return call


def wrap_exporters():
    for mod_name, fns in (("Part", ("export", "exportBrep")), ("Mesh", ("export", "write")), ("importIFC", ("export",)), ("exportIFC", ("export",))):
        try:
            mod = __import__(mod_name)
        except ImportError:
            continue
        for fn in fns:
            f = getattr(mod, fn, None)
            if callable(f):
                setattr(mod, fn, guard(f))


def kind_of(e):
    if isinstance(e, Fenced):
        return FENCE_KIND if "folder" in str(e) else "other"
    msg = str(e)
    if isinstance(e, SyntaxError):
        return SYNTAX_KIND
    if isinstance(e, (NameError, AttributeError, ImportError)):
        return "unknown name"
    if type(e).__name__ == "OCCError" or "BRep" in msg or "StdFail" in msg or "NullObject" in msg:
        return "geometry"
    return "other"


def do_run(src, name):
    path = os.path.join(APP_HOME, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(src)
    try:
        code = compile(src, path, "exec")
    except SyntaxError as e:
        return {"ok": False, "exit": 3, "kind": SYNTAX_KIND, "error": "The script has a mistake at line %s: %s" % (e.lineno, e.msg),
                "line": {"n": e.lineno, "text": (e.text or "").strip()}, "traceback": [], "output": ""}
    out, was = io.StringIO(), (sys.stdout, sys.stderr)
    sys.stdout = sys.stderr = out
    try:
        exec(code, {"__name__": "__app_run__", "__file__": path})
        return {"ok": True, "exit": 0, "kind": None, "error": None, "line": None, "traceback": [], "output": out.getvalue()}
    except BaseException as e:
        tail = "".join(traceback.format_exception(type(e), e, e.__traceback__)).splitlines()[-TRACE:]
        line = None
        for f in reversed(traceback.extract_tb(e.__traceback__)):
            if f.filename == path:
                line = {"n": f.lineno, "text": (f.line or "").strip()}
                break
        why = str(e) if isinstance(e, Fenced) else ("%s: %s" % (type(e).__name__, e) if str(e) else type(e).__name__)
        return {"ok": False, "exit": 2 if isinstance(e, Fenced) else 1, "kind": kind_of(e), "error": why, "line": line,
                "traceback": tail, "output": out.getvalue()}
    finally:
        sys.stdout, sys.stderr = was


def do_state(open_these):
    import FreeCAD
    errors = []
    have = {os.path.realpath(d.FileName) for d in FreeCAD.listDocuments().values() if d.FileName}
    for rel in open_these or []:
        path = os.path.join(HOME, rel)
        if not inside(path):
            errors.append({"file": rel, "error": "outside the version's own folder"})
        elif os.path.realpath(path) not in have:
            try:
                FreeCAD.openDocument(path)
            except Exception as e:
                errors.append({"file": rel, "error": "%s: %s" % (type(e).__name__, e)})
    docs = []
    for d in FreeCAD.listDocuments().values():
        objs = []
        for o in d.Objects:
            st = list(o.State)
            objs.append({"name": o.Name, "label": o.Label, "type": o.TypeId, "state": st, "touched": "Touched" in st,
                         "failed": "Invalid" in st, "parents": [p.Label or p.Name for p in o.InList]})
        docs.append({"file": os.path.relpath(d.FileName, HOME) if d.FileName else None, "name": d.Name, "objects": objs})
    return {"documents": docs, "open_errors": errors}


def main():
    sent = json.load(open("params.json", encoding="utf-8"))
    for flat, name in (sent.get("restore") or {}).items():
        if os.path.isfile(flat):
            os.rename(flat, name)
    os.makedirs(APP_HOME, exist_ok=True)
    os.environ.update(HOME=APP_HOME, TMPDIR=APP_HOME)
    fence()
    wrap_exporters()
    ask = sent.get("ask") or {}
    if "run" in ask:
        done = do_run(ask["run"].get("src") or "", ask["run"].get("name") or "app_script.py")
    elif "state" in ask:
        try:
            done = do_state(ask["state"].get("open") or [])
        except Exception as e:
            done = {"error": "%s: %s" % (type(e).__name__, e)}
    else:
        done = {"ok": False, "exit": 3, "kind": "other", "error": "unknown ask"}
    print(json.dumps({"done": done}))


main()
