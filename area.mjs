/* T6: the area and cost summary of an after (a version or draft's site): pure, no network.
   summarize(site, costs) reads site.added (new volumes), site.demolished, site.landscape (ground surfaces) and site.earthwork.
   Every area is «beregnet»: storeys x footprint (a volume with no storeys: height / 3,2 m, rounded, and said so).
   Prices live in rules/costs.json; loadCosts refuses a price with no source, so no price is ever shown without one. */
import { readFileSync } from "node:fs";

const STOREY_M = 3.2, r1 = x => Math.round(x * 10) / 10, num = x => typeof x === "number" && Number.isFinite(x);
const QUANTITIES = ["bta_m2", "bra_m2", "demolished_m3", "demolished_m2", "ground_m2", "cut_m3", "fill_m3"];

/* the price list: { prices: [{ item, quantity, unit, nok_low, nok_high, source }], bra_factor?: { value, source } }; a price or factor with no source is refused */
export function loadCosts(path = new URL("./rules/costs.json", import.meta.url)) {
  const j = JSON.parse(readFileSync(path, "utf8")), prices = j.prices;
  if (!Array.isArray(prices)) throw new Error("costs.json: prices must be a list");
  for (const p of prices) {
    const w = `costs.json: price «${p?.item ?? "?"}»`;
    if (typeof p?.source !== "string" || !p.source.trim()) throw new Error(`${w} has no source: a price without a source is refused`);
    if (!QUANTITIES.includes(p.quantity)) throw new Error(`${w}: quantity must be one of ${QUANTITIES.join(", ")}`);
    if (!num(p.nok_low) || !num(p.nok_high) || p.nok_low < 0 || p.nok_high < p.nok_low) throw new Error(`${w}: nok_low and nok_high must be numbers, low <= high`);
  }
  if (j.bra_factor != null && (!num(j.bra_factor.value) || j.bra_factor.value <= 0 || j.bra_factor.value > 1 || !String(j.bra_factor.source || "").trim())) throw new Error("costs.json: bra_factor needs a value in (0, 1] and a source");
  return { prices, bra_factor: j.bra_factor || null };
}

export function summarize(site, costs = { prices: [], bra_factor: null }) {
  const volumes = (site.added || []).filter(a => a.kind === "volume").map(a => {
    const fromHeight = !a.storeys, storeys = a.storeys || Math.max(1, Math.round((a.height || 0) / STOREY_M));
    const bta = r1(storeys * (a.footprint_m2 || 0));
    return { name: a.name, storeys, footprint_m2: a.footprint_m2, bta_m2: bta, bra_m2: costs.bra_factor ? r1(bta * costs.bra_factor.value) : null,
      ...(fromHeight ? { storeys_from: "høyden delt på 3,2 m, ingen etasjer oppgitt" } : {}) };
  });
  const dem = site.demolished || [], demolished = { count: dem.length, footprint_m2: r1(dem.reduce((s, d) => s + (d.footprint_m2 || 0), 0)), gross_volume_m3: Math.round(dem.reduce((s, d) => s + (d.gross_volume_m3 || 0), 0)) };
  const surfaces = {};
  for (const l of site.landscape || []) if (num(l.area_m2) && l.surface) surfaces[l.surface] = r1((surfaces[l.surface] || 0) + l.area_m2);
  const ground_m2 = r1(Object.values(surfaces).reduce((s, x) => s + x, 0)), ew = site.earthwork || null;
  const earthwork = ew ? { cut_m3: ew.cut_m3, fill_m3: ew.fill_m3, net_m3: ew.net_m3 } : { cut_m3: 0, fill_m3: 0, net_m3: 0 };
  const bta_m2 = r1(volumes.reduce((s, v) => s + v.bta_m2, 0));
  const qty = { bta_m2, bra_m2: costs.bra_factor ? r1(bta_m2 * costs.bra_factor.value) : null, demolished_m3: demolished.gross_volume_m3, demolished_m2: demolished.footprint_m2, ground_m2, cut_m3: earthwork.cut_m3, fill_m3: earthwork.fill_m3 };
  const lines = costs.prices.filter(p => num(qty[p.quantity]) && qty[p.quantity] > 0).map(p => ({ item: p.item, quantity: qty[p.quantity], unit: p.unit, nok_low: Math.round(qty[p.quantity] * p.nok_low), nok_high: Math.round(qty[p.quantity] * p.nok_high), source: p.source, antatt: true }));
  const cost = lines.length ? { lines, nok_low: lines.reduce((s, l) => s + l.nok_low, 0), nok_high: lines.reduce((s, l) => s + l.nok_high, 0), antatt: true, note: "Antatt: hver pris har sin kilde, men er ikke et tilbud." }
    : { lines: [], nok_low: null, nok_high: null, antatt: true, note: costs.prices.length ? "Ingen av prisene i prislisten passer mengdene i prosjektet." : "Ingen priser er lagt inn ennå (rules/costs.json er tom): kostnad er ikke målt. Be Morten legge inn priser med kilde." };
  return { new_volumes: volumes, totals: { bta_m2, bra_m2: qty.bra_m2 }, demolished, ground: { surfaces, total_m2: ground_m2 }, earthwork, cost,
    note: "Arealene er beregnet (etasjer x fotavtrykk), ikke målt på tegning." + (costs.bra_factor ? "" : " BRA er ikke målt: ingen kildebelagt BRA-faktor er lagt inn.") };
}
