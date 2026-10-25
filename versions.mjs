/* Versions: each person's own "after" of the site, kept. A version is a named list of changes (public/edits.js and
   design.js) laid over the before, which stays as it is; its owner is the login that made it, and only the owner
   changes it. Its owner picks who sees it (sharing):
     privat    the owner only (on the web through their own link, ?versjon=<id>&nokkel=<own>, which is not to be given on)
     lenke     «Bare de med lenken»: anyone with its link (?versjon=<id>&nokkel=<key>), never listed
     offentlig «Vis offentlig»: anyone, without a login, at its plain link and in the list on the front page
   A new version is privat.

   One JSON file a version in SYKEHUS_VERSIONS_DIR, written whole to a temporary file and renamed over the old one, so
   a crash leaves the last good copy. Without the directory set, versions cannot be made (the tools say so).

   { id: "v…", owner, title, edits: [...], sharing, key, own, created, updated }   (times as ISO strings) */
import { readFileSync, writeFileSync, renameSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const MAX_PER_OWNER = 50, MAX_EDITS = 300;
const ID = /^v[A-Za-z0-9_-]{8}$/;
export const SHARING = ["privat", "lenke", "offentlig"];
const newKey = () => randomBytes(9).toString("base64url");

export function createVersions(dir = process.env.SYKEHUS_VERSIONS_DIR) {
  if (!dir) return null;
  mkdirSync(dir, { recursive: true });
  const all = new Map(), watchers = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || !ID.test(f.slice(0, -5))) continue;
    try { const v = JSON.parse(readFileSync(join(dir, f), "utf8")); if (v.id === f.slice(0, -5)) { v.sharing ||= v.public ? "offentlig" : "privat"; delete v.public; v.key ||= newKey(); v.own ||= newKey(); all.set(v.id, v); } } catch (e) { console.error("versions: skipping", f, e.message); }
  }
  const write = v => { const p = join(dir, v.id + ".json"), t = p + ".tmp"; writeFileSync(t, JSON.stringify(v)); renameSync(t, p); };
  return {
    get: id => ID.test(String(id)) ? all.get(String(id)) ?? null : null,
    /* the versions one may see listed: the public ones, and the asker's own (a link-only one is never listed for others) */
    list: ({ owner, viewer } = {}) => [...all.values()].filter(v => (!owner || v.owner === owner) && (v.sharing === "offentlig" || (viewer && v.owner === viewer))).sort((a, b) => b.updated.localeCompare(a.updated)),
    /* may this person (a login or null), with this key (or none), look at it */
    visible: (v, viewer, key) => !!v && (v.sharing === "offentlig" || (!!viewer && v.owner === viewer) || (typeof key === "string" && (key === v.own || (v.sharing === "lenke" && key === v.key)))),
    create(owner, title, edits = []) {
      if ([...all.values()].filter(v => v.owner === owner).length >= MAX_PER_OWNER) throw new Error(`Høyst ${MAX_PER_OWNER} versjoner per person`);
      let id; do id = "v" + randomBytes(6).toString("base64url"); while (all.has(id) || existsSync(join(dir, id + ".json")));
      const now = new Date().toISOString(), v = { id, owner, title, edits: edits.slice(0, MAX_EDITS), sharing: "privat", key: newKey(), own: newKey(), created: now, updated: now };
      write(v); all.set(id, v); return v;
    },
    save(v) { if (v.edits.length > MAX_EDITS) throw new Error(`En versjon holder høyst ${MAX_EDITS} endringer`); v.updated = new Date().toISOString(); write(v); all.set(v.id, v); for (const f of watchers) try { f(v); } catch (e) { console.error("versions watcher:", e.message); } return v; },
    /* told of every save (assistant.mjs: the owner's open pages redraw it) */
    watch: f => watchers.push(f),
  };
}
