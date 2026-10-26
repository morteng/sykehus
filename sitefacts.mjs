/* U3673: what is known about the plot itself, from Hagekart's own site_report (ONE copy of the fetch: Hagekart asks NVE,
   NGU, Riksantikvaren and GBIF; sykehus asks Hagekart over its open MCP tool, as any chat app can). Only what bears on a
   building: the hazards (flood, quick clay, slides, radon), the heritage listings within 50 m, the invasive plants near,
   and the zoning where Hagekart has it (Oslo only). Kept a day; an older answer is still given when Hagekart does not answer. */
const URL_DEFAULT = "https://hagekart.gulden.no/mcp", ADDRESS = "Dronninggata 28, Drammen", DAY = 864e5;
export const LIMITS = "These are screening maps and registers, not a decision: a hazard zone («aktsomhetsområde») means a specialist must assess before large excavation or fill, not that building is forbidden; the heritage listings are what Riksantikvaren's register holds (a municipal listing still matters in a permit); zoning for Drammen is not fetched here (read the municipality's plan map and the plan provisions). Name these limits early when a change touches them.";
export function createSiteFacts({ fetchImpl = fetch, url = process.env.SYKEHUS_HAGEKART_URL || URL_DEFAULT, address = ADDRESS, ttl = DAY, now = Date.now } = {}) {
  let kept = null;
  async function ask() {
    const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "site_report", arguments: { address } } }), signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`Hagekart svarte ${r.status}`);
    const j = await r.json(), res = j.result, text = res?.content?.find(c => c.type === "text")?.text;
    if (j.error || res?.isError || !text) throw new Error(j.error?.message || text || "Hagekart svarte ikke med fakta");
    const f = JSON.parse(text);
    return { place: f.place || address, elevation_m: f.elevation_m ?? null, hazards: f.hazards || [], heritage_within_50m: f.heritage_within_50m || [],
      invasive_plants_within_500m: f.invasive_plants_within_500m || [], zoning: f.zoning ?? null };
  }
  return async function siteFacts() {
    const fresh = kept && now() - kept.at < ttl;
    if (!fresh) {
      try { kept = { at: now(), facts: await ask() }; }
      catch (e) { if (!kept) throw Object.assign(new Error(`Fikk ikke tomtefakta fra Hagekart: ${e.message}`), { tool: true }); }   // an older answer stands
    }
    const { facts, at } = kept;
    return { ...facts, ...(facts.zoning ? {} : { zoning: "Ikke hentet for Drammen (Hagekart har bare Oslo): les kommunens plankart og planbestemmelser." }),
      sources: "NVE aktsomhetskart (flom, kvikkleire, snøskred og steinsprang, jord- og flomskred), NGU radon, Riksantikvaren (Kulturminnesøk), Artsdatabanken/GBIF, via Hagekart (hagekart.gulden.no)",
      fetched: new Date(at).toISOString(), limits: LIMITS };
  };
}
