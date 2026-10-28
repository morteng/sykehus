/* One copy of how a complex tool opens as its own surface, not inside the chat (Morten 2026-10-28: «surface them as miniapps»).
   registerMiniapp(id, { open(preset, keep) }): the surface's own opener. keep is an object the surface fills when it closes and reads
   when it opens again, so closing keeps the person's work (the chat keeps working underneath).
   openMiniapp(id, preset) opens it. A launch chip is any element with data-miniapp="id" and data-preset='{"…":…}'; a link to
   ?<id>=<building>&side=<side> opens it on load (an http link is what Anton's markdown allows). Nothing interactive goes in the chat. */
const apps = new Map(), kept = new Map();
export const registerMiniapp = (id, app) => { apps.set(id, app); };
export function openMiniapp(id, preset = {}) {
  const a = apps.get(id); if (!a) return null;
  if (!kept.has(id)) kept.set(id, {});
  return a.open(preset, kept.get(id));
}
export const launchChip = (id, label, preset = {}) => Object.assign(document.createElement("button"), { type: "button", className: "chip", textContent: label, onclick: () => openMiniapp(id, preset) });
document.addEventListener("click", e => {
  const b = e.target.closest?.("[data-miniapp]"); if (!b) return;
  let preset = {}; try { preset = JSON.parse(b.dataset.preset || "{}"); } catch { }
  openMiniapp(b.dataset.miniapp, preset);
});
/* ?fasade=sentralblokka&side=Østsiden */
export function openFromAddress(qs = new URLSearchParams(location.search)) {
  for (const id of apps.keys()) if (qs.has(id)) return openMiniapp(id, { focus: qs.get(id) || undefined, side: qs.get("side") || undefined });
  return null;
}
