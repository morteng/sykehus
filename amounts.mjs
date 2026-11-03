/* U3630: amounts (m³ concrete, m² glass, tonnes of earth moved …) from the model, a rough price from rules/amounts.json, and
   the difference between two afters (Før, or another version). Pure, no network. The numbers are «beregnet» from the model's
   boxes and the table's assumptions (wall and slab thickness, density), the prices «antatt»: a price with no source is refused. */
import { readFileSync } from "node:fs";

const r1 = x => Math.round(x * 10) / 10, num = x => typeof x === "number" && Number.isFinite(x);
const MATS = ["concrete", "steel", "wood", "brick"];
/* what each amount is called and counted in; the order is the order of the list */
export const LABELS = {
  concrete_m3: ["Betong", "m³"], concrete_t: ["Betong", "tonn"], steel_m3: ["Stål", "m³"], steel_t: ["Stål", "tonn"], wood_m3: ["Tre", "m³"], brick_m3: ["Tegl", "m³"],
  glass_m2: ["Glass", "m²"], water_m3: ["Vann", "m³"], cut_m3: ["Utgraving", "m³"], fill_m3: ["Fylling", "m³"], earth_t: ["Jord flyttet (utgravd)", "tonn"], demolished_m3: ["Revet (brutto)", "m³"],
};

export function loadAmounts(path = new URL("./rules/amounts.json", import.meta.url)) {
  const j = JSON.parse(readFileSync(path, "utf8")), a = j.assumptions || {};
  for (const k of ["slab_m", "wall_m", "pool_wall_m", "soil_t_per_m3"]) if (!num(a[k]) || a[k] <= 0) throw new Error(`amounts.json: assumptions.${k} must be a positive number`);
  if (!Array.isArray(j.prices)) throw new Error("amounts.json: prices must be a list");
  for (const p of j.prices) {
    const w = `amounts.json: price «${p?.item ?? "?"}»`;
    if (typeof p?.source !== "string" || !p.source.trim()) throw new Error(`${w} has no source: a price without a source is refused`);
    if (!LABELS[p.quantity]) throw new Error(`${w}: quantity must be one of ${Object.keys(LABELS).join(", ")}`);
    if (!num(p.nok_low) || !num(p.nok_high) || p.nok_low < 0 || p.nok_high < p.nok_low) throw new Error(`${w}: nok_low and nok_high must be numbers, low <= high`);
  }
  return { assumptions: a, prices: j.prices };
}

/* the amounts of one after's site: { q: { key: number }, parts: { key: [{ name, m3 | m2 }] }, unmeasured: [{ name, why }] } */
export function amountsOf(site, table) {
  const A = table.assumptions, d = A.density_t_per_m3 || {}, q = Object.fromEntries(Object.keys(LABELS).map(k => [k, 0])), by = {}, unmeasured = [];
  const add = (key, v, name) => { if (!(v > 0)) return; q[key] += v; (by[key] ||= []).push({ name, [LABELS[key][1]]: r1(v) }); };
  for (const a of (site.added || []).filter(x => x.kind === "volume")) {
    const L = a.from && a.to ? Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]) : 0, W = a.width || 0, H = a.height || 0, P = a.bim?.params || {};
    if (a.bim?.part === "pool_basin" && num(+P.length) && num(+P.width) && num(+P.depth)) {
      add("concrete_m3", (P.length * P.width + 2 * (P.length + P.width) * P.depth) * (+P.wall || A.pool_wall_m), a.name); continue;
    }
    if (a.shape === "bim") { unmeasured.push({ name: a.name, why: a.bim?.part ? `delen «${a.bim.part}» har ingen regel for mengde ennå` : "en importert modell: volumet står ikke i modellen" }); continue; }
    if (a.material === "water") { add("water_m3", a.volume_m3 ?? L * W * H, a.name); continue; }
    const foot = a.footprint_m2 ?? L * W, per = 2 * (L + W), storeys = a.storeys || Math.max(1, Math.round(H / 3.2)), mat = a.material;
    add("concrete_m3", foot * A.slab_m, a.name);
    if (mat === "glass") add("glass_m2", per * H + foot, a.name);
    else if (mat === "concrete") add("concrete_m3", per * H * A.wall_m + foot * A.slab_m * (storeys - 1), a.name);
    else if (MATS.includes(mat)) add(mat + "_m3", per * H * A.wall_m, a.name);
    else unmeasured.push({ name: a.name, why: "ingen materiale oppgitt: veggene er ikke regnet" });
  }
  for (const w of (site.landscape || []).filter(g => g.kind === "surface" && g.surface === "water" && g.pool && g.ring?.length > 2)) {
    const depth = w.basin?.depth ?? w.depth ?? 1.4, area = w.area_m2 ?? 0, per = w.ring.reduce((s, p, i) => { const n = w.ring[(i + 1) % w.ring.length]; return s + Math.hypot(n[0] - p[0], n[1] - p[1]); }, 0);
    add("concrete_m3", (area + per * depth) * A.pool_wall_m, w.name || "Basseng");
    add("water_m3", area * (w.level != null && w.basin ? w.level - w.basin.bottom : depth - 0.15), w.name || "Basseng");
  }
  /* earth: the terrain ops, the levelled grounds, the pools' and ponds' basins, and each building's pad */
  const dig = (cut, fill, name) => { add("cut_m3", cut, name); add("fill_m3", fill, name); };
  if (site.earthwork) dig(site.earthwork.cut_m3, site.earthwork.fill_m3, "Terrengendringer");
  for (const g of site.grading || []) dig(g.cut_m3, g.fill_m3, g.name || "Planert flate");
  for (const w of site.landscape || []) if (w.basin) dig(w.basin.cut_m3, w.basin.fill_m3, w.name || "Vann");
  for (const a of site.added || []) if (a.ground && (a.ground.cut_m3 || a.ground.fill_m3)) dig(a.ground.cut_m3, a.ground.fill_m3, `Tomt under ${a.name}`);
  for (const dm of site.demolished || []) add("demolished_m3", dm.gross_volume_m3, dm.name);
  for (const m of MATS) if (d[m]) q[m + "_t"] = q[m + "_m3"] * d[m];
  q.earth_t = q.cut_m3 * A.soil_t_per_m3;
  for (const k of Object.keys(q)) q[k] = r1(q[k]);
  return { q, parts: by, unmeasured };
}

/* an after against another (Før when `before` is the site with no edits): a row per amount, and the rough price of each row's difference */
export function compareAmounts(now, before, table, { of = "versjonen", against = "Før" } = {}) {
  const price = Object.fromEntries(table.prices.map(p => [p.quantity, p]));
  const rows = Object.keys(LABELS).filter(k => now.q[k] || before.q[k]).map(k => {
    const diff = r1(now.q[k] - before.q[k]), p = price[k], [label, unit] = LABELS[k];
    const lo = p ? Math.round(diff * (diff >= 0 ? p.nok_low : p.nok_high)) : null, hi = p ? Math.round(diff * (diff >= 0 ? p.nok_high : p.nok_low)) : null;
    return { key: k, label, unit, now: now.q[k], before: before.q[k], diff, ...(p ? { price: { item: p.item, unit: p.unit, nok_low: p.nok_low, nok_high: p.nok_high, source: p.source }, nok_low: lo, nok_high: hi } : { price: null }),
      ...(now.parts[k]?.length ? { from: now.parts[k].slice(0, 8) } : {}) };
  });
  const priced = rows.filter(r => r.price), total = k => priced.reduce((s, r) => s + r[k], 0);
  const sum = { nok_low: priced.length ? total("nok_low") : null, nok_high: priced.length ? total("nok_high") : null };
  const nb = n => Math.round(n).toLocaleString("nb-NO"), line = r => `${r.label} ${String(r.now).replace(".", ",")} ${r.unit}${r.diff ? ` (${r.diff > 0 ? "+" : "−"}${String(Math.abs(r.diff)).replace(".", ",")} mot ${against})` : ` (som ${against})`}`;
  return { of, against, rows, difference_nok: sum, unmeasured: now.unmeasured,
    table: { file: "rules/amounts.json", assumptions: table.assumptions, prices: table.prices },
    say: rows.length ? `${of}: ${rows.map(line).join("; ")}. Grov pris på forskjellen mot ${against}: ${sum.nok_low == null ? "ikke målt" : `${nb(sum.nok_low)}–${nb(sum.nok_high)} kr`} (antatt, fra prislisten i rules/amounts.json; ikke et tilbud).` : `${of} har ingen mengder mot ${against}.`,
    note: "Mengdene er beregnet fra modellens bokser og antakelsene i tabellen (veggtykkelse, plate, tetthet), ikke målt på tegning. Prisene er byggerens grove anslag uten tilbud: si «antatt», og at tabellen kan rettes." + (now.unmeasured.length ? ` Ikke regnet: ${now.unmeasured.map(u => `${u.name} (${u.why})`).join("; ")}.` : "") };
}
