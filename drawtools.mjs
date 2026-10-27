/* T5: draw_plan and draw_section, the two tools that draw a measured plan or section (public/drawing.js) as a PNG for Anton to
   look at (the same image content look makes). mcp.mjs spreads drawTools(...) into TOOLS; the logic is in drawing.js. */
import { planDrawing, sectionDrawing } from "./public/drawing.js";
import { rasterize } from "./drawing-png.mjs";

export function drawTools({ S, WING, TARGET, OLD, model, wingOf, toolErr }) {
  const FOCUS = { type: "string", description: "A wing (name or id) or a new part (id or name)" };
  const SCALE = { type: "number", minimum: 10, maximum: 100000, description: "The scale as a number, 200 for 1:200; left out, it fits the picture" };
  const SIZE = { width: { type: "integer", minimum: 640, maximum: 1600 }, height: { type: "integer", minimum: 400, maximum: 1000 } };
  const make = (kind, fn) => async (a, req) => {
    const m = model(a.draft, req), o = a;
    let d; try { d = fn(m.site, o, wingOf, { W: a.width || 1280, H: a.height || 800 }); } catch (e) { throw toolErr(e.message); }
    const png = rasterize(d.prims, d.W, d.H);
    return { _result: { content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }, { type: "text", text: d.say }],
      structuredContent: { drawn: kind, scale: `1:${d.scale}`, dimensions: d.dims.map(({ kind: k, value, text }) => ({ kind: k, value_m: value, text })), kotes: d.kotes, ...(d.cut ? { cut: d.cut, levels: d.levels, crossed: d.crossed } : {}), say: d.say } } };
  };
  return [
    { name: "draw_plan", tgt: "read", title: "Tegn plan med mål", ro: true, schema: S({ focus: FOCUS, scale: SCALE, balconies: { type: "boolean" }, at: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: "[east, north] in site m: zoom on this point (a corner of the roof edge) at the scale, default 1:200; then it need not fit the whole wing" }, target: TARGET, draft: OLD, ...SIZE }, ["focus"]),
      description: "A measured plan drawing for you to look at: the focus wing's roof (each level in its tone, with its kote) or a new part, its outline with dimension lines (the same length, width and axis bearing as measure), the axis, each roof level's edge in its own colour with its kote, north up, a scale bar and the buildings round it. With at (and scale) it zooms on that point. The person does not see it. Quote say. Nothing is changed.",
      run: make("plan", planDrawing) },
    { name: "draw_section", tgt: "read", title: "Tegn snitt med kote", ro: true, schema: S({ wing: { ...WING, description: "The wing to cut" }, part: { type: "string", description: "A new part (id or name) to cut, instead of wing" }, across: { type: "boolean", description: "Across the wing or part, through its middle" }, along: { type: "boolean", description: "Along it, through its middle" }, line: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, minItems: 2, maxItems: 2, description: "Your own cut line [[east, north], [east, north]] in site m, left to right" }, scale: SCALE, target: TARGET, draft: OLD, ...SIZE }),
      description: "A measured section drawing for you to look at: the cut through a wing or new part with the ground, every roof level and its kote, the storeys' kote, dimension lines, the centre axis, and which way north lies. With none of across, along or line it picks the cut that goes through most of the roof's levels. It is a cut, not a facade: no facade drawing exists in the data (say so if asked). The person does not see it. Quote say (the kotes, the heights between them). Nothing is changed.",
      run: (a, req) => { const focus = a.part || a.wing; if (!focus) throw toolErr("Si hvilken fløy (wing) eller hvilket nytt bygg (part) snittet skal gå gjennom"); return make("section", sectionDrawing)({ ...a, focus }, req); } },
  ];
}
