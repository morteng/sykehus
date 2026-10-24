"""The buildings as IFC4 (BIM): what the viewer shows, written as walls, slabs, windows and doors on storeys, so FreeCAD
(BIM), Solibri, Revit or any IFC tool can open it. Our data stays the truth; this is an export of it.

  python -I tools/ifc.py <site.json> <floors.json> <out.ifc> [wing id ...]

In the file: a site placed in EUREF89 UTM33 (EPSG:25833) and NN2000, an IfcBuilding per wing, its storeys at the
wing's own kote (tools/wings.json levels; a wing without them gets one storey, "Hele bygget"). The outer walls stand
on the building outlines (the roof steps as tools/massing.py found them), split at each storey, 0,35 m thick (assumed:
no drawing gives it); the windows and doors read from the elevations (tools/elevations.py) are cut into them as real
openings. A slab at each storey's kote and a roof at the top of each block. The walls of the drawn floor plans
(floors.json) stand on their storey as interior walls, and their room stamps are spaces with code and name. Every
element says where it came from and how sure it is (Pset Sykehustomta_Kilde).

The worker on the server can import build() and run it on the agent's edits; it needs IfcOpenShell only."""
import sys, json, math
import ifcopenshell
import ifcopenshell.api.root, ifcopenshell.api.unit, ifcopenshell.api.context, ifcopenshell.api.aggregate
import ifcopenshell.api.spatial, ifcopenshell.api.pset, ifcopenshell.api.feature

T_WALL, T_SLAB = 0.35, 0.30

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
        ifcopenshell.api.pset.edit_pset(m, pset=ifcopenshell.api.pset.add_pset(m, product=e, name="Sykehustomta_Kilde"), properties={"Kilde": src, "Hvordan": how})
        return e

    ifc_site = new("IfcSite", name=site.get("address", "Tomta")); ifc_site.ObjectPlacement = place()
    ifcopenshell.api.aggregate.assign_object(m, products=[ifc_site], relating_object=project)
    pieces = {}
    for b in site["buildings"]:
        if b.get("wing"): pieces.setdefault(b["wing"], []).append(b)
    wings = [w for w in site["wings"] if w["id"] in pieces and (not only or w["id"] in only)]
    counts = {"wall": 0, "slab": 0, "opening": 0, "inner": 0, "space": 0}
    storeys_of, rings_of = {}, {}

    for w in wings:
        bs = pieces[w["id"]]; base = min(b["base"] for b in bs)
        bld = new("IfcBuilding", name=w["name"]); bld.ObjectPlacement = place()
        ifcopenshell.api.aggregate.assign_object(m, products=[bld], relating_object=ifc_site)
        ifcopenshell.api.pset.edit_pset(m, pset=ifcopenshell.api.pset.add_pset(m, product=bld, name="Sykehustomta_Fløy"), properties={
            k: str(v) for k, v in {"Id": w["id"], "Byggeår": w.get("built"), "Etasjer": w.get("storeys"), "Konstruksjon": w.get("construction"),
                                   "Fasade": w.get("facade"), "Sikker": w.get("sure")}.items() if v is not None})
        levels = sorted(w.get("levels") or [{"name": "Hele bygget", "kote": base, "how": "antatt", "src": "ingen etasjer kjent; ett nivå ved foten"}], key=lambda l: l["kote"])
        storeys = []
        for l in levels:
            s = new("IfcBuildingStorey", name=l["name"]); s.Elevation = float(l["kote"]); s.ObjectPlacement = place(l["kote"])
            ifcopenshell.api.pset.edit_pset(m, pset=ifcopenshell.api.pset.add_pset(m, product=s, name="Sykehustomta_Kilde"), properties={"Kilde": l.get("src", ""), "Hvordan": l.get("how", "")})
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

        walls = []   # (wall element, a, d, n, length, lo, hi) for the openings
        for b in bs:
            blocks = [k["p"] for k in b.get("blocks", [])] or [b["ring"]]
            src = b.get("source", "")
            for x0, y0, x1, y1, lo, hi in b.get("walls", []):
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
                    put(z0, e); walls.append((e, (x0, y0), d, n, L, z0, z1)); counts["wall"] += 1
            for p in blocks:
                top = next((k["top"] for k in b.get("blocks", []) if k["p"] is p), b["top"])
                for l, s in storeys:
                    if b["base"] + 0.3 < l["kote"] < top - 0.3:
                        contained.setdefault(s, []).append(element("IfcSlab", f'Dekke {l["name"]}', p, l["kote"] - T_SLAB, T_SLAB, l.get("src", ""), l.get("how", ""), predefined_type="FLOOR")); counts["slab"] += 1
                put(top - T_SLAB, element("IfcSlab", "Tak", p, top - T_SLAB, T_SLAB, "laser (tak)", "målt", predefined_type="ROOF")); counts["slab"] += 1
            for x, y, size in b.get("posts", []):
                h2 = size / 2
                put(b["base"], element("IfcColumn", "Søyle", [(x - h2, y - h2), (x + h2, y - h2), (x + h2, y + h2), (x - h2, y + h2)], b["base"] - 0.2, b["lift"] - b["base"] + 0.2, src, "fra fasadetegning"))

        # openings: each window or door of a drawn facade, cut into the outer walls it stands in
        for f in site.get("facades", []):
            if f["building"] != w["id"]: continue
            (fx, fy), (tx, ty) = f["from"], f["to"]; FL = math.hypot(tx - fx, ty - fy); fd = ((tx - fx) / FL, (ty - fy) / FL)
            mine = [wl for wl in walls if abs(wl[2][0] * fd[0] + wl[2][1] * fd[1]) > 0.98 and abs((fx - wl[1][0]) * wl[3][0] + (fy - wl[1][1]) * wl[3][1]) < 1.6]
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
                                   "; ".join(f["src"]), "fra fasadetegning")
                    ifcopenshell.api.feature.add_feature(m, feature=hole, element=e); counts["opening"] += 1
                    if not filled:   # the window itself once, in its full height, in the wall's middle
                        cls, name = {"door": ("IfcDoor", "Dør"), "glazing": ("IfcWindow", "Glassfelt")}.get(o["kind"], ("IfcWindow", "Vindu"))
                        c = T_WALL / 2
                        fill = element(cls, name, [q(t0, c - 0.04), q(t1, c - 0.04), q(t1, c + 0.04), q(t0, c + 0.04)], z0, z1 - z0, "; ".join(f["src"]), "fra fasadetegning")
                        fill.OverallWidth, fill.OverallHeight = float(u1 - u0), float(z1 - z0)
                        ifcopenshell.api.feature.add_filling(m, opening=hole, element=fill); put(z0, fill); filled = True
                if not filled: counts.setdefault("unplaced", []).append(f'{f["id"]} u {u0:.1f}-{u1:.1f} z {z0:.1f}-{z1:.1f}')
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
            inner.setdefault(storey(wid), []).append(element("IfcWall", "Innervegg", pts, fl["kote"], fl["height"], src, "fra plantegning")); counts["inner"] += 1
        for rm in fl["rooms"]:
            wid = wing_at(rm["at"])
            if not wid: continue
            sp = new("IfcSpace", name=rm.get("code") or rm["name"]); sp.LongName = rm["name"]
            sp.ObjectPlacement = m.create_entity("IfcLocalPlacement", RelativePlacement=m.create_entity("IfcAxis2Placement3D", Location=P3(*rm["at"], fl["kote"])))
            props = {"Kilde": src, "Hvordan": "romstempel på plantegningen (plassert ved stempelet, uten omriss)"}
            if rm.get("area_m2"): props["Areal (tegning)"] = f'{rm["area_m2"]} m²'
            ifcopenshell.api.pset.edit_pset(m, pset=ifcopenshell.api.pset.add_pset(m, product=sp, name="Sykehustomta_Kilde"), properties=props)
            spaces.setdefault(storey(wid), []).append(sp); counts["space"] += 1
    for s, es in inner.items(): ifcopenshell.api.spatial.assign_container(m, products=es, relating_structure=s)
    for s, es in spaces.items(): ifcopenshell.api.aggregate.assign_object(m, products=es, relating_object=s)
    return m, counts

if __name__ == "__main__":
    site_f, floors_f, out = sys.argv[1:4]
    m, counts = build(json.load(open(site_f)), json.load(open(floors_f)), sys.argv[4:] or None)
    m.write(out)
    lost = counts.pop("unplaced", [])
    print(", ".join(f"{v} {k}" for k, v in counts.items()), f"-> {out}")
    if lost: print(f"{len(lost)} openings found no wall:", "; ".join(lost))
