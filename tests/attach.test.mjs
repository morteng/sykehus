/* What the chat box attaches (public/attach.js): the picture's cap and shrink, the file through /api/import, and the
   fields a message takes. Stubs only. node --test tests/attach.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PICTURE, MAX_FILE, isPicture, pictureOf, uploadFile, fieldsOf } from "../public/attach.js";

const file = (name, type, size = 10) => ({ name, type, size });
const url = (type, n) => `data:${type};base64,` + "A".repeat(n - `data:${type};base64,`.length);

test("only JPEG, PNG and WebP are pictures; everything else goes the file way", () => {
  for (const t of ["image/jpeg", "image/png", "image/webp"]) assert.equal(isPicture(file("a", t)), true, t);
  for (const t of ["image/gif", "image/svg+xml", "application/pdf", "", "model/gltf-binary"]) assert.equal(isPicture(file("a", t)), false, t);
  assert.equal(MAX_PICTURE, 2.5e6);
});

test("a picture at the cap goes as it is; one over it is shrunk to a JPEG that fits, and renamed", async () => {
  const shrunk = []; const shrink = async (f, max) => { shrunk.push(max); return url("image/jpeg", 1000); };
  const at = await pictureOf(file("plan.png", "image/png"), { read: async () => url("image/png", 2.5e6), shrink });
  assert.equal(at.image.length, 2.5e6); assert.equal(at.name, "plan.png"); assert.deepEqual(shrunk, [], "at the cap: not touched");
  const over = await pictureOf(file("foto.webp", "image/webp"), { read: async () => url("image/webp", 2.5e6 + 1), shrink });
  assert.deepEqual(shrunk, [2.5e6]); assert.match(over.image, /^data:image\/jpeg;base64,/); assert.equal(over.name, "foto.jpg");
  await assert.rejects(pictureOf(file("x.png", "image/png"), { read: async () => url("image/png", 3e6), shrink: async () => { throw new Error("Bildet er for stort, selv gjort mindre."); } }), /for stort/);
});

test("a file is read in through /api/import by name; the message gets its id, name and size, never the bytes", async () => {
  const calls = [], SHA = "a".repeat(64), f = file("drivhus.ifc", "", 1234);
  const post = async (u, o) => { calls.push({ u, o }); return { json: async () => ({ file: SHA, size_m: [4, 3, 2.5], format: "ifc" }) }; };
  const r = await uploadFile(f, post);
  assert.deepEqual(r, { file: SHA, name: "drivhus.ifc", size_m: [4, 3, 2.5] });
  assert.equal(calls[0].u, "api/import?filename=drivhus.ifc"); assert.equal(calls[0].o.method, "POST"); assert.equal(calls[0].o.body, f);
  assert.equal((await uploadFile(file("a b.stl", ""), async u => ({ json: async () => ({ file: SHA }) }))).size_m, undefined);
  await assert.rejects(uploadFile(file("x.ifc", "", MAX_FILE + 1), post), /større enn 100 MB/); assert.equal(calls.length, 1, "over the cap: not sent");
});

test("a refusal or a login page is not an attachment", async () => {
  await assert.rejects(uploadFile(file("a.obj", ""), async () => ({ json: async () => ({ error: "Velg enheten fila er tegnet i." }) })), /Velg enheten/);
  await assert.rejects(uploadFile(file("a.ifc", ""), async () => ({ json: async () => ({ ok: true }) })), /ikke lest/, "an answer without the file id is not one");
  await assert.rejects(uploadFile(file("a.ifc", ""), async () => { throw new Error("net"); }), /Fikk ikke sendt/);
});

test("fieldsOf: one picture or one file, nothing otherwise", () => {
  assert.deepEqual(fieldsOf(null), {});
  assert.deepEqual(fieldsOf({ picture: { image: "data:image/png;base64,AA", name: "a.png" } }), { picture: { image: "data:image/png;base64,AA", name: "a.png" } });
  assert.deepEqual(fieldsOf({ attachment: { file: "f", name: "n", size_m: [1, 2, 3] } }), { attachment: { file: "f", name: "n", size_m: [1, 2, 3] } });
});
