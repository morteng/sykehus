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
    const row = (id, ok, value, limit, said, alt) => { const r = byId[id]; out.push({ rule: id, section: r.section, thing, status: ok == null ? "ikke målt" : ok ? "ok" : "brudd", ok, value, limit, said: ok == null ? `Ikke målt: ${said}` : said, ...(alt ? { alt } : {}), source: r.source.url, ...(r.verify ? { verify: true } : {}) }); };
    const p = a.bim?.params || {}, part = a.bim?.part;
    if (part === "stair") {
      const s = stairOf(p, printed[a.id]);
      if (!s) { for (const id of ["trapp_stigningsforhold", "trapp_inntrinn"]) row(id, null, null, null, "trappens høyde og trinn står ikke i modellen."); }
      else {
        const k = 2 * s.riser + s.tread, lim = byId.trapp_stigningsforhold.limit, ok = k * 1000 >= lim.min_mm - 0.5 && k * 1000 <= lim.max_mm + 0.5;
        row("trapp_stigningsforhold", ok, Math.round(k * 1000), `${lim.min_mm}–${lim.max_mm} mm`, `2 × ${mm(s.riser)} + ${mm(s.tread)} = ${Math.round(k * 1000)} mm (${s.from}); trappeformelen er 620 mm ± 20 (${lim.min_mm}–${lim.max_mm} mm).`);
        const mn = byId.trapp_inntrinn.limit.min_mm; row("trapp_inntrinn", s.tread * 1000 >= mn - 0.5, Math.round(s.tread * 1000), `minst ${mn} mm`, `Inntrinnet er ${mm(s.tread)}; minst ${mn} mm.`);
      }
      const wl = byId.trapp_bredde.limit, mw = wl.min_m, w = p.width;
      row("trapp_bredde", num(w) ? w >= mw - 1e-9 : null, w ?? null, `minst ${m(mw)} m`, num(w) ? `Trappen er ${m(w)} m bred; minst ${m(mw)} m. ${wl.alt.slice(0, 2).map(x => `${x.when}: ${m(x.min_m)} m ${w >= x.min_m - 1e-9 ? "holder" : "holder ikke"}`).join("; ")}.` : "bredden står ikke i modellen.", num(w) ? wl.alt.map(x => ({ when: x.when, limit: `minst ${m(x.min_m)} m`, ok: w >= x.min_m - 1e-9 })) : undefined);
      row("trapp_handlist", typeof p.railing === "boolean" ? p.railing : null, p.railing ?? null, "håndløper på begge sider", typeof p.railing === "boolean" ? (p.railing ? "Trappen har håndløper på begge sider." : "Trappen har ingen håndløper; den skal ha det på begge sider.") : "håndløperen står ikke i modellen.");
    }
    if (part === "railing" || part === "balcony") {
      const id = part === "railing" ? "rekkverk_hoyde" : "balkong_rekkverk_hoyde", L = byId[id].limit, h = part === "railing" ? p.height : p.railing_height;
      const foot = p.ground ?? a.base_kote, fall = fallOf(site, a, foot, part === "railing" ? 1.5 : (p.depth ?? 1.5) + 1);
      if (!num(h)) row(id, null, null, null, "rekkverkshøyden står ikke i modellen.");
      else if (fall == null) row(id, null, h, `minst ${m(L.min_m)} m (${m(L.min_m_high)} m over ${m(L.high_fall_over_m)} m fall)`, `fallet ved rekkverket er ikke kjent (fot eller terreng mangler); høyden er ${m(h)} m.`);
      else {
        const need = fall > L.high_fall_over_m ? L.min_m_high : L.min_m;
        if (fall < L.other_means_under_m) row(id, true, h, `minst ${m(need)} m; fall under ${m(L.other_means_under_m)} m kan sikres på annen måte`, `Fallet er ${m(fall)} m, under ${m(L.other_means_under_m)} m: det kan sikres på annen forsvarlig måte enn med rekkverk (fjerde ledd). Rekkverket er ${m(h)} m høyt${h < need ? `; er det et rekkverk for balkong eller terrasse, er ${m(need)} m kravet` : ""}.`);
        else row(id, h >= need - 1e-9, h, `minst ${m(need)} m`, `Fallet er ${m(fall)} m; rekkverket er ${m(h)} m høyt, minst ${m(need)} m kreves.`);
      }
    }
    if (part === "balcony" && p.door !== false) {
      for (const [id, key, what] of [["balkong_dorbredde", "door_width", "bred"], ["balkong_dorhoyde", "door_height", "høy"]]) {
        const L = byId[id].limit, mn = L.min_m, v = p[key];
        row(id, num(v) ? v >= mn - 1e-9 : null, v ?? null, `minst ${m(mn)} m`, num(v) ? `Døren er ${m(v)} m ${what}; minst ${m(mn)} m fri ${key === "door_width" ? "bredde" : "høyde"}${L.alt && v < L.alt[0].min_m ? ` (${L.alt.map(x => `${m(x.min_m)} m ${x.when}`).join("; ")})` : ""}.` : "dørmålet står ikke i modellen.", num(v) && L.alt ? L.alt.map(x => ({ when: x.when, limit: `minst ${m(x.min_m)} m`, ok: v >= x.min_m - 1e-9 })) : undefined);
      }
    }
    if (a.kind === "balconies") row("balkong_rekkverk_balkonger", null, a.railing ?? null, `minst ${m(byId.balkong_rekkverk_balkonger.limit.min_m)} m`, `balkongene har rekkverk av ${a.railing ?? "ukjent"}, men høyden er ikke tegnet.`);
    const en = a.ground?.entrance;
    if (en) {
      const L = byId.rampe_stigning.limit;
      if (!en.ok) { row("atkomst_trinnfri", null, null, "trinnfri atkomst", `inngangen ligger ${m(en.rise)} m fra terrenget: appens rampe 1:20 blir for lang. Loven tillater 1:15 (om lag ${m(en.rise * 15)} m rampe); velg heis, en annen inngang eller en annen kote.`); row("rampe_stigning", null, null, null, "ingen rampe finnes å måle."); }
      else {
        row("atkomst_trinnfri", true, en.ramp_m, "trinnfri atkomst", en.ramp_m < 0.5 ? "Terrenget ligger i nivå med gulvet: ingen rampe trengs." : `Atkomsten er trinnfri med en rampe på ${m(en.ramp_m)} m.`);
        if (en.ramp_m < 0.5) row("rampe_stigning", true, 0, "1:15", "Ingen rampe: inngangen er i nivå.");
        else { const slope = en.rise / en.ramp_m, max = en.ramp_m <= L.short_m ? L.max_slope_short : L.max_slope; row("rampe_stigning", slope <= max + 0.003, `1:${Math.round(1 / slope)}`, `1:${Math.round(1 / max)}`, `Rampen stiger ${m(en.rise)} m over ${m(en.ramp_m)} m, altså 1:${Math.round(1 / slope)}; ikke brattere enn 1:${Math.round(1 / max)}${en.ramp_m <= L.short_m ? " (strekning inntil 5,0 m)" : " (1:15; 1:12 på strekninger inntil 5,0 m)"}.`); }
      }
    }
  }
  return out;
}
/* the rows as one sentence a person can be told: how many hold, break and are not measured */
export const summary = rows => ({ ok: rows.filter(r => r.status === "ok").length, brudd: rows.filter(r => r.status === "brudd").length, ikke_målt: rows.filter(r => r.status === "ikke målt").length });
