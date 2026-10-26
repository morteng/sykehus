/* «Nytt forslag» (U3667, Morten 15:56Z): a dialog (the kit's modal, as «Tilbakemelding» uses) to start a proposal: from the
   before or a copy of one of one's own, a name (optional), a start card, a wish. «Start» makes the version, opens it, and
   hands the first turn to Anton, which says what to do when the wish is clear or not. The text of that turn is firstTurn(). */
import { modal } from "./kit/modal.js";

export const CARDS = [
  { id: "behold", label: "Behold høyblokka", say: "Behold høyblokka og bygg rundt den.", icon: '<path d="M7 21V4h10v17"/><path d="M10 8h4M10 12h4M10 16h4"/>' },
  { id: "riv", label: "Riv og bygg nytt", say: "Riv det som står og bygg nytt.", icon: '<path d="M4 20h16"/><path d="M6 20V10l6-5 6 5v10"/><path d="M3 4l5 5M8 4L3 9"/>' },
  { id: "gront", label: "Mer grønt", say: "Mer grønt: trær, plen og planter på tomta.", icon: '<path d="M12 21v-7"/><path d="M12 14c-4 0-6-3-6-6 4 0 6 2 6 6zM12 12c0-4 2-6 6-6 0 4-2 6-6 6z"/>' },
  { id: "boliger", label: "Boliger", say: "Gjør tomta om til boliger.", icon: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>' },
  { id: "blank", label: "Blank", say: "", icon: '<rect x="5" y="4" width="14" height="16" rx="2"/>' },
];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* what Anton is told: the choices in plain words, then how to begin; no name means Anton names it when the idea is clear */
export function firstTurn({ name = "", card = "blank", wish = "", from = null }) {
  const c = CARDS.find(x => x.id === card) || CARDS[CARDS.length - 1], lines = ["Jeg har laget et nytt forslag."];
  lines.push(from ? `Det begynner som en kopi av «${from}».` : "Det begynner slik tomta står i dag.");
  if (name.trim()) lines.push(`Navnet er «${name.trim()}».`);
  if (c.say) lines.push(`Utgangspunkt: ${c.say}`);
  if (wish.trim()) lines.push(`Ønsket mitt: ${wish.trim()}`);
  lines.push("Er ønsket tydelig, så begynn å arbeide i forslaget. Er det ikke det, still høyst to spørsmål først.");
  lines.push("Si tidlig fra om grenser for regulering og vern (fredning) som gjelder tomta.");
  if (!name.trim()) lines.push("Forslaget har ikke fått navn. Gi det et kort navn selv når du vet hva det blir.");
  return lines.join("\n");
}

/* o: signedIn() says whether a person is signed in, login() opens the sign-in, create({ copy, title }) makes the version
   and opens it (returns an error text or null), say(text) hands Anton its first turn, mine() lists one's own versions,
 */
export function startNew(o) {
  const m = modal({ title: "Nytt forslag", closeLabel: "Lukk", className: "np-panel", onClose: () => { st.busy = false; } });
  const st = { card: "blank", busy: false };
  async function fill() {
    const mine = await Promise.resolve(o.mine()).catch(() => []);
    m.body.innerHTML = `<form class="np" autocomplete="off">
      <label class="np-l" for="npFrom">Begynn fra</label>
      <select id="npFrom"><option value="">Slik det står i dag</option>${mine.map(v => `<option value="${esc(v.version)}">Kopi av «${esc(v.title)}»</option>`).join("")}</select>
      <label class="np-l" for="npName">Navn (kan vente)</label>
      <input id="npName" maxlength="100" placeholder="Anton finner et navn">
      <div class="np-l" id="npCl">Utgangspunkt</div>
      <div class="np-cards" role="group" aria-labelledby="npCl">${CARDS.map(c => `<button type="button" class="np-card" data-card="${c.id}" aria-pressed="${c.id === st.card}"><svg viewBox="0 0 24 24" aria-hidden="true">${c.icon}</svg>${esc(c.label)}</button>`).join("")}</div>
      <label class="np-l" for="npWish">Hva ønsker du? (kan stå tomt)</label>
      <textarea id="npWish" rows="2" maxlength="2000" placeholder="For eksempel: Behold høyblokka, og lag et grønt tun mot sør."></textarea>
      <p class="np-s">Anton arbeider innenfor månedens ramme.</p>
      <p class="np-s">Forslaget er privat til du deler det.</p>
      <p class="np-err" id="npErr" role="alert" hidden></p>
      <div class="np-acts"><button type="submit" class="dr-p" id="npGo">Start</button><button type="button" id="npNo">Avbryt</button></div></form>`;
    const f = m.body.querySelector("form");
    for (const b of f.querySelectorAll("[data-card]")) b.onclick = () => { st.card = b.dataset.card; for (const x of f.querySelectorAll("[data-card]")) x.setAttribute("aria-pressed", String(x === b)); };
    f.querySelector("#npNo").onclick = () => m.close();
    f.onsubmit = async e => {
      e.preventDefault(); if (st.busy) return;
      const sel = f.querySelector("#npFrom"), copy = sel.value, name = f.querySelector("#npName").value.trim(), wish = f.querySelector("#npWish").value, err = f.querySelector("#npErr");
      st.busy = true; f.querySelector("#npGo").disabled = true; err.hidden = true;
      const bad = await o.create({ ...(copy ? { copy } : {}), ...(name ? { title: name } : {}), ...(wish.trim() ? { wish: wish.trim().slice(0, 2000) } : {}) });   // kept with the version (U3786): the person's words only
      if (bad) { st.busy = false; f.querySelector("#npGo").disabled = false; err.textContent = bad; err.hidden = false; return; }
      m.close(); o.say(firstTurn({ name, card: st.card, wish, from: copy ? sel.selectedOptions[0].textContent.replace(/^Kopi av «|»$/g, "") : null }));
    };
    f.querySelector("#npName").focus();
  }
  return { open() { if (!o.signedIn()) return o.login(); st.card = "blank"; m.open(); fill(); }, close: () => m.close() };
}
