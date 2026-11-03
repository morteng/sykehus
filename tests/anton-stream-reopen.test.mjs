// U3622: a 502 on the way back closes an EventSource for good; anton.js must open the stream again and draw the thread
import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../public/anton.js", import.meta.url), "utf8");
test("the stream is opened again when the browser closed it", () => {
  assert.match(src, /readyState === EventSource\.CLOSED[\s\S]{0,200}connect\(\)/, "a closed stream is connected again");
  assert.match(src, /bound\.push\(\[ev, g\]\)/, "listeners are kept to bind to the new stream");
  assert.match(src, /const onOpen = async \(\) => \{\s*if \(!dropped\) return;[\s\S]{0,200}fromHistory\(\)/, "the chat is drawn again from the thread when it is back");
});
