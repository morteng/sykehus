"""A built-in step (U3588, the KiCad image): the board routed by Freerouting, then saved for DRC (then: ["make",
"route", "erc", "drc", "step"]).

pcbnew writes the board as a Specctra DSN (its net classes' track widths, clearances and vias with it); Freerouting
routes it headless (no window, no analytics, no API server, no network: the sandbox has none); pcbnew reads the
session back into the board and saves it over the unrouted one. params.json may set route: {passes (default 30),
threads (1)}. The board: params' board, else the job's one .kicad_pcb.

  <board>.dsn, <board>.ses   what went to the router and what came back
  kicad.json's route          {tracks, vias, passes, seconds, log (the router's last lines)}

A board the router cannot finish is still saved with what it routed; DRC says what is left (unconnected).
"""
import glob
import json
import os
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(".")
P = json.loads((HERE / "params.json").read_text()) if (HERE / "params.json").exists() else {}
JAR = os.environ.get("FREEROUTING_JAR", "/opt/freerouting/freerouting.jar")
JAVA = os.environ.get("FREEROUTING_JAVA", "/opt/java/bin/java")

import pcbnew  # noqa: E402

pcbs = [pathlib.Path(P["board"])] if P.get("board") else sorted(pathlib.Path(f) for f in glob.glob("*.kicad_pcb"))
if len(pcbs) != 1 or not pcbs[0].is_file():
    sys.exit("no board to route: make one first (then: make, route), or name it in params' board")
pcb = pcbs[0]
b = pcbnew.LoadBoard(str(pcb))
dsn, ses = pcb.with_suffix(".dsn"), pcb.with_suffix(".ses")


def edge_keepouts(b):
    """the board's edge clearance as keepouts along each Edge.Cuts segment (no tracks, no vias; pads and parts may
    stand there, as an edge connector does): the router keeps off them, and they go again once it has routed. The
    router does not know KiCad's copper-to-edge rule, so without them it lays tracks up to the edge"""
    ds = b.GetDesignSettings()
    w = max(int(getattr(ds, "m_CopperEdgeClearance", 0) or 0), pcbnew.FromMM(0.5)) + pcbnew.FromMM(0.05)
    segs = [d for d in b.GetDrawings() if d.GetLayer() == pcbnew.Edge_Cuts and d.GetClass() == "PCB_SHAPE" and d.GetShape() == pcbnew.SHAPE_T_SEGMENT]
    bb = b.GetBoardEdgesBoundingBox(); cx, cy = bb.GetCenter().x, bb.GetCenter().y
    out = []
    for d in segs:
        a, c = d.GetStart(), d.GetEnd(); dx, dy = c.x - a.x, c.y - a.y; L = (dx * dx + dy * dy) ** 0.5
        if L == 0:
            continue
        nx, ny = -dy / L, dx / L
        if (cx - a.x) * nx + (cy - a.y) * ny < 0:   # the normal into the board
            nx, ny = -nx, -ny
        z = pcbnew.ZONE(b); z.SetIsRuleArea(True)
        z.SetDoNotAllowTracks(True); z.SetDoNotAllowVias(True); z.SetDoNotAllowPads(False); z.SetDoNotAllowFootprints(False)
        (z.SetDoNotAllowZoneFills if hasattr(z, "SetDoNotAllowZoneFills") else z.SetDoNotAllowCopperPour)(False)
        z.SetLayerSet(pcbnew.LSET.AllCuMask())
        o = z.Outline(); o.NewOutline()
        for x, y in ((a.x, a.y), (c.x, c.y), (c.x + nx * w, c.y + ny * w), (a.x + nx * w, a.y + ny * w)):
            o.Append(int(x), int(y))
        b.Add(z); out.append(z)
    return out


keep = edge_keepouts(b)
if not pcbnew.ExportSpecctraDSN(b, str(dsn)):
    sys.exit("pcbnew could not write the Specctra DSN")
opt = P.get("route") or {}
# the JVM inside the sandbox: an empty /proc (no container probing), a 4 GB address space, few threads
jvm = [JAVA, "-Xmx1500m", "-Xss1m", "-XX:+UseSerialGC", "-XX:-UseContainerSupport", "-XX:CICompilerCount=2",
       "-XX:ReservedCodeCacheSize=96m", "-XX:CompressedClassSpaceSize=192m", "-XX:MaxMetaspaceSize=256m",
       "-XX:-UsePerfData", "-Djava.awt.headless=true", "-Duser.home=/tmp"]
cmd = jvm + ["-jar", JAR, "-de", str(dsn), "-do", str(ses), "-mp", str(int(opt.get("passes", 30))), "-mt", str(int(opt.get("threads", 1))),
             "-da", "-dct", "0", "--gui.enabled=false", "--api_server.enabled=false", "--logging.file.enabled=false", "--user_data_path=/tmp/freerouting"]
t0 = time.time()
# java finds its own libraries at $ORIGIN/../lib, and $ORIGIN is read from /proc/self/exe, which the sandbox's empty
# /proc does not have: so their folders are named outright
home = pathlib.Path(JAVA).resolve().parent.parent
env = {**os.environ, "LD_LIBRARY_PATH": ":".join(str(home / d) for d in ("lib", "lib/server")), "JAVA_HOME": str(home)}
r = subprocess.run(cmd, capture_output=True, text=True, env=env)
log = (r.stdout + r.stderr).strip().splitlines()
if not ses.is_file():
    print("\n".join(log[-40:]), file=sys.stderr)
    sys.exit("Freerouting wrote no session: " + (" | ".join(log[-4:]) or f"exit {r.returncode}")[-400:])
if not pcbnew.ImportSpecctraSES(b, str(ses)):
    sys.exit("pcbnew could not read the routed session back")
for z in keep:
    b.Remove(z)
pcbnew.SaveBoard(str(pcb), b)
tracks = [t for t in b.GetTracks()]
f = HERE / "kicad.json"
k = json.loads(f.read_text()) if f.exists() else {}
k["route"] = {"board": pcb.name, "tracks": sum(1 for t in tracks if t.GetClass() == "PCB_TRACK"), "vias": sum(1 for t in tracks if t.GetClass() == "PCB_VIA"),
              "seconds": round(time.time() - t0, 1), "edge_keepouts": len(keep), "log": log[-8:]}
f.write_text(json.dumps(k, indent=1))
print(json.dumps(k["route"]))
