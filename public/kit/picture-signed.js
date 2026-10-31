// A signed picture address (U3991), for a Node server that draws a person's own picture through the scaler (imgproxy). The key
// stays on the server: this file is never taken into a browser page. It makes the address the Python twin (ukit.py signed())
// makes; both are held to tests/px-sign.vectors.json, whose first case was computed by hand with openssl from imgproxy's rule:
// signature = base64url (no padding) of HMAC-SHA256(key, salt + path), path = everything after the signature.
import { bucket } from "./picture.js";
const SAFE = /^\/[A-Za-z0-9._~/-]+$/;
const RAW = /\.(svg|gif)$|^(data|blob):/i;
const unhex = (h) => {
    if (!/^([0-9a-f]{2})+$/i.test(h))
        throw new Error("a signing key or salt is hex");
    return new Uint8Array(h.match(/../g).map((b) => parseInt(b, 16)));
};
const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** An expiry that holds still for an hour (the browser keeps the picture) and is at least `ttl` seconds away. */
export function pxExp(nowSeconds, ttl = 86400) {
    return (Math.floor(nowSeconds / 3600) + 1) * 3600 + ttl;
}
/** imgproxy's signature of `rest` (everything after the signature in the address). */
export async function pxSign(rest, keyHex, saltHex) {
    const key = await crypto.subtle.importKey("raw", unhex(keyHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const salt = unhex(saltHex), body = new TextEncoder().encode(rest);
    const msg = new Uint8Array(salt.length + body.length);
    msg.set(salt);
    msg.set(body, salt.length);
    return b64url(await crypto.subtle.sign("HMAC", key, msg));
}
/** The signed scaler address of an app path at width `w`, valid until `exp` (unix seconds); null when the path cannot go through it. */
export async function signed(path, w, origin, keyHex, saltHex, exp, base = "/px") {
    if (!SAFE.test(path) || path.includes("..") || RAW.test(path) || !keyHex || !saltHex)
        return null;
    const rest = `/rs:fit:${bucket(w)}:0/exp:${Math.trunc(exp)}/plain/${origin.replace(/\/+$/, "")}${path}`;
    return `${base}/${await pxSign(rest, keyHex, saltHex)}${rest}`;
}
