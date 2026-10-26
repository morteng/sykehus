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
r = subprocess.run(cmd, capture_output=True, text=True)
log = (r.stdout + r.stderr).strip().splitlines()
if not ses.is_file():
    sys.exit("Freerouting wrote no session: " + (" | ".join(log[-4:]) or f"exit {r.returncode}")[-400:])
if not pcbnew.ImportSpecctraSES(b, str(ses)):
    sys.exit("pcbnew could not read the routed session back")
pcbnew.SaveBoard(str(pcb), b)
tracks = [t for t in b.GetTracks()]
f = HERE / "kicad.json"
k = json.loads(f.read_text()) if f.exists() else {}
k["route"] = {"board": pcb.name, "tracks": sum(1 for t in tracks if t.GetClass() == "PCB_TRACK"), "vias": sum(1 for t in tracks if t.GetClass() == "PCB_VIA"),
              "seconds": round(time.time() - t0, 1), "log": log[-8:]}
f.write_text(json.dumps(k, indent=1))
print(json.dumps(k["route"]))
