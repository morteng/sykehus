/* The one way this server calls gulden-ai's door (/internal/sykehus/*): the bearer, the JSON, the 15 s limit, and a 503 {error:{code:"unavailable"}}
   when the door cannot be reached. The pill's relay (assistant.mjs) and the feedback form (wishes.mjs) both use it (U3978: one copy).
   login.base and login.bearer are the SYKEHUS_ASSISTANT_URL and _TOKEN (login.mjs). */

/* why a fetch to gulden-ai failed: undici's "fetch failed" hides it in e.cause (ECONNREFUSED, UND_ERR_SOCKET, a reset) */
export const whyOf = e => [e.name, e.message, e.cause?.code, e.cause?.message].filter(Boolean).join(" / ");
export const codeOf = (j, d) => typeof j?.error?.code === "string" ? j.error.code : typeof j?.code === "string" ? j.code : d;

export function createDoor({ login, fetchImpl = fetch, prefix = process.env.SYKEHUS_ASSISTANT_PREFIX || "/internal/sykehus" }) {
  const url = login.base + prefix.replace(/\/+$/, "");
  /* [status, json]; device (the browser's key) is sent when there is one */
  const call = async (path, body, query, device) => {
    const q = query ? "?" + new URLSearchParams(query) : "";
    try {
      const r = await fetchImpl(url + path + q, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${login.bearer}`, accept: "application/json", ...(device ? { "x-door-device": device } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
      return [r.status, await r.json().catch(() => ({}))];
    } catch (e) { console.error("anton", path, whyOf(e)); return [503, { error: { code: "unavailable" } }]; }
  };
  return { url, call, ready: !!(login.base && login.bearer) };
}
