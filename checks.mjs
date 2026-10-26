/* U3678 slice 1: the building rules (rules/tek17.json) held against what a proposal has: pure, no network. check(site, opts)
   reads site.added (the applied edits: parts, the step-free entrance of a volume, balconies) and answers one row per rule
   and thing: { rule, section, thing, status, ok, value, limit, said, verify? }.
   status: "ok", "brudd", or "ikke målt": a number the model does not hold is never ok (ok is null then).
   The numbers live in the JSON, the arithmetic here; a rule's `verify` is passed on so Anton does not call it law. */
import { readFileSync } from "node:fs";
import { groundAt } from "./public/renderkit/fit.js";

export const RULES = JSON.parse(readFileSync(new URL("./rules/tek17.json", import.meta.url), "utf8")).rules;
const byId = Object.fromEntries(RULES.map(r => [r.id, r]));
const m = x => String(Math.round(x * 100) / 100).replace(".", ","), mm = x => `${Math.round(x * 1000)} mm`;
const num = x => typeof x === "number" && Number.isFinite(x);

/* the fall by a thing that stands at foot kote: the foot minus the lowest terrain `off` m to either side of its from -> to line */
function fallOf(site, a, foot, off) {
  if (!num(foot) || !site.terrain?.z || !Array.isArray(a.from) || !Array.isArray(a.to)) return null;
  const d = [a.to[0] - a.from[0], a.to[1] - a.from[1]], L = Math.hypot(...d); if (!L) return null;
  const n = [-d[1] / L, d[0] / L], c = [(a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2];
  const zs = [-off, off].map(t => groundAt(site, [c[0] + n[0] * t, c[1] + n[1] * t]));
  return Math.round((foot - Math.min(...zs)) * 100) / 100;
}
/* the stair rule of the worker (parts/stair.py): risers = ceil(height / max_riser), the tread 25-32 cm round 63 cm */
function stairOf(p, printed) {
  if (printed && num(printed.riser_m) && num(printed.tread_m)) return { riser: printed.riser_m, tread: printed.tread_m, from: "delens eget mål" };
  if (!num(p.height) || !num(p.max_riser)) return null;
  const n = Math.max(2, Math.ceil(p.height / p.max_riser - 1e-9)), riser = p.height / n;
  return { riser, tread: Math.min(0.32, Math.max(0.25, 0.63 - 2 * riser)), from: "regnet fra innstillingene med delens trapperegel" };
}

export function check(site, { ids = null, printed = {} } = {}) {
  const out = [];
  for (const a of site?.added || []) {
    if (ids && !ids.has(a.id)) continue;
    const thing = { id: a.id, name: a.name, ...(a.bim?.part ? { part: a.bim.part } : {}) };
    const row = (id, ok, value, limit, said) => { const r = byId[id]; out.push({ rule: id, section: r.section, thing, status: ok == null ? "ikke målt" : ok ? "ok" : "brudd", ok, value, limit, said: ok == null ? `Ikke målt: ${said}` : said, ...(r.verify ? { verify: true } : {}) }); };
    const p = a.bim?.params || {}, part = a.bim?.part;
    if (part === "stair") {
      const s = stairOf(p, printed[a.id]);
      if (!s) { for (const id of ["trapp_stigningsforhold", "trapp_opptrinn"]) row(id, null, null, null, "trappens høyde og trinn står ikke i modellen."); }
      else {
        const k = 2 * s.riser + s.tread, lim = byId.trapp_stigningsforhold.limit, ok = k * 1000 >= lim.min_mm - 0.5 && k * 1000 <= lim.max_mm + 0.5;
        row("trapp_stigningsforhold", ok, Math.round(k * 1000), `${lim.min_mm}–${lim.max_mm} mm`, `2 × ${mm(s.riser)} + ${mm(s.tread)} = ${Math.round(k * 1000)} mm (${s.from}); kravet er ${lim.min_mm}–${lim.max_mm} mm.`);
        const mx = byId.trapp_opptrinn.limit.max_mm; row("trapp_opptrinn", s.riser * 1000 <= mx + 0.5, Math.round(s.riser * 1000), `høyst ${mx} mm`, `Opptrinnet er ${mm(s.riser)}; høyst ${mx} mm.`);
      }
      const mw = byId.trapp_bredde.limit.min_m;
      row("trapp_bredde", num(p.width) ? p.width >= mw : null, p.width ?? null, `minst ${m(mw)} m`, num(p.width) ? `Trappen er ${m(p.width)} m bred; minst ${m(mw)} m.` : "bredden står ikke i modellen.");
      const lim = byId.trapp_handlist.limit.rise_over_m;
      if (!num(p.height) || typeof p.railing !== "boolean") row("trapp_handlist", null, null, null, "høyden eller håndløperen står ikke i modellen.");
      else row("trapp_handlist", p.height <= lim || p.railing, p.railing, `håndløper når trappen stiger over ${m(lim)} m`, p.height <= lim ? `Trappen stiger ${m(p.height)} m: ingen håndløper kreves.` : p.railing ? `Trappen stiger ${m(p.height)} m og har håndløper.` : `Trappen stiger ${m(p.height)} m og har ingen håndløper.`);
    }
    if (part === "railing" || part === "balcony") {
      const id = part === "railing" ? "rekkverk_hoyde" : "balkong_rekkverk_hoyde", L = byId[id].limit, h = part === "railing" ? p.height : p.railing_height;
      const foot = p.ground ?? a.base_kote, fall = fallOf(site, a, foot, part === "railing" ? 1.5 : (p.depth ?? 1.5) + 1);
      if (!num(h)) row(id, null, null, null, "rekkverkshøyden står ikke i modellen.");
      else if (fall == null) row(id, null, h, `minst ${m(L.min_m)} m ved fall over ${m(L.fall_over_m)} m`, `fallet ved rekkverket er ikke kjent (fot eller terreng mangler); høyden er ${m(h)} m.`);
      else {
        const need = part === "railing" && L.min_m_high && fall > L.high_fall_over_m ? L.min_m_high : L.min_m;
        if (fall <= L.fall_over_m) row(id, true, h, `ingen krav ved fall under ${m(L.fall_over_m)} m`, `Fallet er ${m(fall)} m: rekkverk er ikke påkrevd; det står ${m(h)} m høyt.`);
        else row(id, h >= need - 1e-9, h, `minst ${m(need)} m`, `Fallet er ${m(fall)} m; rekkverket er ${m(h)} m høyt, minst ${m(need)} m kreves.`);
      }
    }
    if (part === "balcony") {
      if (p.door === false) { /* no door: nothing to measure, nothing to check */ }
      else {
        for (const [id, key, what] of [["balkong_dorbredde", "door_width", "bred"], ["balkong_dorhoyde", "door_height", "høy"]]) {
          const mn = byId[id].limit.min_m, v = p[key];
          row(id, num(v) ? v >= mn - 1e-9 : null, v ?? null, `minst ${m(mn)} m`, num(v) ? `Døren er ${m(v)} m ${what}; minst ${m(mn)} m.` : "dørmålet står ikke i modellen.");
        }
      }
    }
    if (a.kind === "balconies") row("balkong_rekkverk_balkonger", null, a.railing ?? null, `minst ${m(byId.balkong_rekkverk_balkonger.limit.min_m)} m`, `balkongene har rekkverk av ${a.railing ?? "ukjent"}, men høyden er ikke tegnet.`);
    const en = a.ground?.entrance;
    if (en) {
      const ms = byId.rampe_stigning.limit.max_slope;
      if (!en.ok) { row("rampe_rekker_terrenget", false, null, `rampe 1:20 på høyst ${byId.rampe_rekker_terrenget.limit.ramp_max_m} m`, `Inngangen ligger ${m(en.rise)} m fra terrenget: en rampe 1:20 blir for lang. Trenger heis, en annen inngang eller en annen kote.`); row("rampe_stigning", null, null, null, "ingen rampe finnes å måle."); }
      else {
        row("rampe_rekker_terrenget", true, en.ramp_m, `rampe 1:20 på høyst ${byId.rampe_rekker_terrenget.limit.ramp_max_m} m`, en.ramp_m < 0.5 ? "Terrenget ligger i nivå med gulvet: ingen rampe trengs." : `Rampen er ${m(en.ramp_m)} m lang.`);
        if (en.ramp_m < 0.5) row("rampe_stigning", true, 0, "1:20", "Ingen rampe: inngangen er i nivå.");
        else { const slope = en.rise / en.ramp_m; row("rampe_stigning", slope <= ms + 0.003, `1:${Math.round(1 / slope)}`, "1:20", `Rampen stiger ${m(en.rise)} m over ${m(en.ramp_m)} m, altså 1:${Math.round(1 / slope)}; ikke brattere enn 1:20.`); }
      }
    }
  }
  return out;
}
/* the rows as one sentence a person can be told: how many hold, break and are not measured */
export const summary = rows => ({ ok: rows.filter(r => r.status === "ok").length, brudd: rows.filter(r => r.status === "brudd").length, ikke_målt: rows.filter(r => r.status === "ikke målt").length });
