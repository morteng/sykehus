/* Saved camera views (U3562, Morten 2026-10-25 21:18Z «let the system remember custom viewpoints / camera shots and
   user easily move between them»): a list of named views, each a camera state the app gives and takes back. One copy
   for every app (sykehus first, Fab's cameras next, U3560). No three.js, no DOM, no storage: the app keeps the list
   (sykehus: on the version) and moves the camera itself (camera.js ease, the same move as every other).

   A view: { id, name, state, by, at }
     state  the app's camera state, checked against its spec: { num: { key: [lo, hi] }, str: { key: maxLength },
            one: { key: [allowed values] } }; anything not in the spec is dropped, a number out of range is refused
     by     who saved it: "person" or "anton"
     at     ISO time
   The functions return a new list (the old is not changed) or throw an Error whose message, in Norwegian, says what is
   wrong, for an agent or a person to read. */

export const MAX_VIEWS = 30, MAX_NAME = 60;

/* the state as the spec allows it: the keys it names, each checked */
export function cleanState(state, spec) {
  if (!state || typeof state !== "object") throw new Error("Visningen mangler kameraet (state)");
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(spec.num || {})) if (state[k] != null) {
    const v = +state[k]; if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${k} må være et tall mellom ${lo} og ${hi}`); out[k] = Math.round(v * 1e4) / 1e4;
  }
  for (const [k, max] of Object.entries(spec.str || {})) if (state[k] != null) out[k] = String(state[k]).slice(0, max);
  for (const [k, ok] of Object.entries(spec.one || {})) if (state[k] != null) { if (!ok.includes(state[k])) throw new Error(`${k} er en av ${ok.join(", ")}`); out[k] = state[k]; }
  if (!Object.keys(out).length) throw new Error("Visningen har ingen kameraverdier");
  return out;
}

const tidy = name => String(name ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
/* a free name from a stem: «Visning», «Visning 2», … */
export function freeName(list, stem = "Visning") {
  const taken = new Set((list || []).map(v => v.name.toLowerCase())); let k = 1;
  while (taken.has((k > 1 ? `${stem} ${k}` : stem).toLowerCase())) k++;
  return k > 1 ? `${stem} ${k}` : stem;
}
const idOf = () => "w" + Math.random().toString(36).slice(2, 10);

/* a view added; one with the same name is replaced (saving «Fra sør» again moves it) */
export function addView(list, { name, state, by = "person" }, spec, { id = idOf(), now = new Date().toISOString() } = {}) {
  const l = list || [], n = tidy(name) || freeName(l), s = cleanState(state, spec);
  if (!["person", "anton"].includes(by)) throw new Error("by er person eller anton");
  const same = l.find(v => v.name.toLowerCase() === n.toLowerCase());
  if (!same && l.length >= MAX_VIEWS) throw new Error(`Høyst ${MAX_VIEWS} lagrede visninger; ta bort en først`);
  const v = { id: same?.id ?? id, name: n, state: s, by, at: now };
  return same ? l.map(x => x === same ? v : x) : [...l, v];
}
export function renameView(list, id, name) {
  const n = tidy(name); if (!n) throw new Error("Gi visningen et navn");
  const v = findView(list, id); if ((list || []).some(x => x !== v && x.name.toLowerCase() === n.toLowerCase())) throw new Error(`Det finnes alt en visning som heter «${n}»`);
  return list.map(x => x === v ? { ...x, name: n } : x);
}
export function removeView(list, id) { const v = findView(list, id); return list.filter(x => x !== v); }
/* by id, or by name (an agent names it) */
export function findView(list, key) {
  const k = String(key ?? "").toLowerCase().trim(), v = (list || []).find(x => x.id === key || x.name.toLowerCase() === k);
  if (!v) throw new Error(`Ingen lagret visning «${key}»${list?.length ? `; de lagrede: ${list.map(x => `«${x.name}»`).join(", ")}` : ""}`);
  return v;
}
/* the list as it is kept, each view checked again (what was read from a file) */
export function checkViews(list, spec) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_VIEWS).flatMap(v => { try { return [{ id: String(v.id), name: tidy(v.name) || "Visning", state: cleanState(v.state, spec), by: v.by === "anton" ? "anton" : "person", at: String(v.at || "") }]; } catch { return []; } });
}
