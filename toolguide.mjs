/* T3 tool organization: the model sees a short tool list; the long text (every field's prose, the construction script's
   contract, the «For people» help) is kept whole here and in the definitions, and find_tool hands it out on request.
   One source: the full text stays beside each field in mcp.mjs; slimSchema derives the short schema and the guide from it,
   so the two cannot disagree.
   Budget (tests/tool-budget.test.mjs): the list the model sees <= 12 000 tokens, try_change <= 3 500, any other <= 800,
   the instructions <= 1 000; a token is counted as JSON chars / 4. */

/* a family in every title, so the model reads the list as nine groups (the tool names stay: gulden-ai maps them) */
export const FAMILY = {
  about_site: "Les", about_wing: "Les", storeys: "Les", floor_plan: "Les", openings: "Les", site_facts: "Les", about_ground: "Les",
  try_change: "Endre", propose_sketch: "Endre", undo_change: "Endre", redo_change: "Endre",
  list_parts: "Deler", find_models: "Deler", fetch_model: "Deler",
  check_design: "Mål", check_model: "Mål", measure: "Mål", check_fit: "Mål", summary: "Mål",
  look: "Vis", draw_plan: "Vis", draw_section: "Vis", show_building: "Vis", make_shots: "Vis", photo_spots: "Vis", retake_photos: "Vis",
  search_documents: "Dokument", read_document: "Dokument", list_documents: "Dokument",
  show_draft: "Versjon", new_version: "Versjon", list_versions: "Versjon", rename_version: "Versjon", delete_version: "Versjon", undelete_version: "Versjon", set_sharing: "Versjon",
  send_wish: "Ønske", list_wishes: "Ønske", ask_point: "Ønske", find_tool: "Finn",
};
export const familyTitle = (name, title) => FAMILY[name] ? `${FAMILY[name]} · ${title}` : title;

const balanced = t => (t.match(/[(«{\[]/g) || []).length === (t.match(/[)»}\]]/g) || []).length;
/* what each write is read back with, named in the last line of its description (plan section 2, item 5) */
export const READBACK = {
  try_change: "show_draft, measure, check_fit", undo_change: "show_draft", redo_change: "show_draft", make_shots: "show_draft (saved_views)",
  new_version: "list_versions", rename_version: "list_versions", delete_version: "list_versions", undelete_version: "list_versions", set_sharing: "list_versions",
  send_wish: "list_wishes", retake_photos: "photo_spots", ask_point: "the pin comes back as the person's next message", fetch_model: "check_model after try_change import",
};
/* the first clause of a long description, at most max characters, or none: the rest is the guide's */
export function shorten(d, max = 80) {
  if (typeof d !== "string" || d.length <= max) return d;
  let best = null;
  for (const m of d.matchAll(/(\. |; |: | — )/g)) { if (m.index >= 18 && m.index <= max && balanced(d.slice(0, m.index))) best = m.index; if (m.index > max) break; }
  return best == null ? null : d.slice(0, best);
}

/* a copy of a schema whose long descriptions are cut to a clause; each full text goes to store[path] */
export function slimSchema(node, store, path = "", max = 80, drop = null) {
  if (Array.isArray(node)) return node.map((x, i) => slimSchema(x, store, `${path}[${i}]`, max, drop));
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "description" && typeof v === "string") {
      const s = drop?.has(v) ? null : shorten(v, max);
      if (s !== v) store[path || "."] = v;
      if (s != null) out[k] = s;
    } else if (k === "properties" && v && typeof v === "object") {
      out[k] = Object.fromEntries(Object.entries(v).map(([n, x]) => [n, slimSchema(x, store, path ? `${path}.${n}` : n, max, drop)]));
    } else if (k === "anyOf" && Array.isArray(v)) out[k] = v.map(x => slimSchema(x, store, path, max, drop));
    else out[k] = slimSchema(v, store, path, max, drop);
  }
  return out;
}

/* a point [east, north] is told once in the edit's description; each use keeps type array of numbers, and the server checks its length */
export function plainPoints(node) {
  if (Array.isArray(node)) return node.map(plainPoints);
  if (!node || typeof node !== "object") return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, plainPoints(v)]));
  if (out.type === "array" && out.minItems === 2 && out.maxItems === 2 && out.items?.type === "number") { delete out.minItems; delete out.maxItems; }
  return out;
}

/* a long tool description cut after a whole sentence, at most max characters */
export function shortTool(d, max = 300) {
  if (d.length <= max) return d;
  let end = -1;
  for (const m of d.matchAll(/\. /g)) { if (m.index + 1 > max) break; end = m.index + 1; }
  if (end > 0) return d.slice(0, end);
  const cut = d.slice(0, max).replace(/\s+\S*$/, "");
  return cut + "…";
}

/* every edit kind: its group, the words a person or a model would use (Norwegian and English, folded), one example call
   that passes fieldsOf, and what to read back after it */
/* the one line a kind keeps in try_change's schema when its own text was cut: only where the name says too little */
export const KIND_LINE = { construction: "A Python script; read find_tool kind=construction first", part: "A ready-made part; list_parts", volume: "A new building", reshape: "Change a new thing by id", paint: "A brush stroke on the ground" };
export const KINDS = {
  level: { family: "Fakta", words: "etasje storey kote floor level hoyde", example: { kind: "level", wing: "midtfloy", storey: "2", kote: 20.31, why: "snitt B-B" }, readback: "about_wing" },
  wing: { family: "Fakta", words: "floy wing card kort bygd built bruk use fasade facade konstruksjon", example: { kind: "wing", wing: "vestfloy", field: "built", value: "1967-70", why: "tegning" }, readback: "about_wing" },
  room: { family: "Fakta", words: "rom room navn name bruk use areal area", example: { kind: "room", storey: "5. etasje", room: "Operasjonstue 2", set: { use: "dagkirurgi" }, why: "ønske" }, readback: "floor_plan" },
  note: { family: "Fakta", words: "notat note merknad kommentar", example: { kind: "note", text: "Her kan en ny trapp stå", wing: "midtfloy" }, readback: "about_wing" },
  demolish: { family: "Riv", words: "riv rive demolish tear down fjern remove alle all", example: { kind: "demolish", building: "ostfloy", why: "ønske" }, readback: "show_draft" },
  restore: { family: "Riv", words: "gjenopprett restore tilbake back behold keep", example: { kind: "restore", building: "sentralblokka" }, readback: "show_draft" },
  balconies: { family: "Bygg", words: "balkong balkonger balcony balconies fasade facade rekkverk railing", example: { kind: "balconies", wing: "ostfloy", side: "S", from_storey: "2", to_storey: "4", why: "ønske" }, readback: "show_draft" },
  volume: { family: "Bygg", words: "volum volume bygg building nytt new tilbygg hus box saltak gable pyramide drivhus glass tak roof taket", example: { kind: "volume", name: "Paviljong", shape: "box", at: { wing: "ostfloy", side: "S", gap_m: 4 }, length: 20, width: 10, height: 6 }, readback: "measure" },
  part: { family: "Bygg", words: "del part ferdig ready basseng pool trapp stair rekkverk railing balkong balcony drivhus greenhouse kuppel dome", example: { kind: "part", part: "stair", from: [100, 100], to: [100, 105], params: { height: 1.2, width: 1.2 } }, readback: "check_design" },
  construction: { family: "Bygg", words: "konstruksjon construction script python ifcopenshell paviljong pavilion ramme frame bim", example: { kind: "construction", name: "Ramme", from: [100, 100], to: [110, 100], script: "# see find_tool kind=construction" }, readback: "check_model" },
  import: { family: "Bygg", words: "import fil file ifc step gltf obj stl dxf dwg modell model", example: { kind: "import", file: "<sha from /api/import>", name: "Benk", from: [100, 100], to: [102, 100], licence: "CC0" }, readback: "check_model" },
  reshape: { family: "Bygg", words: "endre change flytt move drei turn storrelse resize navn rename align justere", example: { kind: "reshape", id: "n1abc", from: [100, 100], to: [120, 100], width: 10 }, readback: "measure" },
  surface: { family: "Landskap", words: "flate surface plen lawn gress grass grus gravel belegg paving asfalt dam pond vann water basseng pool bed hage garden takhage tak taket roof on", example: { kind: "surface", ring: [[100, 100], [120, 100], [120, 110], [100, 110]], surface: "grass", on: "sentralblokka", why: "ønske" }, readback: "show_draft" },
  ground: { family: "Landskap", words: "grunn ground terreng terrain planere level jordarbeid earthwork terrasse terrace skjaering fylling", example: { kind: "ground", ring: [[100, 100], [120, 100], [120, 110], [100, 110]], kote: 25 }, readback: "show_draft" },
  paint: { family: "Landskap", words: "mal paint pensel brush plen lawn gress grass bed grus gravel jord soil hage garden takhage tak taket roof on", example: { kind: "paint", line: [[100, 100], [110, 100]], r: 3, surface: "grass", on: "sentralblokka" }, readback: "show_draft" },
  terrain: { family: "Landskap", words: "terreng terrain flytt jord earth hev senk raise lower flate flatten glatt smooth dam pond terrasse", example: { kind: "terrain", shape: { t: "circle", c: [100, 100], r: 5 }, op: "raise", h: 1 }, readback: "show_draft" },
  path: { family: "Landskap", words: "sti path vei gangvei gravel grus paving belegg takhage tak taket roof on", example: { kind: "path", line: [[100, 100], [120, 100]], width: 2, surface: "gravel", on: "sentralblokka" }, readback: "show_draft" },
  trees: { family: "Landskap", words: "tre trær trees plant planting art species hage garden takhage tak taket roof on busker", example: { kind: "trees", species: "Betula pendula", points: [[100, 100]], on: "sentralblokka" }, readback: "show_draft" },
  fell: { family: "Landskap", words: "felle fell hogge tre trees fjern remove", example: { kind: "fell", ring: [[100, 100], [120, 100], [120, 110], [100, 110]] }, readback: "show_draft" },
};

/* what each tool is for, in the words a person asks with */
export const TOOL_WORDS = {
  about_site: "tomta site fløyene wings oversikt overview gater streets", about_wing: "fløy wing kort tak roof fasade facade etasjer levels", storeys: "etasjer storeys kote", floor_plan: "plan rom rooms areal", openings: "vinduer windows åpninger fasade",
  site_facts: "flom flood kvikkleire radon kulturminne heritage regulering zoning", about_ground: "terreng ground sti path vei veg høyde kote fall drop", try_change: "endre change bygge build tegne draw",
  propose_sketch: "skisse sketch forslag plan", undo_change: "angre undo", redo_change: "gjør om redo igjen", list_parts: "deler parts basseng trapp drivhus", find_models: "modeller models bibliotek library", fetch_model: "hent model fetch",
  check_design: "tek17 regler rules trapp rekkverk", check_model: "ifc ids kollisjon clash endringer changes", measure: "mål measure avstand distance vinkel angle parallell overheng", check_fit: "passer fit kollisjon overlapp tak taket stikker ut",
  look: "se look bilde picture", show_building: "vis show 3d plan snitt section fasade sol sun kamera camera lagre visning", make_shots: "bildeserie shots", photo_spots: "bildesteder photos", retake_photos: "ta på nytt retake bilder",
  search_documents: "søk search dokument tegning", read_document: "les read dokument side page", list_documents: "dokumenter documents liste", show_draft: "utkast draft endringer changes ifc lenke link",
  new_version: "ny versjon new version alternativ", list_versions: "versjoner versions liste", rename_version: "gi nytt navn rename", delete_version: "slett delete papirkurv", undelete_version: "gjenopprett undelete", set_sharing: "del share lenke offentlig privat",
  summary: "areal kostnad cost bta bra kvadratmeter area oppsummering", draw_plan: "tegn plan planbilde mål dimensjoner draw plan zoom hjørne", draw_section: "snitt section tegn mål kote høyde fasade",
  send_wish: "ønske wish feil bug send", list_wishes: "ønsker wishes status sendt", ask_point: "pek pin sted point sett", find_tool: "finn find verktøy tool hjelp help",
};

/* the help for people, kept out of the instructions: one topic each, shown by find_tool topic=<id> */
export const TOPICS = {
  "ui:tour": "The page has a guided tour, under the «?» («Vis guiden») in the top bar (a short one for a visitor, ending on «Logg inn»; the full one once signed in, and the newer steps again after an update). Say so when someone asks how to get started or what the page can do. The «Tilbakemelding» button in the top bar sends Morten a problem, an idea or a question (with a picture of the page if asked) and lists what the person sent before; the panel has three tabs, Forslag, Bygg and Anton.",
  "ui:trees": "The tree button in the tool column under the sun switches the trees and planted bushes between full, simple (plain shapes) and off (the ground stays); it is kept in the person's browser, and a Gjengi picture shows what is on.",
  "ui:sun": "The sun button (top right, beside the zoom) sets the date and hour of the light; show_building sun does the same, and a saved view keeps it.",
  "ui:gjengi": "Gjengi (the fourth tab in the right panel, after Anton) is a photo mode: opening it makes the 3D view a viewfinder with a frame, thirds and the horizon, and a small plan shows the camera with its field of view (it can be dragged). The person picks the lens (24, 35, 50, 85 mm, iPhone, Drone), the picture shape (3:2, 16:9, 1:1, 4:5, 2:3), the look (arkitektfoto, blåtime, konkurransebilde, drone, hvitmodell, skisse) and size (utkast, standard, stor, each with its price shown first) and presses the big shutter «Ta bildet · ca. $…»; the page picks sensible ones by itself. You can set them with show_building camera, look, lens_mm and picture_size, then say «Åpne Gjengi-fanen og trykk Ta bildet»: only the person presses, it costs money. Every picture keeps its place («Mine bildesteder» under the tab): the person taps one to fly back there free, and «Ta på nytt» makes a new picture from it when the model has changed. With photo_spots you see them, with retake_photos you propose new pictures from some of them: a card with the count and total price appears on the tab, and only the person's press makes them.",
  "ui:views": "The person keeps camera views by name on a version (U3562): show_building with save_as keeps the view it shows under that name (when they say «husk denne», «lagre visningen»), saved_view goes to one; show_draft lists them.",
  "ui:versions": "A person deletes their own saved versions (delete_version, by id or name; several at once is fine) and gets them back within 30 days (undelete_version; list_versions with trash: true shows what is in the trash). Ask which ones when it is not plain, say what you deleted, and that «Angre» on the page or you can bring it back for 30 days; after that it is gone. Only their own: another person's version cannot be deleted. On the page it is the bin button on a row in Forslag, or «Velg» for several.",
  "ui:dragging": "When the person drags a new building or a ground corner on the page, faint dashed lines show what it lines up with (a wall's middle, square to a wall, a building's own direction, the mirror of a corner, half way between two walls); a digit typed while dragging sets an exact length, width, direction or move and Enter keeps it; Alt turns the snapping off.",
  "roof": "A garden or a building on a roof: give on = the wing (surface, paint, path, trees, fell, volume, part) and the foot is the roof's kote; about_wing roof.levels lists the levels; check_fit and measure read it back. A volume with at { wing, roof: true } is set along the roof's axis.",
};

const fold = s => String(s).toLowerCase().replace(/æ/g, "ae").replace(/[øö]/g, "o").replace(/[åä]/g, "a").replace(/é/g, "e");
const tokens = s => fold(s).split(/[^a-z0-9]+/).filter(t => t.length >= 2);
const hit = (t, w) => t === w || (w.length >= 3 && t.startsWith(w)) || (t.length >= 4 && w.startsWith(t));

/* the find_tool answer: the tools and edit kinds that fit an intent, a kind's full guide, a tool's full text or a topic */
export function createFinder({ tools, kinds, guide, fieldsOf, text }) {
  const entries = [
    ...Object.entries(kinds).map(([k, v]) => ({ type: "kind", id: k, family: v.family, hay: tokens(`${k} ${v.words} ${v.family}`), summary: (guide.kinds[k]?.about || "").split(/[.:]/)[0].slice(0, 140), example: v.example, readback: v.readback })),
    ...tools.filter(t => t.name !== "find_tool").map(t => ({ type: "tool", id: t.name, family: FAMILY[t.name] || "", hay: tokens(`${t.name.replace(/_/g, " ")} ${t.title} ${TOOL_WORDS[t.name] || ""}`), summary: shortTool(t.description, 140) })),
    ...Object.keys(TOPICS).map(id => ({ type: "topic", id, family: "Hjelp", hay: tokens(`${id} ${TOPICS[id].slice(0, 200)}`), summary: TOPICS[id].slice(0, 100) })),
  ];
  const map = () => {
    const by = {}; for (const e of entries) if (e.type === "tool") (by[e.family] ??= []).push(e.id);
    const ks = {}; for (const [k, v] of Object.entries(kinds)) (ks[v.family] ??= []).push(k);
    return { tool_families: by, edit_kinds_in_try_change: ks, topics: Object.keys(TOPICS) };
  };
  const out = e => ({ type: e.type, id: e.id, family: e.family, what: e.summary, ...(e.example ? { example_edit: e.example } : {}), ...(e.readback ? { read_back_with: e.readback } : {}) });
  function run(a = {}) {
    if (a.kind != null) {
      const k = kinds[a.kind]; if (!k) throw Object.assign(new Error(`No edit kind «${a.kind}». Kinds: ${Object.keys(kinds).join(", ")}.`), { tool: true });
      const g = guide.kinds[a.kind];
      return { kind: a.kind, family: k.family, about: g.about, fields: g.fields, example_edit: k.example, example_check: fieldsOf(k.example) || "fields ok", read_back_with: k.readback };
    }
    if (a.tool != null) {
      const t = tools.find(x => x.name === a.tool); if (!t) throw Object.assign(new Error(`No tool «${a.tool}». Tools: ${tools.map(x => x.name).join(", ")}.`), { tool: true });
      return { tool: t.name, family: FAMILY[t.name] || null, description: t.description, fields: guide.tools[t.name] || {} };
    }
    if (a.topic != null) {
      const t = TOPICS[a.topic]; if (!t) throw Object.assign(new Error(`No topic «${a.topic}». Topics: ${Object.keys(TOPICS).join(", ")}.`), { tool: true });
      return { topic: a.topic, text: t };
    }
    const q = tokens(a.intent || ""); if (!q.length) return { ...map(), note: "Give intent (what the person wants, in their words), or kind, tool or topic, to get the full text." };
    const scored = entries.map(e => ({ e, n: q.filter(t => e.hay.some(w => hit(t, w))).length })).filter(x => x.n > 0)
      .sort((x, y) => y.n - x.n || (y.e.type === "kind") - (x.e.type === "kind"));
    if (!scored.length) return { matches: [], ...map(), note: "Nothing matched: see the map, or send_wish if no tool can do it." };
    return { matches: scored.slice(0, 5).map(x => out(x.e)), note: "kind: find_tool kind=<id> gives its fields. tool: its own schema is in the list; find_tool tool=<id> gives the full text." };
  }
  return { run, map, mapText: () => text(map()), entries };
}
