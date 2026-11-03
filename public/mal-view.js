/* «Plan og snitt med mål» on the page (U3835): the measured plan and section Anton looks at (draw_plan, draw_section; drawing.js is the
   one copy), shown to the person: lengths, widths, the axis bearing and the kotes drawn in, and below the picture the same numbers
   as a list, so a skew reads as a number. Nothing here changes the draft.

   open({ site, wingOf })   site(): the model now (the draft with its edits) */
import { planDrawing, sectionDrawing } from "./drawing.js";
import { toSvg } from "./fasade.js";
import { modal } from "./kit/modal.js";
import { esc } from "./kit/html.js";

const PAPER = [251, 249, 244];
const KINDS = [["plan", "Plan"], ["across", "Snitt på tvers"], ["along", "Snitt på langs"]];

/* the drawing of a kind for a focus, or the sentence for why not */
export function draw(site, focus, kind, wingOf, size = { W: 1100, H: 700 }) {
  try {
    const d = kind === "plan" ? planDrawing(site, { focus }, wingOf, size) : sectionDrawing(site, { focus, [kind]: true }, wingOf, size);
    return { d: { ...d, paper: PAPER }, svg: toSvg({ ...d, paper: PAPER }), rows: d.dims.map(x => x.text).filter(Boolean), say: d.say };
  } catch (e) { return { error: e.message }; }
}

export function open({ site, wingOf, focus, kind = "plan" }) {
  const s0 = site(), wings = (s0.wings || []).filter(w => (s0.buildings || []).some(b => b.wing === w.id));
  let f = focus || wings[0]?.id, k = kind;
  const m = modal({ title: "Plan og snitt med mål", closeLabel: "Lukk", className: "mal-modal", onClose: () => m.el.remove() });
  m.body.innerHTML = `<div class="mal-top"><select class="mal-bygg" aria-label="Bygg">${wings.map(w => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join("")}</select>
    <span class="mal-kinds">${KINDS.map(([id, t]) => `<button type="button" data-k="${id}" aria-pressed="false">${t}</button>`).join("")}</span></div>
    <div class="mal-pic" role="img" aria-label="Tegning med mål"></div><p class="mal-say" role="status"></p><ul class="mal-rows"></ul>`;
  const sel = m.body.querySelector(".mal-bygg"), pic = m.body.querySelector(".mal-pic"), say = m.body.querySelector(".mal-say"), rows = m.body.querySelector(".mal-rows");
  sel.value = f;
  const paint = () => {
    for (const b of m.body.querySelectorAll("[data-k]")) b.setAttribute("aria-pressed", String(b.dataset.k === k));
    const r = draw(site(), f, k, wingOf);
    pic.innerHTML = r.svg || ""; say.textContent = r.error || r.say; rows.innerHTML = (r.rows || []).map(t => `<li>${esc(t)}</li>`).join("");
  };
  sel.onchange = () => { f = sel.value; paint(); };
  m.body.querySelector(".mal-kinds").onclick = e => { const b = e.target.closest("[data-k]"); if (b) { k = b.dataset.k; paint(); } };
  m.open(); paint();
  return m;
}
