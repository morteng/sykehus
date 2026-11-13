/* U4185: verify an RS256 access token from the one authorization server (Authelia, key id gulden-oidc) against its JWKS.
   Pure and synchronous: the caller hands in the key set (read from a file), so no network sits in the request path. Returns the claims or null. */
import { createPublicKey, verify } from "node:crypto";

const b64 = s => Buffer.from(s, "base64url");

export function verifyRs256(token, jwks, { iss, aud, now = Date.now() / 1000 } = {}) {
  if (typeof token !== "string" || token.length > 4096 || !iss) return null;
  const p = token.split("."); if (p.length !== 3) return null;
  let head, claims;
  try { head = JSON.parse(b64(p[0])); claims = JSON.parse(b64(p[1])); } catch { return null; }
  if (head?.alg !== "RS256") return null;   // never "none", never HS256 with the public key
  const jwk = (jwks?.keys || []).find(k => k.kty === "RSA" && k.kid === head.kid && (!k.use || k.use === "sig")); if (!jwk) return null;
  let ok; try { ok = verify("RSA-SHA256", Buffer.from(`${p[0]}.${p[1]}`), createPublicKey({ key: jwk, format: "jwk" }), b64(p[2])); } catch { return null; }
  if (!ok || claims.iss !== iss) return null;
  if (typeof claims.exp !== "number" || claims.exp < now || (typeof claims.nbf === "number" && claims.nbf > now + 30)) return null;
  const a = [].concat(claims.aud ?? []); if (aud && !a.includes(aud)) return null;
  return claims;
}
