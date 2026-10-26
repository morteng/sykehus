"""A built-in step (trusted, run in the job's sandbox after its script): model.glb from the IFC it made, with
IfcOpenShell's glTF serializer, unless the script wrote a .glb with meshes itself."""
import json
import pathlib
import struct
import sys

import ifcopenshell
import ifcopenshell.geom as G


def meshes(p):
    b = p.read_bytes()
    if b[:4] != b"glTF":
        return 0
    n = struct.unpack("<I", b[12:16])[0]
    return len(json.loads(b[20:20 + n]).get("meshes", []))


if any(meshes(p) for p in pathlib.Path(".").glob("*.glb")):
    sys.exit(0)
ifcs = sorted(pathlib.Path(".").glob("*.ifc"), key=lambda p: (p.name != "model.ifc", p.name))
if not ifcs:
    sys.exit("no IFC: the script wrote no .ifc file")
f = ifcopenshell.open(str(ifcs[0]))
s = G.settings(); s.set("use-world-coords", True)
ser = G.serializers.gltf("model.glb", s, G.serializer_settings()); ser.setFile(f); ser.writeHeader()
it = G.iterator(s, f, 1)
if it.initialize():
    while True:
        ser.write(it.get())
        if not it.next():
            break
ser.finalize()
