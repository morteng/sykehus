/* «Vis offentlig i Prosjekter» (Morten 2026-10-27): the owner's controls for who sees a project. Pure, so a test can read them.
   Three states: privat, lenke (anyone with the link, not listed), offentlig (listed for everyone, opens without login). */
export const GLOBE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c-3 3-3 14 0 17M12 3.5c3 3 3 14 0 17"/></svg>';
export const PUBLIC_TIP = "Vis offentlig: alle som åpner sykehus.gulden.no ser prosjektet i lista";
export const LINK_ONLY_TIP = "Bare lenke: tar prosjektet ut av lista";
export const PUBLIC_NOTE = "Alle som åpner siden ser prosjektet, uten innlogging. Navnet ditt står på kortet. Fjern haken for å gjøre det til bare lenke.";
export const SHARE_TOAST = { offentlig: "Prosjektet vises nå offentlig", lenke: "Prosjektet er nå bare delt med lenke" };

/* the card's share buttons for the owner: «Del»/«Kopier lenken» (not once it is public), «Vis offentlig» or, when public, «Bare lenke», and «Gjør privat» */
export function shareActs(v, act, IC) {
  if (!v?.mine) return "";
  return `${v.sharing === "offentlig" ? "" : act("vshare", v.sharing === "lenke" ? "Kopier lenken" : "Del: kopierer en lenke", IC.link)}`
    + `${v.sharing === "offentlig" ? act("vlink", LINK_ONLY_TIP, IC.link) : act("vpub", PUBLIC_TIP, GLOBE)}`
    + `${v.sharing === "privat" ? "" : act("vpriv", "Gjør privat: lenken virker ikke lenger", IC.lock)}`;
}

/* the labelled box in the open project's share step; data-pub carries the id */
export function publicBox(v, esc = s => s) {
  if (!v?.mine && !v?.own) return "";
  return `<label class="pub-box"><input type="checkbox" data-pub="${esc(v.version)}"${v.sharing === "offentlig" ? " checked" : ""}> <span>Vis offentlig i Prosjekter</span></label><small class="pub-note">${PUBLIC_NOTE}</small>`;
}

/* what to send for a tick: sharing offentlig; an untick: lenke */
export const sharingFor = checked => (checked ? "offentlig" : "lenke");
