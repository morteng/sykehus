/* Versions: each person's own "after" of the site, kept. A version is a named list of changes (public/edits.js and
   design.js) laid over the before, which stays as it is; its owner is the login that made it, and only the owner
   changes it. A version is the owner's own until they mark it «Vis offentlig»: then anyone can look at it, without a
   login, at its link and in the public list. A private one opens for its owner, and for whoever the owner gives its
   private link (?versjon=<id>&nokkel=<key>), so it can be shown to someone before it is public.

   One JSON file a version in SYKEHUS_VERSIONS_DIR, written whole to a temporary file and renamed over the old one, so
   a crash leaves the last good copy. Without the directory set, versions cannot be made (the tools say so).

   { id: "v…", owner, title, edits: [...], public, key, created, updated }   (times as ISO strings) */
import { readFileSync, writeFileSync, renameSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const MAX_PER_OWNER = 50, MAX_EDITS = 300;
const ID = /^v[A-Za-z0-9_-]{8}$/;

export function createVersions(dir = process.env.SYKEHUS_VERSIONS_DIR) {
  if (!dir) return null;
  mkdirSync(dir, { recursive: true });
  const all = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || !ID.test(f.slice(0, -5))) continue;
    try { const v = JSON.parse(readFileSync(join(dir, f), "utf8")); if (v.id === f.slice(0, -5)) { v.public = !!v.public; v.key ||= randomBytes(9).toString("base64url"); all.set(v.id, v); } } catch (e) { console.error("versions: skipping", f, e.message); }
  }
  const write = v => { const p = join(dir, v.id + ".json"), t = p + ".tmp"; writeFileSync(t, JSON.stringify(v)); renameSync(t, p); };
  return {
    get: id => ID.test(String(id)) ? all.get(String(id)) ?? null : null,
    /* the versions one may see listed: the public ones, and the asker's own */
    list: ({ owner, viewer } = {}) => [...all.values()].filter(v => (!owner || v.owner === owner) && (v.public || (viewer && v.owner === viewer))).sort((a, b) => b.updated.localeCompare(a.updated)),
    /* may this person (a login or null), with this key (or none), look at it */
    visible: (v, viewer, key) => !!v && (v.public || (viewer && v.owner === viewer) || (!!key && typeof key === "string" && key === v.key)),
    create(owner, title, edits = []) {
      if ([...all.values()].filter(v => v.owner === owner).length >= MAX_PER_OWNER) throw new Error(`Høyst ${MAX_PER_OWNER} versjoner per person`);
      let id; do id = "v" + randomBytes(6).toString("base64url"); while (all.has(id) || existsSync(join(dir, id + ".json")));
      const now = new Date().toISOString(), v = { id, owner, title, edits: edits.slice(0, MAX_EDITS), public: false, key: randomBytes(9).toString("base64url"), created: now, updated: now };
      write(v); all.set(id, v); return v;
    },
    save(v) { if (v.edits.length > MAX_EDITS) throw new Error(`En versjon holder høyst ${MAX_EDITS} endringer`); v.updated = new Date().toISOString(); write(v); all.set(v.id, v); return v; },
  };
}
