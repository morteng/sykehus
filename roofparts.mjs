/* U3836: a ready-made part stands on a wing's roof or beside a facade whatever its size settings are called (a railing has a length, a stair a
   height and a width, a balcony a width and a depth, a greenhouse a length and a width or a radius), and a greenhouse larger than the part's
   own size limits (params max, 30 × 100 m) is laid as equal greenhouses side by side, one group. */
import { placeOnRoof, placeBeside } from "./public/design.js";

const num = (v, d) => Number.isFinite(+v) && v !== null && v !== "" ? +v : d;
const RECT = f => !["polygon", "geodesic"].includes(f);

/* the plan footprint { L: along from -> to, W: across } of a part with these settings; spec = the part's params from list_parts */
export function partFoot(part, P = {}, spec = {}) {
  const dv = k => num(P[k], num(spec?.[k]?.default, NaN));
  if (part === "pool_basin") { const o = 2 * (num(dv("wall"), 0.25) + num(dv("coping"), 0.3)); return { L: dv("length") + o, W: dv("width") + o }; }
  if (part === "railing") return { L: dv("length"), W: 0.1 };
  if (part === "balcony") return { L: dv("width"), W: dv("depth") };
  if (part === "stair") {   // the flight's run: risers of at most max_riser, 2 risers + 1 tread = 0.63 m
    const h = dv("height"), n = Math.ceil(h / dv("max_riser") - 1e-9), r = h / n;
    return { L: Math.round(n * Math.max(0.25, 0.63 - 2 * r) * 100) / 100, W: dv("width") };
  }
  if (part === "greenhouse") { const f = P.form ?? spec?.form?.default ?? "polygon"; return RECT(f) ? { L: dv("length"), W: dv("width") } : { L: 2 * dv("radius"), W: 2 * dv("radius") }; }
  return { L: dv("length"), W: dv("width") };
}

/* a greenhouse (a rectangular form) larger than the part's own max for length and width (list_parts) becomes several, side by side along one axis; the rest of the edits stay.
   mk = { site, wingOf, listParts }. A refusal stays in the edit (__bad) so the call names it. */
export async function bigGreenhouses(edits, { site, wingOf, listParts }) {
  const out = [];
  for (const e of edits) {
    if (e?.kind !== "part" || e.part !== "greenhouse") { out.push(e); continue; }
    try {
      const P = e.params || {}, spec = (await listParts().catch(() => ({})))?.greenhouse?.params || {}, form = P.form ?? spec.form?.default ?? "polygon";
      if (!RECT(form)) { out.push(e); continue; }
      const { L, W } = partFoot("greenhouse", P, spec);
      const mxL = num(spec.length?.max, Infinity), mxW = num(spec.width?.max, Infinity);   // the part's own limits; none known = no split
      if (!(L > mxL + 1e-9 || W > mxW + 1e-9)) { out.push(e); continue; }
      const nL = Math.ceil(L / mxL - 1e-9), nW = Math.ceil(W / mxW - 1e-9);
      if (nL * nW > 24) throw new Error(`Et drivhus på ${L} × ${W} m blir ${nL * nW} deler; mer enn 24 går ikke. Del det i to ønsker`);
      let from, to, rest;
      if (e.at != null) {
        const w = wingOf(site, e.at.wing); if (!w) throw new Error(`Fant ikke fløyen «${e.at.wing}»`);
        if (e.from != null || e.to != null) throw new Error("Gi enten at eller from og to, ikke begge");
        const { at, params, ...r } = e;
        const g = at.roof ? placeOnRoof(site, w, at, L, W, Number(e.overhang_m) > 0) : at.side != null && at.gap_m != null ? placeBeside(site, w, at, L, W) : null;
        if (!g) throw new Error("at tar roof: true eller side og gap_m");
        from = g.from; to = g.to; rest = at.roof ? { ...r, on: w.id } : r;
      } else {
        if (e.from == null || e.to == null) throw new Error("part mangler from og to");
        const { params, ...r } = e; from = e.from; to = e.to; rest = r;
        const d = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
        if (Math.abs(d - L) > 0.05) throw new Error(`Drivhuset er ${L} m langt i params.length, men from til to er ${Math.round(d * 100) / 100} m: bruk samme lengde`);
      }
      delete rest.id; delete rest.from; delete rest.to;
      const d = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1, u = [(to[0] - from[0]) / d, (to[1] - from[1]) / d], n = [-u[1], u[0]], mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      const l = L / nL, w = W / nW, name = e.name ?? "Drivhus", group = e.group ?? name, r2 = x => Math.round(x * 100) / 100;
      for (let j = 0; j < nW; j++) for (let i = 0; i < nL; i++) {
        const a = -L / 2 + (i + 0.5) * l, b = W / 2 - (j + 0.5) * w, c = [mid[0] + u[0] * a + n[0] * b, mid[1] + u[1] * a + n[1] * b];
        out.push({ ...rest, name: nL * nW > 1 ? `${name} ${j * nL + i + 1}` : name, group, from: [r2(c[0] - u[0] * l / 2), r2(c[1] - u[1] * l / 2)], to: [r2(c[0] + u[0] * l / 2), r2(c[1] + u[1] * l / 2)],
          params: { ...P, length: r2(l), width: r2(w) }, ...(e.why ? { why: e.why } : {}) });
      }
    } catch (x) { out.push({ kind: "part", part: "greenhouse", __bad: x.message }); }
  }
  return out;
}
