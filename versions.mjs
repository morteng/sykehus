/* Versions: each person's own "after" of the site, kept. A version is a named list of changes (public/edits.js and
   design.js) laid over the before, which stays as it is; its owner is the login that made it, and only the owner
   changes it. Its owner picks who sees it (sharing):
     privat    the owner only (on the web through their own link, ?versjon=<id>&nokkel=<own>, which is not to be given on)
     lenke     «Bare de med lenken»: anyone with its link (?versjon=<id>&nokkel=<key>), never listed
     offentlig «Vis offentlig»: anyone, without a login, at its plain link and in the list on the front page
   A new version is privat.

   One JSON file a version in SYKEHUS_VERSIONS_DIR, written whole to a temporary file and renamed over the old one, so
   a crash leaves the last good copy. Without the directory set, versions cannot be made (the tools say so).

   { id: "v…", owner, title, edits: [...], sharing, key, own, created, updated, deleted? }   (times as ISO strings)

   U3654: the owner deletes a version into a 30-day trash: it gets «deleted» (a time), and then get, list and every link
   treat it as gone. The owner restores it within TRASH_DAYS; after that sweep() takes the file away for good (at start
   and on every list). The clock is a parameter, so a test can move it. */
import { readFileSync, writeFileSync, renameSync, readdirSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const MAX_PER_OWNER = 50, MAX_EDITS = 300, TRASH_DAYS = 30, EMPTY_DAYS = 7;
const ID = /^v[A-Za-z0-9_-]{8}$/;
export const SHARING = ["privat", "lenke", "offentlig"];
/* a real person, for the Forslag tab's list for others (the auth layer has no flag for it, so by name): test, qa, coretest, anton, admin
   and system logins are fixtures and tools, never listed to anyone but themselves */
export const isPerson = owner => typeof owner === "string" && owner !== "" && !/^(test|qa|coretest|anton|admin|system)/i.test(owner);
const newKey = () => randomBytes(9).toString("base64url");

export function createVersions(dir = process.env.SYKEHUS_VERSIONS_DIR, clock = () => Date.now()) {
  if (!dir) return null;
  mkdirSync(dir, { recursive: true });
  const all = new Map(), watchers = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || !ID.test(f.slice(0, -5))) continue;
    try { const v = JSON.parse(readFileSync(join(dir, f), "utf8")); if (v.id === f.slice(0, -5)) { v.sharing ||= v.public ? "offentlig" : "privat"; delete v.public; v.key ||= newKey(); v.own ||= newKey(); all.set(v.id, v); } } catch (e) { console.error("versions: skipping", f, e.message); }
  }
  const write = v => { const p = join(dir, v.id + ".json"), t = p + ".tmp"; writeFileSync(t, JSON.stringify(v)); renameSync(t, p); };
  const live = v => !v.deleted, trashed = v => v.deleted && clock() - Date.parse(v.deleted) < TRASH_DAYS * 864e5;
  /* a deleted version past its 30 days: the file and the record go */
  const sweep = () => { sweepEmpty(); for (const v of [...all.values()]) if (v.deleted && !trashed(v)) { try { unlinkSync(join(dir, v.id + ".json")); } catch (e) { if (e.code !== "ENOENT") console.error("versions: purge", v.id, e.message); } all.delete(v.id); } };
  /* an empty version (no changes) left for EMPTY_DAYS goes to the trash like a deleted one (U3667: «Nytt forslag» makes one at once) */
  const sweepEmpty = () => { const at = clock(); for (const v of all.values()) if (live(v) && !v.edits.length && at - Date.parse(v.updated) > EMPTY_DAYS * 864e5) { v.deleted = new Date(at).toISOString(); delete v.work; write(v); } };
  sweep();
  return {
    get: id => { if (!ID.test(String(id))) return null; const v = all.get(String(id)); return v && live(v) ? v : null; },
    /* the versions one may see listed: the public ones, and the asker's own (a link-only one is never listed for others) */
    list: ({ owner, viewer } = {}) => (sweep(), [...all.values()]).filter(v => live(v) && (!owner || v.owner === owner) && (v.sharing === "offentlig" || (viewer && v.owner === viewer))).sort((a, b) => b.updated.localeCompare(a.updated)),
    /* the owner's deleted ones still inside their 30 days, newest deleted first (a deleted one is no one else's to see) */
    trash: owner => (sweep(), [...all.values()]).filter(v => v.deleted && v.owner === owner).sort((a, b) => b.deleted.localeCompare(a.deleted)),
    /* one of the owner's trashed versions by id, for restore; null when it is live, gone or past its days */
    getTrashed: id => { const v = ID.test(String(id)) ? all.get(String(id)) : null; return v && v.deleted && trashed(v) ? v : null; },
    /* delete / restore: the caller has checked the owner. «work» is dropped on delete; the 50-version cap holds on restore */
    remove(v) { v.deleted = new Date(clock()).toISOString(); delete v.work; write(v); all.set(v.id, v); return v; },
    restore(v) {
      if ([...all.values()].filter(x => x.owner === v.owner && live(x)).length >= MAX_PER_OWNER) throw new Error(`Høyst ${MAX_PER_OWNER} versjoner per person; slett en annen først`);
      delete v.deleted; v.updated = new Date(clock()).toISOString(); write(v); all.set(v.id, v); return v;
    },
    /* may this person (a login or null), with this key (or none), look at it */
    visible: (v, viewer, key) => !!v && (v.sharing === "offentlig" || (!!viewer && v.owner === viewer) || (typeof key === "string" && (key === v.own || (v.sharing === "lenke" && key === v.key)))),
    create(owner, title, edits = []) {
      if ([...all.values()].filter(v => v.owner === owner && live(v)).length >= MAX_PER_OWNER) throw new Error(`Høyst ${MAX_PER_OWNER} versjoner per person`);
      let id; do id = "v" + randomBytes(6).toString("base64url"); while (all.has(id) || existsSync(join(dir, id + ".json")));
      const now = new Date(clock()).toISOString(), v = { id, owner, title, edits: edits.slice(0, MAX_EDITS), sharing: "privat", key: newKey(), own: newKey(), created: now, updated: now };
      write(v); all.set(id, v); return v;
    },
    save(v) { if (v.edits.length > MAX_EDITS) throw new Error(`En versjon holder høyst ${MAX_EDITS} endringer`); v.updated = new Date(clock()).toISOString(); write(v); all.set(v.id, v); for (const f of watchers) try { f(v); } catch (e) { console.error("versions watcher:", e.message); } return v; },
    /* told of every save (assistant.mjs: the owner's open pages redraw it) */
    watch: f => watchers.push(f),
  };
}
