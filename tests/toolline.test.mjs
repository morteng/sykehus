/* A tool line in Anton's chat shows the receipt gulden-ai sends beside its label (gulden-no U3647), live and from the
   history (public/anton.js uses toolLine for both). node --test tests/toolline.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { toolLine } from "../public/toolline.js";

test("a tool with a receipt shows its label and the receipt's line; one without shows the label", () => {
  const checked = { type: "tool", key: "check_drawing", label: "Kontrollerte tegningen mot reglene", receipt: { line: "Kontrollen fant 1 avvik og 1 merknad · 0,04 $", step: null } };
  assert.equal(toolLine(checked), "Kontrollerte tegningen mot reglene: Kontrollen fant 1 avvik og 1 merknad · 0,04 $");
  assert.equal(toolLine({ type: "tool", key: "look", label: "Så på modellen" }), "Så på modellen");
  assert.equal(toolLine({ type: "tool", label: "Så på modellen", receipt: { line: "" } }), "Så på modellen");
});
