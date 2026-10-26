"""A built-in step (U3582, the KiCad image): a KiCad project made from a parts-and-nets spec, with the library's own
symbols and footprints, so ERC and DRC can run on it (then: ["make", "erc", "drc", "step"]).

  board.json (in the job's folder; params.json's spec may name another):
  {"name": "keychain-board",
   "board": {"outline": [[x, y], ...] (mm, x right, y down, as pcbnew has it), "thickness": 1.0},
   "parts": [{"ref": "R1", "value": "4.7k", "symbol": "Device:R", "footprint": "Resistor_SMD:R_0402_1005Metric",
              "at": [x, y], "rot": 0}, ...
             a part with no library symbol: "pins": [{"number": "1", "name": "OUT", "type": "output"}, ...]
             in place of symbol: a box symbol is drawn for it],
   "nets": {"VBAT": ["U2:VBAT", "C3:1", ...], ...}    a pin by number or by its symbol's pin name (every pin of that name)
   "power_flags": ["GND", "VBUS"]}                     nets driven from outside (a PWR_FLAG on each, for ERC)

  <name>.kicad_sch  the schematic: each part's symbol from the library (copied in whole, a derived symbol made
                    whole), a net label on every pin in a net, a no-connect flag on every other pin
  <name>.kicad_pcb  the board (pcbnew): each footprint from the library at its place, every pad on its net, the
                    outline on Edge.Cuts, each footprint tied to its symbol (schematic parity); not routed
  <name>.kicad_pro  the project
  make.json         what it made: parts, nets, the pins left unconnected, the libraries it read

Runs as it is in a job too (a script job of the KiCad image, while it is being tried): `python make.py`.
"""
import glob
import json
import os
import pathlib
import re
import sys
import uuid

HERE = pathlib.Path(".")
P = json.loads((HERE / "params.json").read_text()) if (HERE / "params.json").exists() else {}


# ---------- s-expressions: KiCad's files, read and written as nested lists; a quoted string is a Q
class Q(str):
    pass


TOK = re.compile(r'\s*(?:(\()|(\))|"((?:[^"\\]|\\.)*)"|([^\s()"]+))')


def parse(text):
    stack, cur, i = [], [], 0
    while True:
        m = TOK.match(text, i)
        if not m or m.end() == i:
            break
        i = m.end()
        if m.group(1):
            stack.append(cur); cur = []
        elif m.group(2):
            done, cur = cur, stack.pop(); cur.append(done)
        elif m.group(3) is not None:
            cur.append(Q(re.sub(r"\\(.)", r"\1", m.group(3))))
        else:
            cur.append(m.group(4))
    return cur[0] if cur else None


def dump(x, ind=0):
    if isinstance(x, Q):
        return '"' + x.replace("\\", "\\\\").replace('"', '\\"') + '"'
    if not isinstance(x, list):
        return str(x)
    if not any(isinstance(y, list) for y in x):
        return "(" + " ".join(dump(y) for y in x) + ")"
    pad = "\t" * (ind + 1)
    return "(" + " ".join(dump(y) for y in x if not isinstance(y, list)) + "".join("\n" + pad + dump(y, ind + 1) for y in x if isinstance(y, list)) + ")"


def kids(x, tag):
    return [y for y in x if isinstance(y, list) and y and y[0] == tag]


def kid(x, tag):
    k = kids(x, tag)
    return k[0] if k else None


# ---------- the libraries in this image
def dirs(kind):
    env = [os.environ[k] for k in os.environ if re.fullmatch(rf"KICAD\d*_{kind}_DIR", k)]
    return [d for d in env + [f"/usr/share/kicad/{kind.lower()}s", f"/usr/local/share/kicad/{kind.lower()}s", *glob.glob(f"/usr/share/kicad*/{kind.lower()}s"), str(HERE / "lib")] if os.path.isdir(d)]


SYMDIRS, FPDIRS = dirs("SYMBOL"), dirs("FOOTPRINT")
_libs = {}


def symlib(lib):
    if lib not in _libs:
        f = next((pathlib.Path(d) / f"{lib}.kicad_sym" for d in SYMDIRS if (pathlib.Path(d) / f"{lib}.kicad_sym").is_file()), None)
        if f is None:
            sys.exit(f"no symbol library {lib} (looked in {', '.join(SYMDIRS) or 'nothing'})")
        _libs[lib] = {s[1]: s for s in kids(parse(f.read_text()), "symbol")}
    return _libs[lib]


def whole(lib, name):
    """the symbol as one: a derived one (extends) is its parent's body with its own fields"""
    s = symlib(lib).get(name)
    if s is None:
        sys.exit(f"no symbol {name} in {lib}")
    ext = kid(s, "extends")
    if not ext:
        return [x for x in s]
    base = whole(lib, ext[1])
    mine = {p[1]: p for p in kids(s, "property")}
    out = [base[0], Q(name)]
    for x in base[2:]:
        if isinstance(x, list) and x[0] == "property" and x[1] in mine:
            out.append(mine.pop(x[1]))
        elif isinstance(x, list) and x[0] == "symbol":
            out.append([x[0], Q(re.sub(r"^.*(_\d+_\d+)$", lambda m: name + m.group(1), x[1]))] + x[2:])
        else:
            out.append(x)
    return out[:2] + [p for p in out[2:] if not (isinstance(p, list) and p[0] == "symbol")] + list(mine.values()) + [p for p in out[2:] if isinstance(p, list) and p[0] == "symbol"]


def pins_of(sym):
    """[{unit, number, name, type, at: (x, y) in the symbol's frame (y up)}]; body style 1 only"""
    out = []
    for sub in kids(sym, "symbol"):
        m = re.search(r"_(\d+)_(\d+)$", sub[1])
        unit, style = (int(m.group(1)), int(m.group(2))) if m else (1, 1)
        if style not in (0, 1):
            continue
        for p in kids(sub, "pin"):
            at = kid(p, "at")
            out.append({"unit": unit, "type": p[1], "number": str(kid(p, "number")[1]), "name": str(kid(p, "name")[1]), "at": (float(at[1]), float(at[2]))})
    return out


def box_symbol(name, pins):
    """a part with no library symbol: a box, pins down both sides, 2.54 apart"""
    n = len(pins); left = pins[: (n + 1) // 2]; right = pins[(n + 1) // 2:]
    h = max(len(left), len(right)) * 2.54 + 2.54
    g = [Q(f"{name}_0_1"), ["rectangle", ["start", -7.62, h / 2], ["end", 7.62, -h / 2], ["stroke", ["width", 0.254], ["type", "default"]], ["fill", ["type", "background"]]]]
    body = [Q(f"{name}_1_1")]
    for side, ps in ((-1, left), (1, right)):
        for i, p in enumerate(ps):
            y = h / 2 - 2.54 * (i + 1)
            body.append(["pin", p.get("type", "passive"), "line", ["at", side * 10.16, round(y, 2), 0 if side < 0 else 180], ["length", 2.54],
                         ["name", Q(p.get("name", p["number"])), ["effects", ["font", ["size", 1.27, 1.27]]]], ["number", Q(str(p["number"])), ["effects", ["font", ["size", 1.27, 1.27]]]]])
    prop = lambda k, v, hide=False: ["property", Q(k), Q(v), ["at", 0, 0, 0], ["effects", ["font", ["size", 1.27, 1.27]]] + ([["hide", "yes"]] if hide else [])]
    return ["symbol", Q(name), ["exclude_from_sim", "no"], ["in_bom", "yes"], ["on_board", "yes"], prop("Reference", "U"), prop("Value", name), prop("Footprint", "", True), prop("Datasheet", "", True), prop("Description", "", True), ["symbol"] + g, ["symbol"] + body]


# ---------- the spec
spec_f = HERE / (P.get("spec") or "board.json")
if not spec_f.is_file():
    sys.exit(f"no spec: send {spec_f.name}")
S = json.loads(spec_f.read_text())
NAME = re.sub(r"[^A-Za-z0-9_-]", "-", S.get("name") or "board")
ROOT = str(uuid.uuid5(uuid.NAMESPACE_URL, "sykehus-make/" + NAME))
uid = lambda *k: str(uuid.uuid5(uuid.NAMESPACE_URL, "/".join([ROOT, *map(str, k)])))   # the same spec, the same ids

libsyms, parts = {}, []
for p in S["parts"]:
    if p.get("pins"):
        key = "custom:" + re.sub(r"[^A-Za-z0-9_.-]", "_", p.get("value") or p["ref"])
        sym = box_symbol(key.split(":")[1], p["pins"])
    else:
        key = p["symbol"]; lib, nm = key.split(":", 1); sym = whole(lib, nm)
    sym = [sym[0], Q(key)] + sym[2:]
    libsyms[key] = sym
    parts.append({**p, "key": key, "pins": pins_of(sym), "uuid": uid("sym", p["ref"])})
by_ref = {p["ref"]: p for p in parts}

# each pin's net: by number, or every pin of that name
net_of, unknown = {}, []
for net, members in S["nets"].items():
    for m in members:
        ref, _, pin = m.partition(":")
        p = by_ref.get(ref)
        hit = [q for q in (p["pins"] if p else []) if q["number"] == pin] or [q for q in (p["pins"] if p else []) if q["name"] == pin]
        if not hit:
            unknown.append(m)
        for q in hit:
            net_of[(ref, q["number"])] = net
if unknown:
    sys.exit("no such pins: " + ", ".join(unknown[:30]))

# ---------- the schematic: the parts in rows, each pin's net as a label on its end
G = 2.54
snap = lambda v: round(round(v / G) * G, 2)
items, x, y, row_h, W = [], 25.4, 25.4, 0, 400
flags = [{"ref": f"#FLG{i + 1:02d}", "net": n} for i, n in enumerate(S.get("power_flags") or [])]
if flags:
    libsyms["power:PWR_FLAG"] = [whole("power", "PWR_FLAG")[0], Q("power:PWR_FLAG")] + whole("power", "PWR_FLAG")[2:]
loose = []
for p in parts + [{"ref": f["ref"], "key": "power:PWR_FLAG", "value": "PWR_FLAG", "flag": f["net"], "pins": pins_of(libsyms["power:PWR_FLAG"]), "uuid": uid("flag", f["ref"])} for f in flags]:
    units = sorted({q["unit"] for q in p["pins"] if q["unit"] > 0}) or [1]
    for u in units:
        ps = [q for q in p["pins"] if q["unit"] in (0, u)]
        xs, ys = [q["at"][0] for q in ps] or [0], [q["at"][1] for q in ps] or [0]
        w, h = max(xs) - min(xs) + 40, max(ys) - min(ys) + 20
        if x + w > W:
            x, y, row_h = 25.4, y + row_h, 0
        ox, oy = snap(x - min(xs) + 20), snap(y + max(ys) + 10)
        x += w; row_h = max(row_h, h)
        su = p["uuid"] if u == units[0] else uid("sym", p["ref"], u)
        prop = lambda k, v, dy, hide=False: ["property", Q(k), Q(v), ["at", ox, round(oy + dy, 2), 0], ["effects", ["font", ["size", 1.27, 1.27]]] + ([["hide", "yes"]] if hide else [])]
        items.append(["symbol", ["lib_id", Q(p["key"])], ["at", ox, oy, 0], ["unit", u], ["exclude_from_sim", "no"], ["in_bom", "no" if p.get("flag") else "yes"], ["on_board", "no" if p.get("flag") else "yes"], ["dnp", "no"],
                      ["uuid", Q(su)], prop("Reference", p["ref"], min(ys) * -1 - 5.08 if ys else -5.08), prop("Value", p.get("value") or "", max(ys) * -1 + 7.62 if ys else 5.08),
                      prop("Footprint", p.get("footprint") or "", 0, True), prop("Datasheet", "~", 0, True), prop("Description", "", 0, True)]
                     + [["pin", Q(q["number"]), ["uuid", Q(uid("pin", p["ref"], u, q["number"]))]] for q in ps]
                     + [["instances", ["project", Q(NAME), ["path", Q("/" + ROOT), ["reference", Q(p["ref"])], ["unit", u]]]]])
        seen = set()
        for q in ps:
            at = (round(ox + q["at"][0], 2), round(oy - q["at"][1], 2))   # the symbol's y is up, the sheet's down
            if at in seen:
                continue
            seen.add(at)
            net = p["flag"] if p.get("flag") else net_of.get((p["ref"], q["number"]))
            if net:
                items.append(["label", Q(net), ["at", at[0], at[1], 0], ["effects", ["font", ["size", 1.27, 1.27]], ["justify", "left", "bottom"]], ["uuid", Q(uid("label", p["ref"], q["number"]))]])
            elif q["type"] != "no_connect":
                items.append(["no_connect", ["at", at[0], at[1]], ["uuid", Q(uid("nc", p["ref"], q["number"]))]]); loose.append(f"{p['ref']}:{q['name'] or q['number']}")
sch = ["kicad_sch", ["version", 20250114], ["generator", Q("eeschema")], ["generator_version", Q("9.0")], ["uuid", Q(ROOT)], ["paper", Q("A1")],
       ["lib_symbols"] + list(libsyms.values())] + items + [["sheet_instances", ["path", Q("/"), ["page", Q("1")]]], ["embedded_fonts", "no"]]
(HERE / f"{NAME}.kicad_sch").write_text(dump(sch) + "\n")
(HERE / f"{NAME}.kicad_pro").write_text(json.dumps({"meta": {"filename": f"{NAME}.kicad_pro", "version": 3}}, indent=2) + "\n")

# ---------- the board (pcbnew, in the KiCad image)
made = {"name": NAME, "parts": len(parts), "nets": len(S["nets"]), "unconnected_pins": loose, "symbol_dirs": SYMDIRS, "footprint_dirs": FPDIRS}
try:
    import pcbnew
except ImportError as e:
    made["board"] = f"not made: no pcbnew here ({e})"
else:
    mm = pcbnew.FromMM
    b = pcbnew.CreateEmptyBoard()
    b.GetDesignSettings().SetBoardThickness(mm(float(S.get("board", {}).get("thickness", 1.6))))
    nets = {}
    for n in S["nets"]:
        ni = pcbnew.NETINFO_ITEM(b, n); b.Add(ni); nets[n] = ni
    missing = []
    for p in parts:
        if not p.get("footprint"):
            continue
        lib, nm = p["footprint"].split(":", 1)
        d = next((pathlib.Path(x) / f"{lib}.pretty" for x in FPDIRS if (pathlib.Path(x) / f"{lib}.pretty" / f"{nm}.kicad_mod").is_file()), None)
        fp = pcbnew.FootprintLoad(str(d), nm) if d else None
        if fp is None:
            missing.append(p["footprint"]); continue
        fp.SetFPID(pcbnew.LIB_ID(lib, nm))
        fp.SetReference(p["ref"]); fp.SetValue(p.get("value") or "")
        fp.SetPath(pcbnew.KIID_PATH("/" + p["uuid"]))
        b.Add(fp)
        fp.SetPosition(pcbnew.VECTOR2I(mm(p["at"][0]), mm(p["at"][1])))
        fp.SetOrientationDegrees(float(p.get("rot", 0)))
        for pad in fp.Pads():
            n = net_of.get((p["ref"], pad.GetNumber()))
            if n:
                pad.SetNet(nets[n])
    if missing:
        sys.exit("no such footprints: " + ", ".join(missing))
    ring = S.get("board", {}).get("outline") or []
    for i in range(len(ring)):
        s = pcbnew.PCB_SHAPE(b); s.SetShape(pcbnew.SHAPE_T_SEGMENT); s.SetLayer(pcbnew.Edge_Cuts)
        (s.SetWidth if hasattr(s, "SetWidth") else s.SetLineWidth)(mm(0.1))
        a, c = ring[i], ring[(i + 1) % len(ring)]
        s.SetStart(pcbnew.VECTOR2I(mm(a[0]), mm(a[1]))); s.SetEnd(pcbnew.VECTOR2I(mm(c[0]), mm(c[1]))); b.Add(s)
    pcbnew.SaveBoard(str(HERE / f"{NAME}.kicad_pcb"), b)
    made["board"] = f"{NAME}.kicad_pcb"; made["kicad"] = pcbnew.GetBuildVersion()
(HERE / "make.json").write_text(json.dumps(made, indent=1))
print(json.dumps({k: made[k] for k in ("name", "parts", "nets", "board")} | {"unconnected_pins": len(loose)}))
