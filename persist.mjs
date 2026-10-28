/* What the server keeps over a restart (every deploy restarts it), in `_state/` under the versions dir: the pin of each turn in flight and
   the page's open and picked maps (pins.json), the drawings people sent (tegning/), the turns a restart cut (running.json).
   A write never throws into a request: a failure is logged once. No dir, no files: everything stays in memory. */
import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const HOUR = 3600e3, DAY = 86400e3;
export function createPersist(dir = process.env.SYKEHUS_VERSIONS_DIR, clock = () => Date.now()) {
  const home = dir ? join(dir, "_state") : null, pics = home && join(home, "tegning");
  let warned = false;
  const warn = (what, e) => { if (!warned) { warned = true; console.error("persist:", what, e?.message ?? e); } };
  const guard = (what, f, d) => { try { return f(); } catch (e) { warn(what, e); return d; } };
  if (home) guard("mkdir", () => mkdirSync(pics, { recursive: true }));
  const readJ = (name, d) => guard("read " + name, () => { const p = join(home, name); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : d; }, d);
  const writeJ = (name, v) => guard("write " + name, () => { const p = join(home, name); writeFileSync(p + ".tmp", JSON.stringify(v)); renameSync(p + ".tmp", p); });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /* pins.json: { turn: {person: {at, ctx}}, open: {person: {at, v}}, picked: {...} }; each entry is stamped when its value last changed, dropped after an hour */
  const stamps = { turn: new Map(), open: new Map(), picked: new Map() };
  function restorePins(pages) {
    if (!home || !pages) return;
    const f = readJ("pins.json", {}), now = clock();
    for (const [kind, map] of [["turn", (pages.turn ??= new Map())], ["open", pages.open], ["picked", (pages.picked ??= new Map())]]) {
      for (const [person, e] of Object.entries(f[kind] ?? {})) {
        if (!e || !(now - e.at < HOUR)) continue;
        const v = kind === "turn" ? e.ctx : e.v; if (v == null || map.has(person)) continue;
        map.set(person, v); stamps[kind].set(person, { at: e.at, v });
      }
    }
  }
  let timer = null, pending = null;
  function writePins() {
    timer = null; const pages = pending; if (!home || !pages) return;
    const now = clock(), out = { turn: {}, open: {}, picked: {} };
    for (const [kind, map] of [["turn", pages.turn], ["open", pages.open], ["picked", pages.picked]]) {
      const st = stamps[kind];
      for (const person of [...st.keys()]) if (!map?.has(person)) st.delete(person);
      for (const [person, v] of map ?? []) {
        let s = st.get(person); if (!s || !same(s.v, v)) { s = { at: now, v }; st.set(person, s); }
        if (now - s.at < HOUR) out[kind][person] = kind === "turn" ? { at: s.at, ctx: v } : { at: s.at, v };
      }
    }
    writeJ("pins.json", out);
  }
  const savePins = pages => { if (!home) return; pending = pages; if (!timer) { timer = setTimeout(writePins, 300); timer.unref?.(); } };

  /* tegning/index.json: [{ id, person, text, at }]; the picture is tegning/<id>.jpg; the last 20 of each person */
  const KEEP = 20, UUID = /^[0-9a-f-]{36}$/;
  let index = home ? readJ("tegning/index.json", []) : [];
  if (!Array.isArray(index)) index = [];
  const saveIndex = () => writeJ("tegning/index.json", index);
  const picFile = id => join(pics, id + ".jpg");
  function keepPic(person, id, text, image) {
    if (!home || !UUID.test(id)) return;
    guard("write picture", () => { writeFileSync(picFile(id) + ".tmp", Buffer.from(image.slice(image.indexOf(",") + 1), "base64")); renameSync(picFile(id) + ".tmp", picFile(id)); });
    index.push({ id, person, text, at: new Date(clock()).toISOString() });
    const mine = index.filter(x => x.person === person);
    for (const old of mine.slice(0, Math.max(0, mine.length - KEEP))) { index = index.filter(x => x !== old); guard("delete picture", () => unlinkSync(picFile(old.id))); }
    saveIndex();
  }
  const picsOf = person => index.filter(x => x.person === person).map(({ id, text }) => ({ id, text }));
  const picBytes = id => home && UUID.test(id) ? guard("read picture", () => readFileSync(picFile(id)), null) : null;
  const people = () => [...new Set(index.map(x => x.person))];

  /* running.json: { running: {person: {id, text, at}}, notes: {person: [{code, reply_to, text, at}]} }.
     At start the turns still listed were cut by the restart: each becomes a note (once) and is no longer running */
  const run = home ? readJ("running.json", {}) : {};
  if (!run.running || typeof run.running !== "object") run.running = {};
  if (!run.notes || typeof run.notes !== "object") run.notes = {};
  const saveRun = () => writeJ("running.json", run);
  const cut = [];
  for (const [person, r] of Object.entries(run.running)) { if (r?.id) { (run.notes[person] ??= []).push({ code: "restart", reply_to: r.id, text: String(r.text ?? ""), at: new Date(clock()).toISOString() }); cut.push(person); } }
  for (const person of Object.keys(run.notes)) run.notes[person] = run.notes[person].filter(n => clock() - Date.parse(n.at) < DAY).slice(-10);
  run.running = {};
  if (home && (cut.length || Object.keys(run.notes).length)) saveRun();
  const turnTaken = (person, turn) => { if (!home) return; run.running[person] = { id: turn.id, text: String(turn.text ?? "").slice(0, 300), at: new Date(clock()).toISOString() }; saveRun(); };
  const turnEnded = person => { if (!home || !run.running[person]) return; delete run.running[person]; saveRun(); };
  const notesOf = person => run.notes[person] ?? [];

  return { restorePins, savePins, flush: () => { if (timer) { clearTimeout(timer); writePins(); } }, keepPic, picsOf, picBytes, people, turnTaken, turnEnded, notesOf };
}
