/* The words a person reads for the picture's camera and the sun (U3651, U3652): the kit's presets (renderkit photo.js,
   sunpick.js) carry ids and English prompt lines only; the Norwegian names, tooltips, the sun's label and its errors are
   this page's. */
export const VIEWPOINT_NO = {
  "øyehøyde": { no: "Øyehøyde", tip: "Som en person ser det, øyet 1,6 m over bakken, loddrette linjer loddrette (to-punkts perspektiv). Til byggets uttrykk fra gata." },
  "fugleperspektiv": { no: "Fugleperspektiv", tip: "Fra lufta, 30–45° ned. Viser byggene og tomta i sammenheng." },
  "aksonometri": { no: "Aksonometri", tip: "Parallellprojeksjon snudd 30°, loddrette linjer loddrette, ingen perspektiv. Som en tegning av volumene." },
  "fasade": { no: "Fasade", tip: "Rett på fasaden, uten perspektiv. Som et oppriss." },
  "froskeperspektiv": { no: "Froskeperspektiv", tip: "Lavt øye, to-punkts, ser opp. For høye bygg som høyblokka; velges aldri av seg selv." },
};
export const LOOK_NO = {
  "arkitektfoto": { no: "Arkitektfoto", tip: "Tilt-shift 24 mm, rette linjer, skarpt dagslys, nøytrale farger. Standard bygningsfoto, til presentasjon og dokumentasjon." },
  "blåtime": { no: "Blåtime", tip: "Skumring: blå himmel og varmt opplyste vinduer. Det klassiske arkitekturbildet, når bygget skal vise seg fra sin beste side." },
  "konkurransebilde": { no: "Konkurransebilde", tip: "Illustrasjon som i en arkitektkonkurranse: mykt lys, folk og planter, litt stemning, i øyehøyde. For å selge en idé." },
  "drone": { no: "Drone / fugleperspektiv", tip: "24–35 mm fra lufta, skarpt, med omgivelsene i bildet. For tomta og volumene i sammenheng." },
  "hvitmodell": { no: "Hvit modell", tip: "Hvit gipsmodell: myke skygger, ingen teksturer. For volumstudier og når formen skal leses uten materialer." },
  "skisse": { no: "Skisse", tip: "Håndtegnet strek og akvarell over samme bilde. For tidlig fase og en løs stemning." },
};
export const SIZE_NO = { "1K": "Utkast", "2K": "Standard", "4K": "Stor" };
const MONTH = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
const hourWord = h => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `kl. ${hh}${mm ? ":" + String(mm).padStart(2, "0") : ""}`; };
export const sunLabel = s => `${s.sunD}. ${MONTH[s.sunM - 1]} ${hourWord(s.sunH)}`;
/* sunOf's error code (renderkit sunpick.js) in plain Norwegian, for Anton */
export const sunError = e => ({
  sun_unreadable: "Sola kan ikke leses: bruk for eksempel 2026-12-21T15:00, eller {month: 12, day: 21, hour: 15}.",
  sun_missing: "Sola trenger en dato og et klokkeslett: {month, day, hour} eller en tid som 2026-12-21T15:00.",
  sun_range: "Datoen eller klokkeslettet for sola finnes ikke (måned 1-12, dag i måneden, time 0-24).",
}[e?.code] || "Sola kan ikke leses.");
/* the lenses and picture shapes of the photo mode (U3663): the ids are renderkit photoframe.js'; the words are this page's */
export const LENS_NO = {
  "24": { no: "24 mm", tip: "Vidvinkel: mye av stedet med, gode rette linjer. Til bygget fra gata og til rom." },
  "35": { no: "35 mm", tip: "Litt vid, som øyet ser det: det vanlige valget." },
  "50": { no: "50 mm", tip: "Normal: lite vridning, rolig bilde av én fasade." },
  "85": { no: "85 mm", tip: "Tele: trekker bygget nær og flater ut dybden. Til detaljer og siluett." },
  "iphone": { no: "iPhone", tip: "Som hovedkameraet på en iPhone (26 mm): bildet slik et vanlig mobilbilde ser ut." },
  "drone": { no: "Drone", tip: "Fra lufta, vid linse (24 mm): tomta og omgivelsene i ett bilde." },
};
export const ASPECT_NO = { "3:2": "3:2 foto", "16:9": "16:9 bred", "1:1": "1:1 kvadrat", "4:5": "4:5 stående", "2:3": "2:3 høy" };
