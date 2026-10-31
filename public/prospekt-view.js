/* Prospekt's markup from the server's answer (api/prospekt/<id>, prospekt.mjs). Pure, so a test can read it. Text in bokmål; every value escaped.
   Laid out as a brochure: a full-bleed hero with the title, a facts column beside the pictures, captions, the plot's limits last. Pictures only: no live 3D. */
export const esc = s => kitEsc(s ?? ""); // null-safe; the escaping is the kit's (kit/html.js)
const nb = (n, d = 0) => Number(n).toLocaleString("nb-NO", { maximumFractionDigits: d });
const kote = k => (k == null ? "" : `+${nb(k, 1)}`);
const day = t => new Date(t).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });
/* the picture viewer's markup, once: the viewing area mounts it beside the page (prospekt-pane.js) */
import { ownPictureHTML } from "./kit/picture.js";
import { esc as kitEsc } from "./kit/html.js";
export const LIGHTBOX_HTML = `<div class="pk-lb" data-pklb hidden role="dialog" aria-modal="true" aria-label="Bilde"><button type="button" class="pk-lb-x" data-x aria-label="Lukk">×</button><button type="button" class="pk-lb-n pk-lb-p" data-p aria-label="Forrige bilde">‹</button><img data-img alt=""><button type="button" class="pk-lb-n pk-lb-f" data-n aria-label="Neste bilde">›</button><div class="pk-lb-b"><span data-cap></span><a data-dl download>Last ned</a></div></div>`;
export const GONE = `<div class="pk-gone"><h1>Fant ikke prospektet</h1><p>Prosjektet finnes ikke, eller det er ikke delt. Be eieren om en lenke, eller se <a href="./">de delte prosjektene</a>.</p></div>`;

/* every picture in the order the lightbox steps through: the renders (hero first), then the stills of the model */
export function figures(j) {
  const r = j.renders.map(x => ({ url: x.url, caption: `Gjengitt bilde, ${day(x.at)}`, kind: "render", id: x.id })), s = (j.stills || []).map(x => ({ url: x.url, caption: x.title, kind: "still" }));
  return [...r, ...s];
}
export function factsHtml(j) {
  const n = j.numbers || {}, vols = n.volumes || [], top = vols.reduce((m, v) => v.top_kote != null ? Math.max(m, v.top_kote) : m, -Infinity), most = vols.reduce((m, v) => Math.max(m, v.storeys || 0), 0);
  const row = (k, v, how) => v == null || v === "" ? "" : `<div><dt>${k}</dt><dd>${v}${how ? `<small>${how}</small>` : ""}</dd></div>`;
  return `<dl class="pk-facts">`
    + row("Nye bygg", vols.length ? String(vols.length) : "Ingen nye bygg")
    + row("BRA", n.bra_m2 == null ? "ikke oppgitt" : `${nb(n.bra_m2)} m²`, n.bra_m2 == null ? "ingen kildebelagt faktor" : "beregnet")
    + row("BTA", vols.length ? `${nb(n.bta_m2)} m²` : null, "beregnet")
    + row("Etasjer", most ? `inntil ${most}` : null)
    + row("Høyeste kote", Number.isFinite(top) ? `${kote(top)} m` : null, "beregnet")
    + row("Revet", n.demolished?.count ? `${nb(n.demolished.footprint_m2)} m²` : "ingenting", n.demolished?.count ? `${n.demolished.count} bygg, ${nb(n.demolished.gross_volume_m3)} m³` : "")
    + row("Eier", esc(j.owner)) + row("Sist endret", esc(day(j.updated))) + `</dl>`;
}
export function volumesHtml(n) {
  const vols = n?.volumes || []; if (!vols.length) return "";
  return `<table class="pk-vols"><thead><tr><th>Bygg</th><th class="num">Etasjer</th><th class="num">Fotavtrykk</th><th class="num">BTA</th><th>Kote, m o.h.</th></tr></thead><tbody>${vols.map(v =>
    `<tr><td>${esc(v.name)}</td><td class="num">${v.storeys}</td><td class="num">${nb(v.footprint_m2)} m²</td><td class="num">${nb(v.bta_m2)} m²</td><td>${v.foot_kote == null ? "" : `fot ${kote(v.foot_kote)}, topp ${kote(v.top_kote)}`}${v.storey_kotes?.length ? `<small>etasjer ${v.storey_kotes.map(kote).join(" · ")}</small>` : ""}</td></tr>`).join("")}</tbody></table>`;
}
export function limitsHtml(limits, say) {
  if (!limits?.length) return `<p class="pk-note">${esc(say || "Ingen begrensninger funnet i kartene vi leser.")}</p>`;
  return `<ul class="pk-lim">${limits.map(l => `<li><span>${esc(l.line)}</span><small>${esc(l.how)}</small></li>`).join("")}</ul>`;
}
const fig = (f, i, cls = "") => `<figure class="pk-fig${cls}"><button type="button" data-lb="${i}" aria-label="Se bildet større: ${esc(f.caption)}">${ownPictureHTML(f.url, { w: 480, alt: f.caption })}</button><figcaption>${esc(f.caption)}</figcaption></figure>`;

export function prospektHtml(j, { links = {} } = {}) {
  const all = figures(j), heroAt = Math.max(0, all.findIndex(f => f.id === j.hero)), hero = all[heroAt];
  const renders = all.filter((f, i) => f.kind === "render" && i !== heroAt), stills = all.filter((f, i) => f.kind === "still" && i !== heroAt), at = f => all.indexOf(f);
  return `<header class="pk-hero${hero ? "" : " none"}">${hero ? `<button type="button" class="pk-hero-img" data-lb="${heroAt}" aria-label="Se bildet større">${ownPictureHTML(hero.url, { w: 1024, alt: hero.caption, eager: true })}</button>` : ""}`
      + `<div class="pk-hero-t"><p class="pk-kick">Prospekt · Gamle Drammen sykehus</p><h1>${esc(j.title)}</h1><p class="pk-by">Av ${esc(j.owner)}</p>`
      + `<p class="pk-go">${links.explore ? `<a class="pk-btn" data-explore href="${esc(links.explore)}">Utforsk i 3D</a>` : ""}${links.edit ? `<a class="pk-btn quiet" href="${esc(links.edit)}">Åpne i redigering</a>` : ""}</p></div></header>`
    + `<div class="pk-body"><aside class="pk-side"><h2>Fakta</h2>${factsHtml(j)}<p class="pk-how">${esc(j.numbers?.how)}</p></aside>`
    + `<div class="pk-main">`
    + (renders.length ? `<section class="pk-sec"><h2>Bilder</h2><div class="pk-gal">${renders.map((f, k) => fig(f, at(f), k === 0 && renders.length % 2 === 1 ? " wide" : "")).join("")}</div></section>` : "")
    + (stills.length ? `<section class="pk-sec"><h2>Modellen</h2><div class="pk-gal">${stills.map((f, k) => fig(f, at(f), k === 0 ? " wide" : "")).join("")}</div></section>` : "")
    + (volumesHtml(j.numbers) ? `<section class="pk-sec"><h2>Byggene</h2>${volumesHtml(j.numbers)}</section>` : "")
    + `<section class="pk-sec"><h2>Tomta og begrensninger</h2>${limitsHtml(j.limits, j.limits_say)}<p class="pk-how">Kartene er til tidlig vurdering, ikke en avgjørelse. Bildene er laget av en bildemodell ut fra 3D-modellen: de er ikke tegninger eller byggesøknad.</p></section>`
    + `</div></div><footer class="pk-foot"><a href="./">Laget med Sykehustomta</a></footer>`;
}
