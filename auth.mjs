/* Who is asking, for the few things that need it (keeping a version of the after): looking and trying are open.

   Three ways in, each ending in a login name (the person's gulden.no login):
   - gulden.no in front: the login's Remote-User header, believed only with X-Sykehus-Proxy-Auth equal to
     SYKEHUS_PROXY_SECRET (the edge strips both from what clients send; Anton sends both on its internal calls);
   - a personal token (Authorization: Bearer), its sha256 (hex) mapped to the login in the JSON file SYKEHUS_TOKENS,
     for Claude Code and other MCP clients that take a token;
   - OAuth 2.1 with PKCE, for claude.ai and other chat apps that connect with a sign-in: the consent page is reached
     through the gulden.no login, so the person is known there by the first way.

     GET  /.well-known/oauth-protected-resource[/mcp]    RFC 9728
     GET  /.well-known/oauth-authorization-server[/mcp]  RFC 8414
     GET  /oauth/authorize    consent page (behind the gulden.no login)
     POST /oauth/approve      its answer: a one-time form id, the same login
     POST /oauth/token        code (PKCE S256) and refresh (rotating)
     POST /oauth/register     dynamic client registration, for clients without metadata documents

   The OAuth server is hagekart's (mcp.mjs, 42e3624, 2026-10-25), with gulden.no's login in place of hagekart's
   browser owner and one scope, "versions". Grants live in SYKEHUS_VERSIONS_DIR/_oauth.json (token hashes only).

   And the counts pm reads for the daily report: calls a day, per login and per address (the address hashed). */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { join } from "node:path";

export const SCOPE = "versions";
const ACCESS_TTL = 3600, REFRESH_TTL = 90 * 86400, CODE_TTL = 600e3, FORM_TTL = 900e3;
const LOGIN = /^[A-Za-z0-9._@-]{1,64}$/;
const sha64 = s => createHash("sha256").update(s).digest("base64url");
const token = () => randomBytes(32).toString("base64url");
const err = (code, message) => Object.assign(new Error(message), { code });
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function createAuth({ SECURITY, readJson, dir = process.env.SYKEHUS_VERSIONS_DIR, UA = "sykehus.gulden.no" }) {
  const send = (res, code, body, headers = {}) => { res.writeHead(code, { ...SECURITY, "content-type": "application/json", "cache-control": "no-store", ...headers }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
  const originOf = req => process.env.PUBLIC_ORIGIN || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || "") ? `http://${req.headers.host}` : `https://${req.headers.host}`);

  // ---------- the three ways in ----------
  const proxyUser = req => {
    const secret = process.env.SYKEHUS_PROXY_SECRET, ru = req.headers["remote-user"];
    return secret && same(req.headers["x-sykehus-proxy-auth"] || "", secret) && typeof ru === "string" && LOGIN.test(ru) ? ru : null;
  };
  const tokens = (() => { try { return process.env.SYKEHUS_TOKENS ? JSON.parse(readFileSync(process.env.SYKEHUS_TOKENS, "utf8")) : {}; } catch (e) { console.error("tokens:", e.message); return {}; } })();
  const file = dir ? join(dir, "_oauth.json") : null;
  const store = (() => { try { return file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { grants: [], clients: [] }; } catch (e) { console.error("oauth store:", e.message); return { grants: [], clients: [] }; } })();
  const save = () => { if (!file) return; const t = file + ".tmp"; writeFileSync(t, JSON.stringify(store)); renameSync(t, file); };
  const grantOf = bearer => { const h = sha64(bearer), g = store.grants.find(x => x.access_hash === h); if (!g || g.access_exp < Date.now() / 1000) return null;
    if (!g.last_used || Date.now() - Date.parse(g.last_used) > 3600e3) { g.last_used = new Date().toISOString(); save(); } return g; };
  function userOf(req) {
    if (req.webUser) return req.webUser;   // server.mjs sets it from login.mjs's cookie, on the page's own /api routes only
    const p = proxyUser(req); if (p) return p;
    const m = /^Bearer\s+(\S{16,400})$/i.exec(req.headers.authorization || ""); if (!m) return null;
    const who = tokens[createHash("sha256").update(m[1]).digest("hex")];
    if (typeof who === "string" && LOGIN.test(who)) return who;
    return grantOf(m[1])?.owner ?? null;
  }
  const challenge = req => `Bearer resource_metadata="${originOf(req)}/.well-known/oauth-protected-resource/mcp", scope="${SCOPE}"`;

  // ---------- counts ----------
  const salt = randomBytes(16), days = new Map(), hour = new Map();
  const ipOf = req => { const f = String(req.headers["x-forwarded-for"] || "").split(",").map(s => s.trim()).filter(Boolean); return f.at(-1) || req.socket?.remoteAddress || "?"; };   // the edge appends the client's
  const ipKey = ip => "ip-" + createHash("sha256").update(salt).update(ip).digest("hex").slice(0, 10);
  /* one tool call: counted, and refused past the per-address limit when no one is logged in (claude.ai's calls share a few addresses, so a login is counted on its own) */
  function count(req, who) {
    const day = new Date().toISOString().slice(0, 10), ip = ipKey(ipOf(req));
    let d = days.get(day); if (!d) { d = { calls: 0, logins: {}, addresses: {} }; days.set(day, d); for (const k of [...days.keys()].sort().slice(0, -14)) days.delete(k); }
    d.calls++; if (who) d.logins[who] = (d.logins[who] || 0) + 1; else d.addresses[ip] = (d.addresses[ip] || 0) + 1;
    const key = who ? "u:" + who : ip, now = Date.now(), h = hour.get(key);
    if (!h || now - h.t > 3600e3) hour.set(key, { t: now, n: 1 });
    else if (++h.n > (who ? 1000 : 600)) throw Object.assign(new Error("For mange forespørsler akkurat nå. Prøv igjen om litt."), { tool: true });
  }
  /* GET /api/bruk: for pm's daily report, from the box (the proxy secret) or this machine only */
  function usage(req, res) {
    const local = /^(127\.|::1$|::ffff:127\.)/.test(req.socket?.remoteAddress || "") && !req.headers["x-forwarded-for"];
    if (!local && !(process.env.SYKEHUS_PROXY_SECRET && same(req.headers["x-sykehus-proxy-auth"] || "", process.env.SYKEHUS_PROXY_SECRET))) return send(res, 403, { error: "Not here" });
    return send(res, 200, { days: Object.fromEntries([...days].map(([k, d]) => [k, { calls: d.calls, logins: d.logins, anonymous_calls: Object.values(d.addresses).reduce((a, n) => a + n, 0), anonymous_addresses: Object.keys(d.addresses).length }])),
      grants: store.grants.map(g => ({ owner: g.owner, app: g.client_name, created: g.created, last_used: g.last_used ?? null })) });
  }

  // ---------- OAuth (hagekart's) ----------
  const codes = new Map(), forms = new Map(), clientCache = new Map(), limits = new Map();
  const bump = (key, max) => { const now = Date.now(), h = limits.get(key); if (!h || now - h.t > 3600e3) { limits.set(key, { t: now, n: 1 }); return; } if (++h.n > max) throw err(429, "Too many requests"); };
  setInterval(() => { const now = Date.now(); for (const m of [codes, forms]) for (const [k, c] of m) if (c.exp < now) m.delete(k); }, 600e3).unref();
  const isLoopback = u => { try { const x = new URL(u); return x.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname); } catch { return false; } };
  const uriOk = u => /^https:\/\/[^\s]/i.test(u) || isLoopback(u);   // https, or http on this machine; never javascript: and the like
  const redirectOk = (allowed, uri) => uriOk(uri) && allowed.filter(uriOk).some(a => a === uri || (isLoopback(a) && isLoopback(uri) && (() => { const x = new URL(a), y = new URL(uri); return x.hostname === y.hostname && x.pathname === y.pathname; })()));
  /* who is asking: a client id metadata document (a URL we fetch), or a client registered here */
  async function clientOf(id) {
    if (/^https:\/\//.test(id)) {
      const u = new URL(id);
      if (/^(localhost|\[)/.test(u.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) throw err(400, "Client id host not allowed");
      const addrs = await lookup(u.hostname, { all: true }).catch(() => []);   // the name must not lead into a private network
      if (!addrs.length || addrs.some(({ address: a }) => /^(127\.|10\.|0\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|::$|f[cd]|fe[89ab]|::ffff:(127|10|192\.168|169\.254)\.)/i.test(a))) throw err(400, "Client id host not allowed");
      const hit = clientCache.get(id); if (hit && Date.now() - hit.at < 864e5) return hit.c;
      const r = await fetch(id, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(5000), redirect: "error" });
      const text = await r.text(); if (!r.ok || text.length > 65536) throw err(400, "Could not read the client's metadata");
      const m = JSON.parse(text); if (m.client_id !== id || !Array.isArray(m.redirect_uris)) throw err(400, "Client metadata does not match");
      const c = { id, name: String(m.client_name || u.hostname).slice(0, 80), host: u.hostname, redirect_uris: m.redirect_uris.map(String).filter(uriOk).slice(0, 10) };
      if (!c.redirect_uris.length) throw err(400, "Client metadata has no usable redirect_uris (https or localhost only)");
      clientCache.set(id, { c, at: Date.now() }); return c;
    }
    const r = store.clients.find(x => x.id === id); if (!r) throw err(400, "Unknown client");
    return { id, name: r.name, host: null, redirect_uris: r.redirect_uris };
  }
  const metaAS = req => { const o = originOf(req); return { issuer: o, authorization_endpoint: `${o}/oauth/authorize`, token_endpoint: `${o}/oauth/token`, registration_endpoint: `${o}/oauth/register`,
    response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE], client_id_metadata_document_supported: true, service_documentation: `${o}/` }; };
  const metaPR = req => { const o = originOf(req); return { resource: `${o}/mcp`, authorization_servers: [o], scopes_supported: [SCOPE], bearer_methods_supported: ["header"], resource_name: "Sykehustomta" }; };
  const escH = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const page = (res, code, title, body) => { res.writeHead(code, { ...SECURITY, "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'self' https: http://localhost:* http://127.0.0.1:*" });
    res.end(`<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escH(title)} · Sykehustomta</title><style>
    :root{--ink:#23211e;--soft:#6c675f;--paper:#fbf9f4;--line:#d8d2c6}body{margin:0;background:#dfe8ee;color:var(--ink);font:17px/1.45 -apple-system,"Helvetica Neue",Arial,sans-serif}
    main{max-width:480px;margin:8vh auto;padding:0 16px}.card{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:22px;box-shadow:0 2px 10px #0002}
    h1{font-size:22px;margin:0 0 10px}p{margin:10px 0}.mut{color:var(--soft);font-size:15px}.err{color:#b0122b}.acts{display:flex;gap:10px;margin-top:18px}
    button{font:inherit;min-height:46px;padding:0 18px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer}button.pri,.btn.pri{background:var(--ink);border-color:var(--ink);color:#fff}.btn{display:inline-flex;align-items:center;min-height:46px;padding:0 18px;border-radius:8px;border:1px solid var(--line);text-decoration:none}
    </style></head><body><main><div class="card">${body}</div></main></body></html>`); };
  /* back to the app: only to a redirect its registration allows */
  const backTo = (uri, q) => { const u = new URL(uri); for (const [k, v] of Object.entries(q)) if (v) u.searchParams.set(k, v); return u.href; };
  async function authorize(req, res, url) {
    const q = Object.fromEntries(url.searchParams); let client;
    try {
      if (q.response_type !== "code") throw err(400, "response_type must be code");
      if (!q.code_challenge || q.code_challenge_method !== "S256") throw err(400, "PKCE (S256) is required");
      client = await clientOf(String(q.client_id || ""));
      if (!redirectOk(client.redirect_uris, String(q.redirect_uri || ""))) throw err(400, "redirect_uri is not registered for this client");
    } catch (e) { return page(res, 400, "Kan ikke koble til", `<h1>Kan ikke koble til</h1><p class="err">${escH(e.message)}</p><p class="mut">Appen som sendte deg hit, ba om noe Sykehustomta ikke kan godta.</p>`); }
    const who = proxyUser(req);
    /* not signed in on gulden.no: its sign-in, and back here after (SYKEHUS_LOGIN_URL, default auth.gulden.no) */
    const login = `${process.env.SYKEHUS_LOGIN_URL || "https://auth.gulden.no/"}?rd=${encodeURIComponent(originOf(req) + url.pathname + url.search)}`;
    if (!who) return page(res, 401, "Logg inn", `<h1>Logg inn først</h1><p>For å lagre egne versjoner kobler du ${escH(client.name)} til Sykehustomta med gulden.no-innloggingen din.</p>
      <div class="acts"><a class="btn pri" href="${escH(login)}">Logg inn på gulden.no</a></div><p class="mut">Etterpå kommer du tilbake hit og kan gi tilgang.</p>`);
    const id = token(); forms.set(id, { who, client, redirect_uri: q.redirect_uri, state: q.state || "", challenge: q.code_challenge, exp: Date.now() + FORM_TTL });
    return page(res, 200, "Koble til", `<h1>Koble ${escH(client.name)} til Sykehustomta</h1>
      <p>Du er logget inn som <b>${escH(who)}</b>. ${escH(client.name)} får lage og endre <b>dine egne versjoner</b> av «etter», i ditt navn. Alt annet på Sykehustomta er åpent uansett.</p>
      <p class="mut">${client.host ? `Appen kommer fra <b>${escH(client.host)}</b>.` : `Appen sender deg tilbake til <b>${escH(new URL(q.redirect_uri).host)}</b>; gi bare tilgang hvis du kjenner igjen den adressen.`}</p>
      <form method="post" action="/oauth/approve"><input type="hidden" name="form" value="${escH(id)}">
      <div class="acts"><button type="submit" class="pri" name="answer" value="yes">Gi tilgang</button><button type="submit" name="answer" value="no">Avbryt</button></div></form>`);
  }
  async function approve(req, res) {
    if (req.headers.origin && req.headers.origin !== originOf(req)) return send(res, 403, { error: "Wrong origin" });
    const raw = await new Promise((ok, no) => { let s = ""; req.on("data", c => { s += c; if (s.length > 4000) no(err(413, "Too large")); }); req.on("end", () => ok(s)); req.on("error", no); });
    const b = Object.fromEntries(new URLSearchParams(raw)), f = forms.get(String(b.form || "")); forms.delete(String(b.form || ""));
    if (!f || f.exp < Date.now() || f.who !== proxyUser(req)) return page(res, 400, "Utløpt", `<h1>Siden er utløpt</h1><p class="mut">Start tilkoblingen på nytt fra appen.</p>`);
    if (b.answer !== "yes") { res.writeHead(302, { ...SECURITY, location: backTo(f.redirect_uri, { error: "access_denied", state: f.state }) }); return res.end(); }
    const code = token(); codes.set(code, { owner: f.who, client: f.client, redirect_uri: f.redirect_uri, challenge: f.challenge, exp: Date.now() + CODE_TTL });
    res.writeHead(302, { ...SECURITY, location: backTo(f.redirect_uri, { code, state: f.state }) }); return res.end();
  }
  function issue(res, g) {
    const access = token(), refresh = token(), now = Date.now() / 1000;
    Object.assign(g, { access_hash: sha64(access), access_exp: Math.floor(now + ACCESS_TTL), refresh_hash: sha64(refresh), refresh_exp: Math.floor(now + REFRESH_TTL) }); save();
    return send(res, 200, { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope: SCOPE });
  }
  async function tokenEndpoint(req, res) {
    let b; const raw = await new Promise((ok, no) => { let s = ""; req.on("data", c => { s += c; if (s.length > 2e4) no(err(413, "Too large")); }); req.on("end", () => ok(s)); req.on("error", no); });
    try { b = /json/.test(req.headers["content-type"] || "") ? JSON.parse(raw || "{}") : Object.fromEntries(new URLSearchParams(raw)); } catch { return send(res, 400, { error: "invalid_request" }); }
    const bad = (e, d) => send(res, 400, { error: e, error_description: d });
    bump("token", 600);
    if (b.grant_type === "authorization_code") {
      const c = codes.get(String(b.code || "")); codes.delete(String(b.code || ""));
      if (!c || c.exp < Date.now()) return bad("invalid_grant", "Code expired or used");
      if (c.client.id !== b.client_id || c.redirect_uri !== b.redirect_uri) return bad("invalid_grant", "Client or redirect does not match");
      if (sha64(String(b.code_verifier || "")) !== c.challenge) return bad("invalid_grant", "PKCE check failed");
      const g = { id: token().slice(0, 16), owner: c.owner, client_id: c.client.id, client_name: c.client.name, created: new Date().toISOString() };
      store.grants.push(g); return issue(res, g);
    }
    if (b.grant_type === "refresh_token") {
      const h = sha64(String(b.refresh_token || "")), g = store.grants.find(x => x.refresh_hash === h);
      if (!g || g.refresh_exp < Date.now() / 1000 || (b.client_id && b.client_id !== g.client_id)) return bad("invalid_grant", "Refresh token not valid");
      return issue(res, g);
    }
    return bad("unsupported_grant_type");
  }
  async function register(req, res) {
    bump("register", 100);
    const b = await readJson(req, 2e4), uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String).slice(0, 10) : [];
    if (!uris.length || !uris.every(uriOk)) return send(res, 400, { error: "invalid_redirect_uri" });
    if (store.clients.length >= 500) store.clients.shift();
    const id = "sk-" + token().slice(0, 24), name = String(b.client_name || "App").slice(0, 80);
    store.clients.push({ id, name, redirect_uris: uris, created: new Date().toISOString() }); save();
    return send(res, 201, { client_id: id, client_name: name, redirect_uris: uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
  }
  /* true when the request was ours */
  async function route(req, res, url) {
    const p = url.pathname;
    try {
      if (p === "/.well-known/oauth-protected-resource" || p === "/.well-known/oauth-protected-resource/mcp") { send(res, 200, metaPR(req), { "access-control-allow-origin": "*" }); return true; }
      if (p === "/.well-known/oauth-authorization-server" || p === "/.well-known/oauth-authorization-server/mcp") { send(res, 200, metaAS(req), { "access-control-allow-origin": "*" }); return true; }
      if (p === "/oauth/authorize" && req.method === "GET") { await authorize(req, res, url); return true; }
      if (p === "/oauth/approve" && req.method === "POST") { await approve(req, res); return true; }
      if (p === "/oauth/token" && req.method === "POST") { await tokenEndpoint(req, res); return true; }
      if (p === "/oauth/register" && req.method === "POST") { await register(req, res); return true; }
      if (p === "/api/bruk" && req.method === "GET") { usage(req, res); return true; }
    } catch (e) { if (!res.headersSent) send(res, e.code === 429 ? 429 : e.code === 413 ? 413 : 400, { error: e.message }); return true; }
    return false;
  }
  return { userOf, proxyUser, challenge, count, route };
}
