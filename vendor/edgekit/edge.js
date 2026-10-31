/* Who is asking, as the edge and the calling service vouch for them (U3981, U3964).
   The Python twin is agentkit.edge; both read edge.vectors.json (the same file), so they cannot drift.

   The hop proof: X-Edge-Auth carries the app's own edge secret. The edge proxy sets it after it has stripped any
   copy the client sent; a calling service sends it on its calls. A container beside the app on the Docker network can
   reach the app directly, so Remote-User and Remote-Groups are believed ONLY on a request that carries the proof. An empty
   secret on the app's side means nothing is believed (fails closed). A rollout may name `legacy` header names (the old
   per-app ones) that count the same, until they are removed.
   The person and the admin: Remote-User is the login (Authelia's username, lowercase; a value that is not a login is no
   login); Remote-Groups is Authelia's comma-separated group list; an admin is a login in the `admins` group, nowhere else.
   The signed assertion: X-Edge-Assertion is a JWT (alg EdDSA) a calling service signs with its own private key: sub the
   login, aud the server it is for, groups, exp at most MAX_LIFETIME after iat. The server holds only the public key (32 bytes,
   base64url). Another aud, an old exp, a bad signature or any other alg is refused; a request that carries an invalid
   assertion is refused whole, it never falls back to Remote-User. */
import { createPrivateKey, createPublicKey, sign, timingSafeEqual, verify } from "node:crypto";

export const EDGE_HEADER = "x-edge-auth";
export const ASSERTION_HEADER = "x-edge-assertion";
export const ADMIN_GROUP = "admins";
export const MAX_LIFETIME = 120;
const LOGIN = /^[a-z0-9._@-]{1,64}$/;
const SPKI = Buffer.from("302a300506032b6570032100", "hex");
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");

/** The error an assertion that is not good throws; `message` says why (never the token). */
export class AssertionRefused extends Error {}

const b64e = (buf) => Buffer.from(buf).toString("base64url");
const b64d = (text) => Buffer.from(String(text), "base64url");
const header = (headers, name) => {
  const low = name.toLowerCase();
  for (const k of Object.keys(headers || {})) if (k.toLowerCase() === low) { const v = headers[k]; return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? ""); }
  return "";
};
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** True when the request carries the app's edge secret (the hop proof). An empty secret is false. */
export function edgeOk(headers, secret, { legacy = [] } = {}) {
  if (!secret) return false;
  let seen = false;
  for (const name of [EDGE_HEADER, ...legacy]) { const given = header(headers, name); if (given && same(given, secret)) seen = true; }
  return seen;
}

/** The household login the edge vouches for, or null. */
export function edgeLogin(headers, secret, opts) {
  if (!edgeOk(headers, secret, opts)) return null;
  const login = header(headers, "Remote-User").trim().toLowerCase();
  return LOGIN.test(login) ? login : null;
}

const groupsOf = (raw) => [...new Set(String(raw).split(",").map((g) => g.trim().toLowerCase()).filter(Boolean))].sort();

/** The groups of that login; empty unless the request carries the proof and names a login. */
export function edgeGroups(headers, secret, opts) {
  return edgeLogin(headers, secret, opts) === null ? [] : groupsOf(header(headers, "Remote-Groups"));
}

/** The one admin rule: the `admins` group. */
export const isAdmin = (groups) => [...groups].some((g) => String(g).trim().toLowerCase() === ADMIN_GROUP);

/** A signed assertion that `sub` calls `aud`. `privateKey` is the 32-byte seed, base64url. */
export function signAssertion(privateKey, { sub, aud, groups = [], ttl = 60, now = Math.floor(Date.now() / 1000), iss = "caller" }) {
  if (!(ttl > 0 && ttl <= MAX_LIFETIME)) throw new AssertionRefused("ttl out of range");
  const head = b64e(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const body = b64e(JSON.stringify({ iss, sub, aud, iat: now, exp: now + ttl, groups: [...new Set(groups)].sort() }));
  const key = createPrivateKey({ key: Buffer.concat([PKCS8, b64d(privateKey)]), format: "der", type: "pkcs8" });
  return `${head}.${body}.${b64e(sign(null, Buffer.from(`${head}.${body}`), key))}`;
}

/** The claims of a good assertion for `aud`, or throws AssertionRefused saying what is wrong. */
export function verifyAssertion(token, publicKey, { aud, now = Math.floor(Date.now() / 1000), leeway = 5 }) {
  const parts = String(token).split(".");
  if (parts.length !== 3 || token.length > 2048) throw new AssertionRefused("not a token");
  let head, claims;
  try { head = JSON.parse(b64d(parts[0]).toString()); claims = JSON.parse(b64d(parts[1]).toString()); } catch { throw new AssertionRefused("not a token"); }
  if (!head || typeof head !== "object" || head.alg !== "EdDSA") throw new AssertionRefused("wrong alg");
  let ok = false;
  try { ok = verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: Buffer.concat([SPKI, b64d(publicKey)]), format: "der", type: "spki" }), b64d(parts[2])); } catch { ok = false; }
  if (!ok) throw new AssertionRefused("bad signature");
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) throw new AssertionRefused("not a token");
  const { exp, iat } = claims;
  if (!Number.isInteger(exp) || !Number.isInteger(iat)) throw new AssertionRefused("no exp");
  if (exp <= now - leeway) throw new AssertionRefused("expired");
  if (iat > now + leeway) throw new AssertionRefused("from the future");
  if (exp - iat > MAX_LIFETIME) throw new AssertionRefused("lives too long");
  if (claims.aud !== aud) throw new AssertionRefused("wrong aud");
  if (typeof claims.sub !== "string" || !LOGIN.test(claims.sub)) throw new AssertionRefused("no login");
  const groups = claims.groups ?? [];
  if (!Array.isArray(groups) || !groups.every((g) => typeof g === "string")) throw new AssertionRefused("bad groups");
  return claims;
}

/** The person a request is from, { login, groups, admin, via }, or null. The request must carry the hop proof. With an
    assertion header the assertion decides (good: it names the person and groups; bad: AssertionRefused, the caller
    answers 401). With none, the Remote-User and Remote-Groups beside the proof decide. */
export function edgeIdentity(headers, secret, { legacy = [], assertionKey = null, aud = null, now } = {}) {
  if (!edgeOk(headers, secret, { legacy })) return null;
  const token = header(headers, ASSERTION_HEADER);
  if (token) {
    if (!assertionKey || !aud) throw new AssertionRefused("assertions are not accepted here");
    const c = verifyAssertion(token, assertionKey, { aud, now });
    const groups = groupsOf(c.groups.join(","));
    return { login: c.sub, groups, admin: isAdmin(groups), via: "assertion" };
  }
  const login = edgeLogin(headers, secret, { legacy });
  if (login === null) return null;
  const groups = groupsOf(header(headers, "Remote-Groups"));
  return { login, groups, admin: isAdmin(groups), via: "edge" };
}
