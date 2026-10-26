/* «Omvisning» (U3528, Morten 2026-10-25 17:26Z «make a guided tour interactive thingy for him»): a short walk through
   the page, one thing at a time, with the words on screen: the model, the three ways of looking, the storeys, the
   names, a building's card, a new building, Anton, drawing, the proposal and how it is shared, the saved views. A
   light falls on the part spoken of, the rest is dimmed; «Neste», «Tilbake», arrow keys, Esc to end. A step whose part
   is not on the page (Anton's pill signed out, «Visninger» with no proposal) is passed over. It offers itself once, on
   the first visit; «?» in the bar starts it again. */

const SEEN = "sykehus-omvisning", SEEN_IN = "sykehus-omvisning-inn";
/* U3658 (Morten 14:09Z «visitors get simpler onboarding tour than when they log in»): two lists from one engine. A visitor
   (signed out) gets a short one that ends on «Logg inn»; a signed-in person the full one. Each step says since which
   version of the full tour it is there (VERSION 2: the keys, the sun, «Gjengi», «Mal», the conversation over the pill, the
   panel's width, deleting saved proposals), so a person who saw the full tour at version 1 gets only the newer steps, once.
   Marks in storage: SEEN is «sett» (the one tour there was before: the full list, version 1) or «gjest» (the visitor list);
   SEEN_IN the version of the full list seen. */
export const VERSION = 2;
/** Which tour a person gets and whether it offers itself: kind «gjest», «full» or «nytt» (the steps since the version seen). */
export function tourFor({ signedIn, seen = null, seenIn = null }) {
  if (!signedIn) return { kind: "gjest", due: !seen };
  const inn = Number.isFinite(+seenIn) && seenIn !== null ? +seenIn : seen === "sett" ? 1 : 0;
  return inn >= VERSION ? { kind: "full", due: false } : inn === 0 ? { kind: "full", due: true } : { kind: "nytt", due: true, since: inn };
}
const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

/* the steps: el, the part (a selector, or a function giving the element; none: the card in the middle); before, what
   the page does first (the view home, a building picked, the panel's tab) */
export function steps(h) {
  const all = [
    { title: "Velkommen til Sykehustomta", text: "Her er Gamle Drammen sykehus slik det står i dag, bygget opp fra arkivets tegninger, laserdata og kart. Du kan se på alt, prøve endringer og lage ditt eget forslag til hvordan tomta kan bli. Omvisningen tar et par minutter.", before: () => h.home() },
    { el: "#view", title: "Modellen", text: "Dra med fingeren eller musa for å snu modellen. Rull, eller knip med to fingre, for å gå nærmere. Trykk på et bygg for å velge det." },
    { el: () => document.getElementById("m3d")?.parentElement, title: "Tre måter å se på", text: "3D er perspektiv fra luften. Gateplan er slik en som står på bakken ser det, med øyet 1,7 m over terrenget: dra for å se deg rundt, gå med W A S D eller piltastene, eller dra den lille mannen ved zoomknappene dit du vil stå. Plan er rett ovenfra, nord opp, med målestokk, og kan skrives ut." },
    { el: "#levels", title: "Etasjene", text: "Velg en etasje her. Da kuttes alle fløyene 1,2 m over gulvet, som på en plantegning, med vegger, rom og arealer der tegningene finnes. «Hele anlegget» tar deg tilbake." },
    { el: "#names", title: "Navn", text: "Viser navnene på fløyene over modellen. Tasten N gjør det samme." },
    { el: () => h.phone() ? document.getElementById("tab-selected") : document.getElementById("p-selected"), title: "Et bygg", text: "Når du trykker på et bygg, kommer opplysningene om det her: byggeår, etasjer, konstruksjon og kote. Herfra kan du rive det, endre opplysningene eller spørre Anton om det. Alt kan angres.", before: () => h.pick() },
    { el: () => visible(document.getElementById("byggActs")) || !h.phone() ? document.getElementById("byggActs") : document.getElementById("tab-selected"), title: "Nytt bygg og Hent fil", text: "I «Bygg» setter du et nytt bygg på tomta: trykk «Nytt bygg» og så der det skal stå. «Hent fil» setter en modell fra en produsent på tomta. Du kan flytte det, snu det og endre høyde og etasjer. Tomta planeres rundt det, og du ser hvor mye som graves ut og fylles opp." , before: async () => { h.pick(); await new Promise(ok => requestAnimationFrame(ok)); document.getElementById("byggActs")?.scrollIntoView({ block: "center" }); } },
    { since: 2, el: "#sunBtn", title: "Sola", text: "Velg dato og klokkeslett, så faller lyset og skyggen som de gjør da. Slik ser du hva et nytt bygg gjør med sola på nabohusene." },
    { since: 2, el: "#mgj", title: "Gjengi", text: "Gjør det du ser nå til et realistisk bilde. Velg kamera, utseende og størrelse. Prisen står her før du bestiller, og bildet blir i listen under." },
    { el: () => visible(document.getElementById("talk-form")) ? document.getElementById("talk-form") : document.getElementById("tab-chat"), title: "Anton", text: "Anton er en assistent som kjenner tomta, tegningene og planene. Skriv eller snakk som til en kollega: «Riv Østfløy og sett et drivhus mot sør», «Hva sier reguleringsplanen om høyder?», «Vis meg fasaden mot Dronninggata». For å snakke med Anton må du være logget inn.", before: () => h.unpick() },
    { since: 2, el: () => visible(document.querySelector(".g-chat")) ? document.querySelector(".g-chat") : document.getElementById("talk-form"), title: "Samtalen over feltet", text: "Når du har skrevet med Anton, står samtalen over feltet. Dra i kanten øverst for å gjøre den høyere eller lavere, eller trykk på pila for å bare se det siste svaret. «Ny samtale» tømmer den, så Anton glemmer det dere har snakket om og nytt arbeid starter rent." },
    { el: "#talkTegn", title: "Tegn", text: "Tegn med fingeren eller pennen rett på det du ser, en skisse eller en strek der noe skal stå, og send den til Anton, som gjør den om til en endring." },
    { el: () => h.phone() ? document.getElementById("tab-changes") : document.getElementById("p-changes"), title: "Forslaget ditt", text: "Alt du endrer lagres med en gang i ditt eget forslag. Her ser du endringene, og kan ta dem ut igjen én for én. Ingen andre ser forslaget før du trykker «Del», og «Gjør privat» tar det tilbake.", before: () => h.tab("changes") },
    { since: 2, el: () => h.phone() ? null : document.querySelector("#right .g-split"), before: () => h.tab("changes"), title: "Bredden på panelet", text: "Dra i kanten til venstre for panelet for å gjøre det bredere eller smalere. Dobbeltklikk setter det tilbake." },
    { since: 2, el: "#verSel", before: () => h.tab("changes"), title: "Slett lagrede forslag", text: "Trykk «Velg», merk forslagene du ikke trenger, og trykk «Slett valgte». De ligger en stund i papirkurven." },
    { el: "#viewsBtn", title: "Visninger og bildeserie", text: "Lagre det du ser som en visning du kan gå tilbake til. Anton kan også sette sammen en bildeserie som forklarer forslaget, med før og etter, som du kan vise eller skrive ut." },
    { since: 2, el: "#mmal", title: "Mal", text: "Mal gress, belegg, bed eller grus på bakken: trykk langs der penselen skal gå. Angre tar det bort igjen." },
    { since: 2, el: "#view", title: "Slett og angre med tastene", text: "Trykk Delete eller Backspace for å fjerne det du har valgt. Cmd-Z (Ctrl-Z) tar tilbake, og Shift-Cmd-Z (Ctrl-Y) gjør det igjen." },
    { el: "#tourBtn", title: "Det var alt", text: "Du finner omvisningen igjen her, når du vil. Lykke til med tomta!" },
  ];
  return all;
}
/* the visitor's short list: the same words for the model, the views and the storeys, then the way in */
export function visitorSteps(h) {
  const s = steps(h), by = t => s.find(x => x.title === t);
  return [
    { ...by("Velkommen til Sykehustomta"), text: "Her er Gamle Drammen sykehus slik det står i dag, bygget opp fra arkivets tegninger, laserdata og kart. Du kan se på alt. Omvisningen tar et minutt." },
    by("Modellen"), by("Tre måter å se på"), by("Etasjene"),
    { el: () => document.getElementById("meBtn") || document.getElementById("me"), title: "Logg inn", text: "Logg inn for å snakke med Anton og lage ditt eget forslag til hvordan tomta kan bli." },
  ];
}
/* the list for a kind: «nytt» is the intro and the steps newer than the version seen, then the end */
export function listFor(kind, h, since = 0) {
  if (kind === "gjest") return visitorSteps(h);
  const s = steps(h);
  if (kind === "full") return s;
  return [{ title: "Nytt siden sist", text: "Her er det som er kommet til siden forrige gang du var her." }, ...s.filter(x => (x.since || 1) > since), s[s.length - 1]];
}

export function createTour(h) {
  let at = -1, list = [], plan = [], root = null, hole = null, card = null;
  const read = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const now = () => tourFor({ signedIn: !!h.signedIn?.(), seen: read(SEEN), seenIn: read(SEEN_IN) });
  let kind = "full";
  const keep = () => { try { if (kind === "gjest") { if (!localStorage.getItem(SEEN)) localStorage.setItem(SEEN, "gjest"); } else localStorage.setItem(SEEN_IN, String(VERSION)); } catch { } };
  const elOf = s => !s.el ? null : typeof s.el === "function" ? s.el() : document.querySelector(s.el);
  function build() {
    root = document.createElement("div"); root.className = "tour"; root.innerHTML = `<div class="tour-hole"></div>
      <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tourTitle" aria-describedby="tourText">
        <div class="tour-top"><span class="tour-n" id="tourN"></span><button type="button" class="tour-x" id="tourX" aria-label="Avslutt omvisningen" title="Avslutt (Esc)">×</button></div>
        <h2 id="tourTitle"></h2><p id="tourText"></p>
        <div class="tour-acts"><button type="button" id="tourBack">Tilbake</button><button type="button" class="go" id="tourNext">Neste</button></div>
      </div>`;
    document.body.append(root); hole = root.querySelector(".tour-hole"); card = root.querySelector(".tour-card");
    root.querySelector("#tourX").onclick = end; root.querySelector("#tourBack").onclick = () => go(at - 1, -1); root.querySelector("#tourNext").onclick = () => go(at + 1, 1);
    root.addEventListener("pointerdown", e => { if (!e.target.closest(".tour-card")) e.preventDefault(); });
    addEventListener("resize", place); addEventListener("keydown", key, true);
  }
  function key(e) {
    if (at < 0) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); go(at + 1, 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(at - 1, -1); }
  }
  /* the light on the part, the card beside it where there is room: under, over, right of, left of, else in the middle */
  function place() {
    if (at < 0) return;
    const el = elOf(list[at]), W = innerWidth, H = innerHeight, cw = Math.min(340, W - 24), pad = 6;
    card.style.width = cw + "px";
    const ch = card.offsetHeight;
    if (!el) { hole.style.cssText = `left:${W / 2}px;top:${H / 2}px;width:0;height:0`; card.style.left = (W - cw) / 2 + "px"; card.style.top = Math.max(12, (H - ch) / 2) + "px"; return; }
    const r = el.getBoundingClientRect(), x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad), w = Math.min(W - 8, r.right + pad) - x, hh = Math.min(H - 8, r.bottom + pad) - y;
    hole.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${hh}px`;
    const clampX = v => Math.max(12, Math.min(W - cw - 12, v)), clampY = v => Math.max(12, Math.min(H - ch - 12, v));
    const big = w * hh > W * H * 0.4;   // the whole model: the card over it, low in the middle
    let left, top;
    if (big) { left = (W - cw) / 2; top = H - ch - 96; }
    else if (y + hh + 12 + ch < H) { left = clampX(x); top = y + hh + 12; }
    else if (y - 12 - ch > 0) { left = clampX(x); top = y - 12 - ch; }
    else if (x + w + 12 + cw < W) { left = x + w + 12; top = clampY(y); }
    else if (x - 12 - cw > 0) { left = x - 12 - cw; top = clampY(y); }
    else { left = (W - cw) / 2; top = (H - ch) / 2; }
    card.style.left = clampX(left) + "px"; card.style.top = clampY(top) + "px";
  }
  async function go(i, dir = 1) {
    if (i >= list.length) return end(true);
    if (i < 0) return;
    const s = list[i];
    try { await s.before?.(); } catch { }
    await new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok)));
    if (s.el && !visible(elOf(s))) return go(i + dir, dir);   // not on the page now: the next one
    at = i;
    if (!plan.includes(i)) plan = [...plan, i].sort((a, b) => a - b);
    root.querySelector("#tourN").textContent = `${plan.indexOf(i) + 1} av ${plan.length}`;
    root.querySelector("#tourTitle").textContent = s.title; root.querySelector("#tourText").textContent = s.text;
    root.querySelector("#tourBack").hidden = i === 0;
    root.querySelector("#tourNext").textContent = i === list.length - 1 ? "Ferdig" : "Neste";
    root.hidden = false; place(); root.querySelector("#tourNext").focus({ preventScroll: true });
  }
  function end() { at = -1; if (root) root.hidden = true; keep(); h.done?.(); }
  return {
    /* the count is made once: the steps whose part is on the page now, or that put it there first (before) */
    start(auto = false) { const t = now(); kind = auto || t.kind === "gjest" ? t.kind : "full"; list = listFor(kind, h, t.since || 0); plan = list.map((s, k) => k).filter(k => !list[k].el || list[k].before || visible(elOf(list[k]))); if (!root) build(); go(0); },
    end, get on() { return at >= 0; },
    /* the first visit: once, the page ready */
    get due() { return now().due; },
  };
}
