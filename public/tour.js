/* «Omvisning» (U3528, Morten 2026-10-25 17:26Z «make a guided tour interactive thingy for him»): a short walk through
   the page, one thing at a time, with the words on screen: the model, the three ways of looking, the storeys, the
   names, a building's card, a new building, Anton, drawing, the proposal and how it is shared, the saved views. A
   light falls on the part spoken of, the rest is dimmed; «Neste», «Tilbake», arrow keys, Esc to end. A step whose part
   is not on the page (Anton's pill signed out, «Visninger» with no proposal) is passed over. It offers itself once, on
   the first visit; «?» in the bar starts it again. */

import { createGuide, tourList, whichTour, cookieStore } from "./kit/tour.js?v=u3811";   // the engine, the rule, the lists and the cookies are the kit's (U3658, U3811)

/* U3658 (Morten 14:09Z «visitors get simpler onboarding tour than when they log in», 14:24Z «the guide popup should set a
   cookie to not show again if it has been x-ed once»): two lists from one engine. A visitor (signed out) gets a short
   one that ends on «Logg inn»; a signed-in person the full one. Each step says since which version of the full tour it is
   there (VERSION 2: the keys, the sun, «Gjengi», «Mal», the conversation over the pill, the panel's width, deleting
   saved proposals), so a person who saw the full tour at version 1 gets only the newer steps, once. Closing with the ×
   (or Esc) is remembered and it does not open by itself again. Kept in first-party cookies, and for a signed-in person on
   the person too (guide.mjs), so it holds on every device. Visitor and signed-in have their own keys:
     guide_seen=1      the visitor tour was seen or closed
     guide_in=<n>      the version of the full tour seen;  guide_x=1  the full tour was closed with the ×
   The one mark before (localStorage «sykehus-omvisning» = «sett», the one tour there was: version 1) still counts. */
export const VERSION = 2;
const LEGACY = "sykehus-omvisning";
const legacy = () => { try { return localStorage.getItem(LEGACY); } catch { return null; } };
/** The marks the browser holds, and (signed in) the person's own from the server, as whichTour takes them. */
export function marks(server = null, doc = document) {
  const c = cookieStore(doc).read();
  const inn = Math.max(c.seenIn || 0, server?.seenIn || 0, legacy() === "sett" ? 1 : 0);
  return { seen: c.seen || legacy() != null, seenIn: inn || null, dismissed: c.dismissed || !!server?.dismissed };
}
/** Which tour a person gets and whether it offers itself: kind «gjest», «full» or «nytt» (the steps since the version seen). */
export const tourFor = ({ signedIn, seen = false, seenIn = null, dismissed = false }) => whichTour({ signedIn, seen, seenIn, dismissed, version: VERSION });

const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

/* the steps: el, the part (a selector, or a function giving the element; none: the card in the middle); before, what
   the page does first (the view home, a building picked, the panel's tab) */
export function steps(h) {
  const all = [
    { title: "Velkommen til Sykehustomta", text: "Her er Gamle Drammen sykehus slik det står i dag, bygget opp fra arkivets tegninger, laserdata og kart. Du kan se på alt, prøve endringer og lage ditt eget forslag til hvordan tomta kan bli. Omvisningen tar et par minutter.", before: () => h.home() },
    { el: "#view", title: "Modellen", text: "Dra med fingeren eller musa for å snu modellen. Rull, eller knip med to fingre, for å gå nærmere. Trykk på et bygg for å velge det." },
    { el: () => document.getElementById("m3d")?.parentElement, title: "Tre måter å se på", text: "3D er perspektiv fra luften. Gateplan er slik en som står på bakken ser det, med øyet 1,7 m over terrenget: dra for å se deg rundt, gå med W A S D eller piltastene, eller dra den lille mannen ved zoomknappene dit du vil stå. Plan er rett ovenfra, nord opp, med målestokk, og kan skrives ut." },
    { el: "#flr", title: "Etasjene", text: "Velg en etasje her, eller gå opp og ned med pilene. Da kuttes alle fløyene 1,2 m over gulvet, som på en plantegning, med vegger, rom og arealer der tegningene finnes. «Hele anlegget» tar deg tilbake." },
    { el: "#names", title: "Navn", text: "Viser navnene på fløyene over modellen. Tasten N gjør det samme." },
    { el: () => h.phone() ? document.getElementById("tab-selected") : document.getElementById("p-selected"), title: "Et bygg", text: "Når du trykker på et bygg, kommer opplysningene om det her: byggeår, etasjer, konstruksjon og kote. Herfra kan du rive det, endre opplysningene eller spørre Anton om det. Alt kan angres.", before: () => h.pick() },
    { el: () => visible(document.getElementById("byggActs")) || !h.phone() ? document.getElementById("byggActs") : document.getElementById("tab-selected"), title: "Nytt bygg og Hent fil", text: "I «Bygg» setter du et nytt bygg på tomta: trykk «Nytt bygg» og så der det skal stå. «Hent fil» setter en modell fra en produsent på tomta. Du kan flytte det, snu det og endre høyde og etasjer. Tomta planeres rundt det, og du ser hvor mye som graves ut og fylles opp." , before: async () => { h.pick(); await new Promise(ok => requestAnimationFrame(ok)); document.getElementById("byggActs")?.scrollIntoView({ block: "center" }); } },
    { since: 2, el: "#sunBtn", title: "Sola", text: "Velg dato og klokkeslett, så faller lyset og skyggen som de gjør da. Slik ser du hva et nytt bygg gjør med sola på nabohusene." },
    { since: 2, el: "#tab-photo", title: "Gjengi", text: "Fanen etter Anton: fotomodus. Visningen blir søkeren på et kamera: velg linse og bildeform nederst, se rammen og horisonten, og dra kameraet i det lille kartet. Den store knappen sier prisen før du tar bildet. Stedene du har tatt bilder fra ligger under «Mine bildesteder»; der kan du gå tilbake og ta et nytt etter at modellen er endret." },
    { el: () => visible(document.getElementById("talk-form")) ? document.getElementById("talk-form") : document.getElementById("tab-chat"), title: "Anton", text: "Anton er en assistent som kjenner tomta, tegningene og planene. Skriv eller snakk som til en kollega: «Riv Østfløy og sett et drivhus mot sør», «Hva sier reguleringsplanen om høyder?», «Vis meg fasaden mot Dronninggata». For å snakke med Anton må du være logget inn.", before: () => h.unpick() },
    { since: 2, el: () => document.getElementById("tab-chat"), title: "Samtalen", text: "Når du har skrevet med Anton, står samtalen i «Anton»-fanen. Over feltet står bare en linje med det Anton gjør nå, og så første setning av svaret; «Les mer» åpner fanen. «Ny samtale» starter en ny samtale. Anton kan slå opp i de gamle når du viser til dem." },
    { el: "#talkTegn", title: "Tegn", text: "Tegn med fingeren eller pennen rett på det du ser, en skisse eller en strek der noe skal stå, og send den til Anton, som gjør den om til en endring." },
    { el: () => h.phone() ? document.getElementById("tab-changes") : document.getElementById("p-changes"), title: "Forslaget ditt", text: "Alt du endrer lagres med en gang i ditt eget forslag. Her ser du endringene, og kan ta dem ut igjen én for én. Ingen andre ser forslaget før du trykker «Del», og «Gjør privat» tar det tilbake.", before: () => h.tab("changes") },
    { since: 2, el: () => h.phone() ? null : document.querySelector("#right .g-split"), before: () => h.tab("changes"), title: "Bredden på panelet", text: "Dra i kanten til venstre for panelet for å gjøre det bredere eller smalere. Dobbeltklikk setter det tilbake." },
    { since: 2, el: "#verSel", before: () => h.tab("changes"), title: "Slett lagrede forslag", text: "Trykk «Velg», merk forslagene du ikke trenger, og trykk «Slett valgte». De ligger en stund i papirkurven." },
    { el: "#viewsBtn", title: "Visninger og bildeserie", text: "Lagre det du ser som en visning du kan gå tilbake til. Anton kan også sette sammen en bildeserie som forklarer forslaget, med før og etter, som du kan vise eller skrive ut." },
    { since: 2, el: "#mmal", title: "Mal", text: "Mal gress, belegg, bed eller grus på bakken: trykk langs der penselen skal gå. Angre tar det bort igjen." },
    { since: 2, el: "#view", title: "Slett og angre med tastene", text: "Trykk Delete eller Backspace for å fjerne det du har valgt. Cmd-Z (Ctrl-Z) tar tilbake, og Shift-Cmd-Z (Ctrl-Y) gjør det igjen." },
    { since: 2, el: "#mfb", title: "Tilbakemelding", text: "Noe som ikke virker, en ide eller et spørsmål? Send det her, så ser Morten det. Du kan ta med et bilde av siden, og se hva du har sendt før." },
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
    { el: () => document.getElementById("meBtn") || document.getElementById("me"), title: "Logg inn", text: "Logg inn med koden du har fått av Morten, så kan du lage ditt eget forslag til hvordan tomta kan bli, og få hjelp til det." },
  ];
}
/* the list for a kind: «nytt» is the intro and the steps newer than the version seen, then the end */
export function listFor(kind, h, since = 0) {
  if (kind === "gjest") return visitorSteps(h);
  return tourList(kind, { full: steps(h), since, intro: NYTT });
}
const NYTT = { title: "Nytt siden sist", text: "Her er det som er kommet til siden forrige gang du var her." };

export function createTour(h) {
  let server = null;   // the person's own marks (guide.mjs), once read
  const cookies = cookieStore(document);
  const store = {   // the kit's store: the cookies and the one mark from before, and for a signed-in person the server first
    read: () => marks(server),
    write: (kind, how, version) => {
      cookies.write(kind, how, version);
      if (h.signedIn?.()) fetch("api/guide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(kind === "gjest" ? {} : { seenIn: version, dismissed: how === "x" }) }).catch(() => { });
    },
    async load() { const r = await fetch("api/guide"); if (r.ok) server = await r.json(); },
  };
  return createGuide({
    version: VERSION, signedIn: () => !!h.signedIn?.(), full: () => steps(h), visitor: () => visitorSteps(h), intro: NYTT, store,
    words: { count: (n, m) => `${n} av ${m}`, back: "Tilbake", next: "Neste", done: "Ferdig", close: "Lukk guiden", closeTitle: "Lukk guiden (Esc). Den åpner ikke av seg selv igjen" },
    onEnd: () => h.done?.(),
  });
}
