import test from "node:test"; import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { verifyRs256 } from "../oidc-verify.mjs";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "gulden-oidc", use: "sig", alg: "RS256" }] };
const enc = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (claims, head = { alg: "RS256", kid: "gulden-oidc" }, key = privateKey) => { const u = `${enc(head)}.${enc(claims)}`; return `${u}.${createSign("RSA-SHA256").update(u).sign(key).toString("base64url")}`; };
const good = { iss: "https://auth.gulden.no", aud: ["sykehus"], exp: 2e9, preferred_username: "okter" };
const opt = { iss: "https://auth.gulden.no", aud: "sykehus", now: 1e9 };

test("a good token gives its claims", () => assert.equal(verifyRs256(mint(good), jwks, opt).preferred_username, "okter"));
test("wrong issuer, audience, expired, unknown kid, other key, alg none: all null", () => {
  assert.equal(verifyRs256(mint({ ...good, iss: "https://x" }), jwks, opt), null);
  assert.equal(verifyRs256(mint({ ...good, aud: ["fab"] }), jwks, opt), null);
  assert.equal(verifyRs256(mint({ ...good, exp: 5 }), jwks, opt), null);
  assert.equal(verifyRs256(mint(good, { alg: "RS256", kid: "other" }), jwks, opt), null);
  assert.equal(verifyRs256(mint(good, undefined, generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey), jwks, opt), null);
  assert.equal(verifyRs256(`${enc({ alg: "none" })}.${enc(good)}.`, jwks, opt), null);
});
