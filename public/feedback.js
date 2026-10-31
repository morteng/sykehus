/* «Tilbakemelding» (U3660, Morten 14:39Z «ønsker … renamed to feedback with a proper modal», 14:43Z «like fab has»): the button in the
   bar, and the kit's feedback dialog (kit/feedback.js, one copy with Fab's): what kind, the text, a picture of the page if asked,
   and what the person sent before with its status («Det du har sendt», the Ønsker list). It goes to /api/feedback (wishes.mjs), which
   files it in gulden-ai's one report store (U3978), where Fab's feedback goes too; the list reads the person's own reports back from there. */
import { feedback } from "./kit/feedback.js";
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ST = { ny: "ny", sett: "sett", laget: "laget", nei: "ikke nå" };

export const KINDS = [
  { id: "bug", label: "Feil", placeholder: "Hva gjorde du, og hva skjedde?" },
  { id: "idea", label: "Ide", placeholder: "Hva kan gjøre dette bedre? For eksempel: Jeg vil tegne et snitt gjennom drivhuset." },
  { id: "question", label: "Spørsmål", placeholder: "Hva vil du vite?" },
  { id: "other", label: "Annet", placeholder: "Skriv her." },
];
export const WORDS = {
  title: "Tilbakemelding", kindGroup: "Type", textLabel: "Tilbakemeldingen din", placeholder: "Skriv her.",
  picture: "Ta med et bilde av siden", pictureAlt: "Bildet av siden", pictureRemove: "Fjern bildet", pictureNote: "Bildet viser det som står på skjermen din, også navn og prosjekter.",
  send: "Send til Morten", sending: "Sender …", cancel: "Avbryt", close: "Lukk", left: n => `${n} tegn igjen`,
  pictureTooBig: "Bildet er for stort til å sendes. Send uten bildet.", pictureFailed: "Fikk ikke laget bildet. Send uten bildet.", tooLong: "For langt: høyst 4000 tegn.",
  notSent: "Fikk ikke sendt. Prøv igjen.", signedOut: "Logg inn for å sende tilbakemelding.",
  limit: at => `Du har sendt 10 i den siste timen.${at ? ` Du kan sende igjen etter kl. ${at}.` : ""}`,
  savedHere: "Lagret her. Det sendes når nettet er tilbake.", thanks: "Sendt. Takk!", sentLater: "Tilbakemeldingen din er sendt.",
};

export function startFeedback({ button, version, toast, page = () => ({}) }) {
  const below = document.createElement("section"); below.className = "fb-sent"; below.hidden = true;
  below.innerHTML = `<h3>Det du har sendt</h3><ul class="wishes"></ul>`;
  const ul = below.querySelector("ul");
  async function list() {
    const j = await fetch("api/onsker").then(r => r.ok ? r.json() : { wishes: [] }).catch(() => ({ wishes: [] }));
    below.hidden = !j.wishes.length;
    ul.innerHTML = j.wishes.map(w => `<li>${esc(w.text)}<br><small>${new Date(w.at).toLocaleDateString("nb-NO")}</small>
      <span class="st ${esc(w.status)}">${ST[w.status] || esc(w.status)}</span>
      ${w.note ? `<br><small>Svar: ${esc(w.note)}</small>` : ""}</li>`).join("");
  }
  return feedback({
    button, endpoint: "api/feedback", kinds: KINDS, words: WORDS, below, onOpen: list, queueKey: "sykehus-tilbakemelding-venter", toast,
    picture: undefined,
    context: () => {
      const p = page(), ctx = { page: location.pathname, ...(p.tab ? { tab: p.tab } : {}), ...(version() ? { version: String(version()) } : {}) };
      return { ctx, line: "Sendes med: " + [p.tabName, version() ? "prosjekt " + version() : "uten prosjekt"].filter(Boolean).join(" · ") };
    },
  });
}
