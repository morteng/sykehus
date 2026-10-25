"""A made-up FDV drawing through tools/dxfimport.py: millimetres in UTM 33, the building turned 30 degrees, walls as
line pairs and a hatched column, one room as a block with attributes and one as loose text.

  python -I tests/dxfimport_check.py   (needs ezdxf; prints ok or fails an assert)"""
import json, math, os, subprocess, sys, tempfile
import ezdxf

here = os.path.dirname(os.path.abspath(__file__))
with tempfile.TemporaryDirectory() as td:
    doc = ezdxf.new("R2018"); doc.header["$INSUNITS"] = 4; msp = doc.modelspace()
    a = math.radians(30); X0, Y0 = 230311.0 + 40, 6633185.0 + 20          # site (40, 20)
    P = lambda u, v: ((X0 + u * math.cos(a) - v * math.sin(a)) * 1000, (Y0 + u * math.sin(a) + v * math.cos(a)) * 1000)
    for (u0, v0, u1, v1), d in [((0, 0, 10, 0), (0, -0.2)), ((0, 6, 10, 6), (0, 0.2)), ((0, 0, 0, 6), (-0.2, 0)), ((10, 0, 10, 6), (0.2, 0))]:
        msp.add_line(P(u0, v0), P(u1, v1), dxfattribs={"layer": "A-VEGG"})
        msp.add_line(P(u0 + d[0], v0 + d[1]), P(u1 + d[0], v1 + d[1]), dxfattribs={"layer": "A-VEGG"})
    h = msp.add_hatch(dxfattribs={"layer": "A-VEGG-BETONG"}); h.paths.add_polyline_path([P(5, 3), P(5.4, 3), P(5.4, 3.4), P(5, 3.4)], is_closed=True)
    blk = doc.blocks.new("ROMSTEMPEL")
    for tag in ("ROMNR", "ROMNAVN", "AREAL"): blk.add_attdef(tag, (0, 0))
    ins = msp.add_blockref("ROMSTEMPEL", P(2.5, 3), dxfattribs={"layer": "A-ROM"})
    ins.add_auto_attribs({"ROMNR": "12.101", "ROMNAVN": "Kontor", "AREAL": "28,4"})
    msp.add_text("Lager", dxfattribs={"layer": "A-ROM-TEKST", "insert": P(7.5, 3)})
    msp.add_text("12,0 m²", dxfattribs={"layer": "A-ROM-TEKST", "insert": P(7.5, 2.6)})
    msp.add_text("12.102", dxfattribs={"layer": "A-ROM-TEKST", "insert": P(7.5, 3.4)})
    f = os.path.join(td, "plan.dxf"); doc.saveas(f)
    spec = os.path.join(td, "fdv.json")
    json.dump({"sheets": [{"id": "test", "file": f, "storey": "12. etasje", "wing": "sentralblokka", "kote": 58.11, "height": 3.76, "place": "utm",
                           "source": "test", "walls": "(?i)vegg", "rooms": "(?i)rom", "replaces": ["spor-x"]}]}, open(spec, "w"))
    fl = os.path.join(td, "floors.json"); json.dump({"floors": [{"id": "spor-x", "walls": [], "rooms": []}, {"id": "keep", "walls": [], "rooms": []}]}, open(fl, "w"))
    r = subprocess.run([sys.executable, "-I", os.path.join(here, "..", "tools", "dxfimport.py"), spec, "--floors", fl], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    out = json.load(open(fl))["floors"]; ids = [x["id"] for x in out]
    assert ids == ["keep", "fdv-test"], ids
    fdv = out[1]
    assert len(fdv["walls"]) == 5, (len(fdv["walls"]), r.stdout)
    rooms = {x["name"]: x for x in fdv["rooms"]}
    assert rooms["Kontor"]["code"] == "12.101" and rooms["Kontor"]["area_m2"] == 28.4, rooms
    assert rooms["Lager"]["code"] == "12.102" and rooms["Lager"]["area_m2"] == 12.0, rooms
    k = rooms["Kontor"]["at"]; ex = (40 + 2.5 * math.cos(a) - 3 * math.sin(a), 20 + 2.5 * math.sin(a) + 3 * math.cos(a))
    assert math.hypot(k[0] - ex[0], k[1] - ex[1]) < 0.02, (k, ex)
    w = fdv["walls"][0]; xs = [p[0] for p in w]; assert 30 < min(xs) < 60, w
    # the same drawing placed by two control points (drawing millimetres -> site metres) lands in the same place
    c = [(*P(0, 0), 40.0, 20.0), (*P(10, 0), 40 + 10 * math.cos(a), 20 + 10 * math.sin(a))]
    sp = json.load(open(spec)); sp["sheets"][0].update(place="cp", cp=";".join(",".join(f"{v:.4f}" for v in q) for q in c)); json.dump(sp, open(spec, "w"))
    r2 = subprocess.run([sys.executable, "-I", os.path.join(here, "..", "tools", "dxfimport.py"), spec, "--floors", fl], capture_output=True, text=True)
    assert r2.returncode == 0, r2.stderr
    k2 = {x["name"]: x for x in json.load(open(fl))["floors"][-1]["rooms"]}["Kontor"]["at"]
    assert math.hypot(k2[0] - ex[0], k2[1] - ex[1]) < 0.02, (k2, ex)
    print("ok:", r.stdout.strip())
