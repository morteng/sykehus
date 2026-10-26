"""The KiCad steps (trusted, run in the job's sandbox, in the KiCad image): kicad-cli on a board and its schematic.

  python -I .step-kicad.py <step>    step: erc, drc, step, outline or render

The project is the job's inputs: the .kicad_pcb and .kicad_sch (and .kicad_pro, sym-lib-table, fp-lib-table, the
project's own .kicad_sym, .kicad_mod and 3D models), each by name, or a .tar / .tar.gz / .tgz / .zip of the project's
folder (unpacked here first). params.json may name board and schematic (paths in the job's folder); else the one whose
name is the .kicad_pro's, else the only one.

  erc      erc.json (kicad-cli's own report), ERC on the schematic, every severity
  drc      drc.json, DRC on the board, every severity, with schematic parity when there is a schematic
  step     <board>.step: the board with its parts (the 3D models the footprints name, where they are found)
  outline  outline.dxf and outline.svg: Edge.Cuts, mm, the page the board's size
  render   <board>.png: the top, 1600 × 900

Each writes what it found into kicad.json (the job's kicad): {erc: {errors, warnings, ok, report}, drc: {errors,
warnings, unconnected, parity, ok, report}, step: {file, bytes}, outline: {files}, render: {file}}. A check that finds
violations is still done (ok false); a kicad-cli that cannot read the file fails the step, with its words.
"""
import json
import pathlib
import subprocess
import sys
import tarfile
import zipfile

HERE = pathlib.Path(".")
STEP = sys.argv[1] if len(sys.argv) > 1 else ""
P = json.loads((HERE / "params.json").read_text()) if (HERE / "params.json").exists() else {}


def inside(name):
    """a member's path, if it stays inside the job's folder (no absolute path, no ..)"""
    p = pathlib.PurePosixPath(name)
    return not p.is_absolute() and ".." not in p.parts and name.strip() != ""


def unpack():
    """a project sent as an archive, unpacked once: regular files and folders only, nothing outside the folder. What
    came out is listed in .unpacked, so the job does not hand it back as made"""
    if (HERE / ".unpacked").exists():
        return
    before = {f.name for f in HERE.iterdir()}
    for a in sorted(HERE.iterdir()):
        n = a.name.lower()
        if n.endswith((".tar", ".tar.gz", ".tgz")):
            with tarfile.open(a) as t:
                for m in t.getmembers():
                    if not inside(m.name) or not (m.isfile() or m.isdir()):
                        continue
                    if m.isdir():
                        (HERE / m.name).mkdir(parents=True, exist_ok=True); continue
                    (HERE / m.name).parent.mkdir(parents=True, exist_ok=True)
                    (HERE / m.name).write_bytes(t.extractfile(m).read())
        elif n.endswith(".zip"):
            with zipfile.ZipFile(a) as z:
                for m in z.infolist():
                    if not inside(m.filename) or m.is_dir():
                        continue
                    (HERE / m.filename).parent.mkdir(parents=True, exist_ok=True)
                    (HERE / m.filename).write_bytes(z.read(m))
    (HERE / ".unpacked").write_text(json.dumps(sorted({f.name for f in HERE.iterdir()} - before)))


def pick(ext, asked):
    if asked:
        f = HERE / asked
        if not inside(asked) or not f.is_file():
            sys.exit(f"no such file: {asked}")
        return f
    fs = sorted(f for f in HERE.rglob("*" + ext) if not any(x.startswith(".") for x in f.parts))
    pro = sorted(HERE.rglob("*.kicad_pro"))
    for f in fs:
        if pro and f.stem == pro[0].stem and f.parent == pro[0].parent:
            return f
    return fs[0] if len(fs) == 1 else (None if not fs else sys.exit(f"more than one {ext}: name the one in params ({', '.join(str(f) for f in fs)})"))


def cli(*args):
    p = subprocess.run(["kicad-cli", *map(str, args)], capture_output=True, text=True)
    if p.returncode not in (0, 5):
        sys.exit(f"kicad-cli {args[0]} {args[1]}: " + ((p.stderr or p.stdout).strip().splitlines() or [f"exit {p.returncode}"])[-1])
    return p


def counts(vs):
    return sum(1 for v in vs if v.get("severity") == "error"), sum(1 for v in vs if v.get("severity") == "warning")


def note(key, facts):
    f = HERE / "kicad.json"
    k = json.loads(f.read_text()) if f.exists() else {}
    k[key] = facts
    f.write_text(json.dumps(k, indent=1))


unpack()
board, sch = pick(".kicad_pcb", P.get("board")), pick(".kicad_sch", P.get("schematic"))
if STEP == "erc":
    if not sch:
        sys.exit("no schematic: send a .kicad_sch")
    cli("sch", "erc", "--format", "json", "--severity-all", "-o", "erc.json", sch)
    r = json.loads(pathlib.Path("erc.json").read_text())
    e, w = counts([v for s in r.get("sheets", []) for v in s.get("violations", [])])
    note("erc", {"errors": e, "warnings": w, "ok": e == 0, "report": "erc.json"})
elif STEP == "drc":
    if not board:
        sys.exit("no board: send a .kicad_pcb")
    cli("pcb", "drc", "--format", "json", "--severity-all", *(["--schematic-parity"] if sch else []), "-o", "drc.json", board)
    r = json.loads(pathlib.Path("drc.json").read_text())
    e, w = counts(r.get("violations", []))
    un, par = len(r.get("unconnected_items", [])), len(r.get("schematic_parity", []))
    note("drc", {"errors": e, "warnings": w, "unconnected": un, "parity": par, "ok": e == 0 and un == 0 and par == 0, "report": "drc.json"})
elif STEP == "step":
    if not board:
        sys.exit("no board: send a .kicad_pcb")
    out = pathlib.Path(board.stem + ".step")
    p = cli("pcb", "export", "step", "--force", "--subst-models", "-o", out, board)
    if not out.is_file():
        sys.exit("kicad-cli wrote no STEP: " + (p.stderr or p.stdout).strip()[-300:])
    missing = sorted({l.split("'")[1] for l in (p.stdout + p.stderr).splitlines() if "ould not" in l and "'" in l})[:40]
    note("step", {"file": out.name, "bytes": out.stat().st_size, **({"models_missing": missing} if missing else {})})
elif STEP == "outline":
    if not board:
        sys.exit("no board: send a .kicad_pcb")
    cli("pcb", "export", "dxf", "--layers", "Edge.Cuts", "--mode-single", "--output-units", "mm", "-o", "outline.dxf", board)
    cli("pcb", "export", "svg", "--layers", "Edge.Cuts", "--mode-single", "--page-size-mode", "2", "--exclude-drawing-sheet", "-o", "outline.svg", board)
    note("outline", {"files": [f for f in ("outline.dxf", "outline.svg") if pathlib.Path(f).is_file()]})
elif STEP == "render":
    if not board:
        sys.exit("no board: send a .kicad_pcb")
    out = pathlib.Path(board.stem + ".png")
    cli("pcb", "render", "--side", "top", "--width", "1600", "--height", "900", "--quality", "high", "-o", out, board)
    if not out.is_file():
        sys.exit("kicad-cli wrote no picture")
    note("render", {"file": out.name})
else:
    sys.exit(f"no such KiCad step: {STEP}")
