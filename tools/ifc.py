"""The buildings as IFC4 (BIM): what the viewer shows, written as walls, slabs, windows and doors on storeys, so FreeCAD
(BIM), Solibri, Revit or any IFC tool can open it. Our data stays the truth; this is an export of it.

  python -I tools/ifc.py <site.json> <floors.json> <out.ifc> [wing id ...]

In the file: a site placed in EUREF89 UTM33 (EPSG:25833) and NN2000, an IfcBuilding per wing, its storeys at the
wing's own kote (tools/wings.json levels; a wing without them gets one storey, "Hele bygget"). The outer walls stand
on the building outlines (the roof steps as tools/massing.py found them), split at each storey, 0,35 m thick (assumed:
no drawing gives it); the windows and doors read from the elevations (tools/elevations.py) are cut into them as real
openings. A slab at each storey's kote and a roof at the top of each block. The walls of the drawn floor plans
(floors.json) stand on their storey as interior walls, and their room stamps are spaces with code and name, as
volumes where tools/roompoly.py found the room's outline. Every
element says where it came from and how sure it is (Pset Sykehustomta_Kilde). The ids (GlobalId) are the same each
time the same data is exported, so a new export can be compared with the last one element by element.

For schedules and takeoffs, in the standard places: each element's quantities (Qto_*BaseQuantities: a wall's length,
thickness, side area and volume less its openings; a slab's area and volume; a room's net floor area, the stamp's
figure where there is one), its Pset_*Common (outside or in, Status EXISTING), its NS 3451 part (bygningsdelstabellen:
23 yttervegger, 24 innervegger, 25 dekker, 26 yttertak, 222 søyler, 234 vinduer og dører) and its material where the
wing's construction gives one (site.json wings[].materials, assumed, and said so in Pset Sykehustomta_Materiale).

Only the high block (Sentralblokka, ENVELOPE) is drawn as a model (U3637, Morten 2026-10-26: the rest is to be torn down): its
storeys, outer walls, slabs, roof and, where no facade drawing gives windows, the window bays the page paints (public/bays.js,
a rule, not measured), one IfcWindowType a size, the materials from public/renderkit/materials.js (node reads both). Every
other wing is an IfcBuilding with one simple block (IfcBuildingElementProxy, Status DEMOLISH, its volume) per roof level.

The worker on the server can import build() and run it on the agent's edits; it needs IfcOpenShell only."""
import sys, json, math, uuid, subprocess, os
from collections import Counter
import ifcopenshell, ifcopenshell.guid
import ifcopenshell.api.root, ifcopenshell.api.unit, ifcopenshell.api.context, ifcopenshell.api.aggregate
import ifcopenshell.api.spatial, ifcopenshell.api.pset, ifcopenshell.api.feature, ifcopenshell.api.classification, ifcopenshell.api.material, ifcopenshell.api.type

T_WALL, T_SLAB = 0.35, 0.30
# the building parts as NS 3451:2022 names them (two digits where the drawings cannot say bearing or not)
NS3451 = {"222": "Søyler", "23": "Yttervegger", "234": "Vinduer, dører, porter", "24": "Innervegger", "25": "Dekker", "26": "Yttertak"}
MAT_KEY = {"Betong": "concrete"}   # site.json's word for a wing's material -> the key of public/renderkit/materials.js
# the one building drawn as a model (U3637): the high block. The rest are simple blocks, marked to be demolished (the regulation)
ENVELOPE = {"sentralblokka"}
HERE = os.path.dirname(os.path.abspath(__file__))

def from_js(code, data=None):
    """what the page's own modules say (one copy): a node snippet run in the repo, its JSON read back"""
    root = os.path.join(HERE, "..", "public")
    out = subprocess.run(["node", "--input-type=module", "-e", code.replace("ROOT", "file://" + os.path.abspath(root))], input=json.dumps(data), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)

def js_materials(keys):   # IfcMaterial's name, description and category for each key (renderkit/materials.js ifcMaterial)
    return from_js('import { ifcMaterial } from "ROOT/renderkit/materials.js"; const k = JSON.parse(await new Response(process.stdin).text()); console.log(JSON.stringify(Object.fromEntries(k.map(x => [x, ifcMaterial(x)]))));', keys)

def js_bays(walls):   # each wall [x0, y0, x1, y1]: the bay's windows ([u0, u1] from the wall's start) along it, and the bay rule (public/bays.js)
    return from_js('import { windowsOn, WINDOWS, STOREY } from "ROOT/bays.js"; const w = JSON.parse(await new Response(process.stdin).text()); '
                   'const W = WINDOWS.tower, x0 = Math.min(...W.map(g => g[0])) - 0.06; '
                   'console.log(JSON.stringify({ storey: STOREY, windows: W, spans: w.map(q => windowsOn("tower", q).map(([t0]) => Math.round((t0 - x0) * 100) / 100)) }));', walls)
REGULATED = "Områderegulering for Bragernes sentrum vest, vedtatt 17.02.2026: sykehusbygningene er satt av til riving; interiør og rivemasser bes gjenbrukt"

def area(p):   # a plan polygon's area (m2)
    return abs(sum(p[i - 1][0] * p[i][1] - p[i][0] * p[i - 1][1] for i in range(len(p)))) / 2

def perimeter(p):
    return sum(math.dist(p[i - 1], p[i]) for i in range(len(p)))

def inside(p, ring):
    o = False
    for i in range(len(ring)):
        (a, b), (e, f) = ring[i], ring[i - 1]
        if (b > p[1]) != (f > p[1]) and p[0] < (e - a) * (p[1] - b) / (f - b) + a: o = not o
    return o

def build(site, floors, only=None):
    m = ifcopenshell.file(schema="IFC4")
    new = lambda cls, **kw: ifcopenshell.api.root.create_entity(m, ifc_class=cls, **kw)
    project = new("IfcProject", name=site.get("name", "Sykehustomta"))
    ifcopenshell.api.unit.assign_unit(m, length={"is_metric": True, "raw": "METERS"})
    model = ifcopenshell.api.context.add_context(m, context_type="Model")
    body = ifcopenshell.api.context.add_context(m, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=model)
    # georeference: site metres are EPSG:25833 less the origin, heights NN2000
    OX, OY = site["origin"]
    crs = m.create_entity("IfcProjectedCRS", Name="EPSG:25833", Description="EUREF89 / UTM sone 33N", GeodeticDatum="EUREF89", VerticalDatum="NN2000")
    m.create_entity("IfcMapConversion", SourceCRS=model, TargetCRS=crs, Eastings=float(OX), Northings=float(OY), OrthogonalHeight=0.0)

    P3 = lambda x, y, z: m.create_entity("IfcCartesianPoint", Coordinates=(float(x), float(y), float(z)))
    def place(z=0.0):
        return m.create_entity("IfcLocalPlacement", RelativePlacement=m.create_entity("IfcAxis2Placement3D", Location=P3(0, 0, z)))
    def prism(pts, z0, h):
        """a vertical prism: the plan polygon pts from z0 up h, as the element's body"""
        ring = [m.create_entity("IfcCartesianPoint", Coordinates=(float(x), float(y))) for x, y in pts]
        prof = m.create_entity("IfcArbitraryClosedProfileDef", ProfileType="AREA", OuterCurve=m.create_entity("IfcPolyline", Points=ring + [ring[0]]))
        solid = m.create_entity("IfcExtrudedAreaSolid", SweptArea=prof, Position=m.create_entity("IfcAxis2Placement3D", Location=P3(0, 0, z0)),
                                ExtrudedDirection=m.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)), Depth=float(h))
        return m.create_entity("IfcProductDefinitionShape", Representations=[m.create_entity("IfcShapeRepresentation", ContextOfItems=body,
                               RepresentationIdentifier="Body", RepresentationType="SweptSolid", Items=[solid])])
    def element(cls, name, pts, z0, h, src, how, **kw):
        e = new(cls, name=name, **kw); e.ObjectPlacement = place(); e.Representation = prism(pts, z0, h)
        pset(e, "Sykehustomta_Kilde", {"Kilde": src, "Hvordan": how})
        return e
    # property sets with the same values are one set shared by all their elements (thousands of walls say the same),
    # gathered here and written at the end
    shared = {}
    def pset(e, name, props):
        shared.setdefault((name, json.dumps(props, ensure_ascii=False, sort_keys=True)), (name, props, []))[2].append(e)
    def write_psets():
        for name, props, es in shared.values():
            ps = ifcopenshell.api.pset.add_pset(m, product=es[0], name=name); ifcopenshell.api.pset.edit_pset(m, pset=ps, properties=props)
            if len(es) > 1: ifcopenshell.api.pset.assign_pset(m, products=es[1:], pset=ps)
    def qto(e, name, props):   # the standard quantities (Qto_*), so a BIM tool's schedules and takeoffs find them
        ifcopenshell.api.pset.edit_qto(m, qto=ifcopenshell.api.pset.add_qto(m, product=e, name=name), properties={k: round(float(v), 3) for k, v in props.items()})
    # what the element is, in NS 3451 (bygningsdelstabellen) and of what, gathered and tied on at the end
    classed, made, types = {}, {}, {}
    def ns(e, code): classed.setdefault(code, []).append(e)
    def of(e, mat, how):   # mat: a key of renderkit/materials.js (or site.json's word for one)
        mat = MAT_KEY.get(mat, mat)
        if mat in ("concrete", "glass"): made.setdefault(mat, []).append(e); pset(e, "Sykehustomta_Materiale", {"Materiale": mat, "Hvordan": how})

    ifc_site = new("IfcSite", name=site.get("address", "Tomta")); ifc_site.ObjectPlacement = place()
    ifcopenshell.api.aggregate.assign_object(m, products=[ifc_site], relating_object=project)
    pieces = {}
    for b in site["buildings"]:
        if b.get("wing"): pieces.setdefault(b["wing"], []).append(b)
    wings = [w for w in site["wings"] if w["id"] in pieces and (not only or w["id"] in only)]
    counts = {"wall": 0, "slab": 0, "opening": 0, "window": 0, "block": 0, "inner": 0, "space": 0}
    storeys_of, rings_of = {}, {}

    for w in wings:
        bs = pieces[w["id"]]; base = min(b["base"] for b in bs)
        bld = new("IfcBuilding", name=w["name"]); bld.ObjectPlacement = place()
        ifcopenshell.api.aggregate.assign_object(m, products=[bld], relating_object=ifc_site)
        ifcopenshell.api.pset.edit_pset(m, pset=ifcopenshell.api.pset.add_pset(m, product=bld, name="Sykehustomta_Fløy"), properties={
            k: str(v) for k, v in {"Id": w["id"], "Byggeår": w.get("built"), "Etasjer": w.get("storeys"), "Konstruksjon": w.get("construction"),
                                   "Fasade": w.get("facade"), "Sikker": w.get("sure"), "Regulering": REGULATED}.items() if v is not None})
        if w.get("built"): pset(bld, "Pset_BuildingCommon", {"YearOfConstruction": str(w["built"])})
        if w["id"] not in ENVELOPE:   # not drawn: one simple block per roof level, to be demolished (the regulation), nothing inside
            s = new("IfcBuildingStorey", name="Hele bygget"); s.Elevation = float(base); s.ObjectPlacement = place(base)
            ifcopenshell.api.aggregate.assign_object(m, products=[s], relating_object=bld)
            blocks_ = []
            for b in bs:
                for k in b.get("blocks") or [{"p": b["ring"], "top": b["top"]}]:
                    p = k["p"][:-1] if k["p"][0] == k["p"][-1] else k["p"]
                    e = element("IfcBuildingElementProxy", "Blokk (skal rives)", p, b["base"], k["top"] - b["base"], b.get("source", ""), "omriss og tak fra laser; enkel blokk", predefined_type="NOTDEFINED")
                    e.ObjectType = "TO BE DEMOLISHED"; blocks_.append(e)
                    A = area(p); V = A * (k["top"] - b["base"])
                    pset(e, "Pset_BuildingElementProxyCommon", {"IsExternal": True, "Status": "DEMOLISH"})
                    qto(e, "Qto_BuildingElementProxyQuantities", {"GrossSurfaceArea": A, "NetVolume": V, "GrossVolume": V}); counts["block"] += 1
            ifcopenshell.api.spatial.assign_container(m, products=blocks_, relating_structure=s)
            continue
        mats = w.get("materials") or {}; mhow = mats.get("how", "antatt")
        levels = sorted(w.get("levels") or [{"name": "Hele bygget", "kote": base, "how": "antatt", "src": "ingen etasjer kjent; ett nivå ved foten"}], key=lambda l: l["kote"])
        storeys = []
        for l in levels:
            s = new("IfcBuildingStorey", name=l["name"]); s.Elevation = float(l["kote"]); s.ObjectPlacement = place(l["kote"])
            pset(s, "Sykehustomta_Kilde", {"Kilde": l.get("src", ""), "Hvordan": l.get("how", "")})
            storeys.append((l, s))
        ifcopenshell.api.aggregate.assign_object(m, products=[s for _, s in storeys], relating_object=bld)
        storeys_of[w["id"]] = storeys; rings_of[w["id"]] = [b["ring"] for b in bs]
        def storey_at(z):   # the storey a thing from z up stands on
            best = storeys[0][1]
            for l, s in storeys:
                if l["kote"] <= z + 0.05: best = s
            return best
        contained = {}
        put = lambda z, e: contained.setdefault(storey_at(z), []).append(e)
        cuts = [l["kote"] for l in levels]

        walls, cut, by_wall = [], {}, {}   # (wall element, a, d, n, length, lo, hi) for the openings; the side area they cut from each
        for b in bs:
            blocks = [k["p"] for k in b.get("blocks", [])] or [b["ring"]]
            src = b.get("source", "")
            for wi, (x0, y0, x1, y1, lo, hi) in enumerate(b.get("walls", [])):
                lo = b.get("lift", b["base"]) if lo is None else lo
                L = math.hypot(x1 - x0, y1 - y0)
                if L < 0.3 or hi - lo < 0.2: continue
                d = ((x1 - x0) / L, (y1 - y0) / L); n = (-d[1], d[0])
                mid = ((x0 + x1) / 2 + n[0] * 0.5, (y0 + y1) / 2 + n[1] * 0.5)
                if not any(inside(mid, r) for r in blocks): n = (-n[0], -n[1])   # n points in, the wall stands inside the outline
                quad = [(x0, y0), (x1, y1), (x1 + n[0] * T_WALL, y1 + n[1] * T_WALL), (x0 + n[0] * T_WALL, y0 + n[1] * T_WALL)]
                edges = [lo] + [c for c in cuts if lo + 0.3 < c < hi - 0.3] + [hi]
                for z0, z1 in zip(edges, edges[1:]):
                    e = element("IfcWall", "Yttervegg", quad, z0, z1 - z0, src, "omriss og tak fra laser; tykkelse antatt", predefined_type="SOLIDWALL")
                    put(z0, e); walls.append((e, (x0, y0), d, n, L, z0, z1)); by_wall.setdefault((b["id"], wi), []).append(walls[-1]); counts["wall"] += 1
                    pset(e, "Pset_WallCommon", {"IsExternal": True, "Status": "EXISTING"}); ns(e, "23"); of(e, mats.get("walls"), mhow)
            for p in blocks:
                top = next((k["top"] for k in b.get("blocks", []) if k["p"] is p), b["top"])
                A, per = area(p), perimeter(p)
                def slab(name, z, src_, how_, kind, storey=None):
                    e = element("IfcSlab", name, p, z, T_SLAB, src_, how_, predefined_type=kind)
                    contained.setdefault(storey, []).append(e) if storey is not None else put(z, e); counts["slab"] += 1
                    pset(e, "Pset_SlabCommon", {"IsExternal": kind == "ROOF", "Status": "EXISTING"})
                    qto(e, "Qto_SlabBaseQuantities", {"Depth": T_SLAB, "Perimeter": per, "GrossArea": A, "GrossVolume": A * T_SLAB})
                    ns(e, "26" if kind == "ROOF" else "25"); of(e, mats.get("slabs"), mhow)
                for l, s in storeys:
                    if b["base"] + 0.3 < l["kote"] < top - 0.3: slab(f'Dekke {l["name"]}', l["kote"] - T_SLAB, l.get("src", ""), l.get("how", ""), "FLOOR", s)
                slab("Tak", top - T_SLAB, "laser (tak)", "målt", "ROOF")
            for x, y, size in b.get("posts", []):
                h2, hc = size / 2, b["lift"] - b["base"] + 0.2
                e = element("IfcColumn", "Søyle", [(x - h2, y - h2), (x + h2, y - h2), (x + h2, y + h2), (x - h2, y + h2)], b["base"] - 0.2, hc, src, "fra fasadetegning")
                put(b["base"], e); pset(e, "Pset_ColumnCommon", {"IsExternal": True, "LoadBearing": True, "Status": "EXISTING"})
                qto(e, "Qto_ColumnBaseQuantities", {"Length": hc, "CrossSectionArea": size * size, "GrossVolume": size * size * hc})
                ns(e, "222"); of(e, mats.get("columns"), mhow)

        # openings: each window or door of a drawn facade, cut into the outer walls it stands in
        # the high block has no facade drawing with its windows: its windows are the bays the page paints (public/bays.js), a row a
        # storey of the bay rule, each cut into the wall it stands on, as the drawn ones are
        by_bay = []
        if w["id"] in ENVELOPE:
            keys = [(b["id"], wi, (x0, y0, x1, y1), b.get("lift", b["base"]) if lo is None else lo, hi, b["base"]) for b in bs for wi, (x0, y0, x1, y1, lo, hi) in enumerate(b.get("walls", []))]
            bay = js_bays([list(k[2]) for k in keys])
            for k, spans in zip(keys, bay["spans"]):
                ops = []
                for s0 in spans:
                    for r in range(int((k[4] - k[5]) // bay["storey"]) + 1):
                        top = k[5] + (r + 1) * bay["storey"]
                        for l, t, rt, bt in bay["windows"]:
                            z0, z1 = top - bt, top - t
                            if z0 >= k[3] and z1 <= k[4] - 0.3: ops.append({"kind": "window", "u": [round(s0 + l, 3), round(s0 + rt, 3)], "z": [round(z0, 3), round(z1, 3)]})
                if ops: by_bay.append({"building": w["id"], "from": k[2][:2], "to": k[2][2:], "openings": ops, "src": ["fasaderegelen (public/bays.js): vinduene i hver bukt"], "how": "regel, ikke målt", "wall": (k[0], k[1])})
        for f in [f for f in site.get("facades", []) if f["building"] == w["id"]] + by_bay:
            (fx, fy), (tx, ty) = f["from"], f["to"]; FL = math.hypot(tx - fx, ty - fy); fd = ((tx - fx) / FL, (ty - fy) / FL)
            mine = by_wall.get(f["wall"], []) if "wall" in f else [wl for wl in walls if abs(wl[2][0] * fd[0] + wl[2][1] * fd[1]) > 0.98 and abs((fx - wl[1][0]) * wl[3][0] + (fy - wl[1][1]) * wl[3][1]) < 1.6]
            for o in f["openings"]:
                (u0, u1), (z0, z1) = o["u"], o["z"]
                pa, pb = (fx + fd[0] * u0, fy + fd[1] * u0), (fx + fd[0] * u1, fy + fd[1] * u1)
                filled = False
                for e, a, d, n, L, lo, hi in mine:
                    t0, t1 = sorted(((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) for p in (pa, pb))
                    if t1 <= 0.05 or t0 >= L - 0.05 or z1 <= lo + 0.01 or z0 >= hi - 0.01: continue
                    t0, t1 = max(t0, 0.0), min(t1, L)   # a window over a joint in the outline cuts both pieces
                    q = lambda t, s: (a[0] + d[0] * t + n[0] * s, a[1] + d[1] * t + n[1] * s)
                    zz0, zz1 = max(z0, lo), min(z1, hi)
                    hole = element("IfcOpeningElement", "Åpning", [q(t0, -0.1), q(t1, -0.1), q(t1, T_WALL + 0.1), q(t0, T_WALL + 0.1)], zz0, zz1 - zz0,
                                   "; ".join(f["src"]), f.get("how", "fra fasadetegning"))
                    ifcopenshell.api.feature.add_feature(m, feature=hole, element=e); counts["opening"] += 1
                    cut[e] = cut.get(e, 0.0) + (t1 - t0) * (zz1 - zz0)
                    if not filled:   # the window itself once, in its full height, in the wall's middle
                        cls, name = {"door": ("IfcDoor", "Dør"), "glazing": ("IfcWindow", "Glassfelt")}.get(o["kind"], ("IfcWindow", "Vindu"))
                        c = T_WALL / 2
                        fill = element(cls, name, [q(t0, c - 0.04), q(t1, c - 0.04), q(t1, c + 0.04), q(t0, c + 0.04)], z0, z1 - z0, "; ".join(f["src"]), f.get("how", "fra fasadetegning"))
                        fill.OverallWidth, fill.OverallHeight = float(u1 - u0), float(z1 - z0)
                        ifcopenshell.api.feature.add_filling(m, opening=hole, element=fill); put(z0, fill); filled = True
                        pset(fill, f"Pset_{cls[3:]}Common", {"IsExternal": True, "Status": "EXISTING"}); ns(fill, "234")
                        if cls == "IfcWindow": of(fill, "glass", f.get("how", "fra fasadetegning")); counts["window"] += 1
                        types.setdefault((cls, round(u1 - u0, 2), round(z1 - z0, 2)), []).append(fill)
                        qto(fill, f"Qto_{cls[3:]}BaseQuantities", {"Width": u1 - u0, "Height": z1 - z0, "Area": (u1 - u0) * (z1 - z0)})
                if not filled: counts.setdefault("unplaced", []).append(f'{f["id"]} u {u0:.1f}-{u1:.1f} z {z0:.1f}-{z1:.1f}')
        # the outer walls' quantities, less what the openings take
        for e, a, d, n, L, lo, hi in walls:
            side = L * (hi - lo); net = side - cut.get(e, 0.0)
            qto(e, "Qto_WallBaseQuantities", {"Length": L, "Width": T_WALL, "Height": hi - lo, "GrossSideArea": side, "NetSideArea": net,
                                              "GrossVolume": side * T_WALL, "NetVolume": net * T_WALL})
        for s, es in contained.items(): ifcopenshell.api.spatial.assign_container(m, products=es, relating_structure=s)

    # the drawn floor plans: their walls and rooms on the storey of the wing they stand in
    def wing_at(p):
        for wid, rings in rings_of.items():
            if any(inside(p, r) for r in rings): return wid
    inner, spaces = {}, {}
    for fl in floors.get("floors", []):
        src = fl.get("source", "")
        def storey(wid):
            ss = storeys_of[wid]; named = [s for l, s in ss if l["name"] == fl["name"]]
            return named[0] if named else min(ss, key=lambda ls: abs(ls[0]["kote"] - fl["kote"]))[1]
        for r in fl["walls"]:
            c = (sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r)); wid = wing_at(c)
            if not wid: continue
            pts = r[:-1] if r[0] == r[-1] else r
            e = element("IfcWall", "Innervegg", pts, fl["kote"], fl["height"], src, "fra plantegning"); counts["inner"] += 1
            inner.setdefault(storey(wid), []).append(e)
            pset(e, "Pset_WallCommon", {"IsExternal": False, "Status": "EXISTING"}); ns(e, "24")
            A = area(pts); q = {"Height": fl["height"], "GrossFootprintArea": A, "GrossVolume": A * fl["height"]}
            if len(pts) == 4:   # a rectangle, as the traced walls are: its long side and its thickness
                s1, s2 = math.dist(pts[0], pts[1]), math.dist(pts[1], pts[2]); q.update(Length=max(s1, s2), Width=min(s1, s2))
            qto(e, "Qto_WallBaseQuantities", q)
        for rm in fl["rooms"]:
            wid = wing_at(rm["at"])
            if not wid: continue
            # the room number is its name, as the stamp gives it ("SB 12.315"); the room's name is its long name
            sp = new("IfcSpace", name=rm.get("code") or rm["name"]); sp.LongName = rm["name"]
            # its floor area: the architect's figure on the stamp where there is one, else the one measured between the walls
            net = rm.get("area_m2") or rm.get("area_calc")
            if net: qto(sp, "Qto_SpaceBaseQuantities", {"NetFloorArea": net, "Height": fl["height"], "NetVolume": net * fl["height"]})
            pset(sp, "Pset_SpaceCommon", {"IsExternal": False, **({"Reference": rm["code"]} if rm.get("code") else {})})
            if rm.get("poly"):   # its outline between the walls (tools/roompoly.py): the space as a volume
                sp.ObjectPlacement = place(); sp.Representation = prism(rm["poly"][:-1], fl["kote"], fl["height"])
                props = {"Kilde": src, "Hvordan": "romstempel på plantegningen; omriss " + ("delt ut mellom stemplene der veggene ikke lukker rommet, omtrentlig" if rm.get("poly_how") == "delt" else "målt mellom veggene")}
                props["Areal (målt)"] = f'{rm["area_calc"]} m²'
            else:
                sp.ObjectPlacement = m.create_entity("IfcLocalPlacement", RelativePlacement=m.create_entity("IfcAxis2Placement3D", Location=P3(*rm["at"], fl["kote"])))
                props = {"Kilde": src, "Hvordan": "romstempel på plantegningen (plassert ved stempelet, uten omriss)"}
            if rm.get("area_m2"): props["Areal (tegning)"] = f'{rm["area_m2"]} m²'
            pset(sp, "Sykehustomta_Kilde", props)
            spaces.setdefault(storey(wid), []).append(sp); counts["space"] += 1
    for s, es in inner.items(): ifcopenshell.api.spatial.assign_container(m, products=es, relating_structure=s)
    for s, es in spaces.items(): ifcopenshell.api.aggregate.assign_object(m, products=es, relating_object=s)
    write_psets()
    cls = ifcopenshell.api.classification.add_classification(m, classification="NS 3451")
    cls.Source, cls.Edition, cls.Name, cls.Description = "Standard Norge", "2022", "NS 3451", "Bygningsdelstabell"
    for code in sorted(classed):
        ifcopenshell.api.classification.add_reference(m, products=classed[code], identification=code, name=NS3451[code], classification=cls)
    for (cls, wd, ht), es in sorted(types.items()):   # one type a size, the windows and doors its occurrences (the same shape again, not copied)
        t = new(cls + "Type", name=f'{"Vindu" if cls == "IfcWindow" else "Dør"} {wd:.2f} × {ht:.2f} m'.replace(".", ",")); t.PredefinedType = "NOTDEFINED"
        ifcopenshell.api.type.assign_type(m, related_objects=es, relating_type=t)
    mats_js = js_materials(sorted(made)) if made else {}
    for key in sorted(made):
        im = mats_js[key]; mat = ifcopenshell.api.material.add_material(m, name=im["name"], category=im["category"]); mat.Description = im["description"]
        ifcopenshell.api.material.assign_material(m, products=made[key], material=mat)
    stable_ids(m)
    return m, counts


NS = uuid.UUID("5b1f6c2e-8d0a-4c55-9a43-1f2d7e0c9b11")   # Sykehustomta's own namespace for GlobalIds; never change it


def stable_ids(m):
    """GlobalIds from what an element is, not from chance: its class, the chain of what contains it and its name, and
    its place among its namesakes there; relationships and property sets from the ids they tie together."""
    def parent(e):
        for r in getattr(e, "ContainedInStructure", None) or []: return r.RelatingStructure
        for r in getattr(e, "Decomposes", None) or []: return r.RelatingObject
        for r in getattr(e, "VoidsElements", None) or []: return r.RelatingBuildingElement
        for r in getattr(e, "FillsVoids", None) or []: return r.RelatingOpeningElement
        return None
    def path(e, depth=0):
        p = parent(e)
        return f"{path(p, depth + 1) if p is not None and depth < 8 else ''}/{e.is_a()}:{e.Name or ''}"
    seen = Counter()
    gid = lambda key: ifcopenshell.guid.compress(uuid.uuid5(NS, key).hex)
    for e in m.by_type("IfcObjectDefinition"):   # by_type keeps creation order, which follows the data's order
        key = path(e); seen[key] += 1; e.GlobalId = gid(f"{key}#{seen[key]}")
    for e in m.by_type("IfcRelationship"):
        ids = [x.GlobalId for a in e for x in (a if isinstance(a, tuple) else [a]) if isinstance(x, ifcopenshell.entity_instance) and x.is_a("IfcRoot")]
        key = e.is_a() + ":" + ",".join(sorted(ids)); seen[key] += 1; e.GlobalId = gid(f"{key}#{seen[key]}")
    for e in m.by_type("IfcPropertySetDefinition"):
        owners = sorted(o.GlobalId for r in getattr(e, "DefinesOccurrence", None) or [] for o in r.RelatedObjects)
        key = f"{e.Name}:{','.join(owners)}"; seen[key] += 1; e.GlobalId = gid(f"{key}#{seen[key]}")
    for e in m.by_type("IfcRelDefinesByProperties"):   # again, now that the sets have theirs
        key = "pset:" + e.RelatingPropertyDefinition.GlobalId; e.GlobalId = gid(key)

if __name__ == "__main__":
    site_f, floors_f, out = sys.argv[1:4]
    m, counts = build(json.load(open(site_f)), json.load(open(floors_f)), sys.argv[4:] or None)
    m.write(out)
    lost = counts.pop("unplaced", [])
    print(", ".join(f"{v} {k}" for k, v in counts.items()), f"-> {out}")
    if lost: print(f"{len(lost)} openings found no wall:", "; ".join(lost))
