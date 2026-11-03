/* One catalogue of surface types (areas): what each is called, its colours on the map, in 3D and under the brush, and which tools can make it.
   The map, the brush and the tool dock, the 3D model, the walk and MCP all read this table; add a type here once and it shows in all of them.
   (Lines are in data.js with their Norwegian standards, plants in plants.json.)
   no: name; the: with the article, for sentences; c, line: map fill and outline; tpl: care template (calendar.js);
   ground3: the 3D ground colour; mask: the colour a type has in the 3D ground mask (types that share one are painted alike there);
   brush: { fleck } makes it paintable with the brush (chips in the dock, flecks of paint); outline: a corner-tapping tool draws it;
   pattern: the map fills it with a texture. */
export const SURFACES = {
  lawn: { no: "Plen", the: "plenen", c: "#8cb35d", line: "#5f8a3e", tpl: "lawn", ground3: "#8dbb5a", mask: "#f00", brush: { fleck: ["#8cb35d", "#6f9a45", "#b6d37a"] }, outline: true, pattern: true },
  bed: { no: "Bed", the: "bedet", c: "#7a5b40", line: "#5a412c", tpl: "bed", ground3: "#9a6b45", mask: "#0f0", brush: { fleck: ["#7a5b40", "#5a412c", "#a07a55"] }, outline: true, pattern: true },
  paving: { no: "Belegning", the: "belegningen", c: "#c3bcb0", line: "#8f887c", tpl: "none", ground3: "#c9c3b8", mask: "#0ff", brush: { fleck: ["#c3bcb0", "#a9a296", "#e0dbd2"] }, outline: true, pattern: true },
  driveway: { no: "Innkjørsel", the: "innkjørselen", c: "#b5aea2", line: "#8f887c", tpl: "none", ground3: "#b5aea2", mask: "#00f", pattern: true },
  hedge: { no: "Hekk", the: "hekken", c: "#3f6b35", line: "#2a4a24", tpl: "hedge", ground3: "#3f6b35", mask: "#000" },
  pool: { no: "Basseng", the: "bassenget", c: "#79b4e0", line: "#2e6e9e", tpl: "none", ground3: "#79b4e0", mask: "#000" },
  play: { no: "Lekeplass", the: "lekeplassen", c: "#e0c07a", line: "#a88a3a", tpl: "none", ground3: "#e0c07a", mask: "#00f" },
  greenhouse: { no: "Drivhus", the: "drivhuset", c: "#dfeee6", line: "#7a9a8a", tpl: "none" },
  shed: { no: "Bod", the: "boden", c: "#cdbfae", line: "#8a7a66", tpl: "none" },
  /* a churchyard's lawn quarter with graves in it (detect.js microPatches): grass in 3D, mown like a lawn */
  graves: { no: "Gravfelt", the: "gravfeltet", c: "#9fb784", line: "#6f7f62", tpl: "lawn", ground3: "#8fb262", mask: "#f00" },
};
const pick = f => Object.fromEntries(Object.entries(SURFACES).filter(([, v]) => f(v)).map(([k, v]) => [k, v]));
export const kinds = () => Object.keys(SURFACES);
/* The views each consumer wants of the table. */
export const areaTable = () => Object.fromEntries(Object.entries(SURFACES).map(([k, v]) => [k, { no: v.no, the: v.the, c: v.c, line: v.line, tpl: v.tpl }]));
export const brushTable = () => Object.fromEntries(Object.entries(pick(v => v.brush)).map(([k, v]) => [k, { no: v.no.toLowerCase(), c: v.c, fleck: v.brush.fleck }]));
export const outlineKinds = () => Object.keys(pick(v => v.outline));
export const patterned = () => Object.keys(pick(v => v.pattern));
export const groundTable = () => Object.fromEntries(Object.entries(pick(v => v.ground3)).map(([k, v]) => [k, v.ground3]));
export const maskTable = () => Object.fromEntries(Object.entries(pick(v => v.mask)).map(([k, v]) => [k, v.mask]));
export const labelTable = () => Object.fromEntries(Object.entries(SURFACES).map(([k, v]) => [k, v.no]));
export const theTable = () => Object.fromEntries(Object.entries(SURFACES).map(([k, v]) => [k, v.the]));
