// U3896: the full-run script exists, is executable and prints the one count line the landing quotes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const path = new URL('../tools/test-all.sh', import.meta.url);

test('tools/test-all.sh is executable and runs every tests/**/*.test.mjs', () => {
  assert.ok(statSync(path).mode & 0o100, 'executable');
  const src = readFileSync(path, 'utf8');
  assert.match(src, /find tests -name '\*\.test\.mjs'/);
  assert.match(src, /node --test/);
  assert.match(src, /sykehus full run: .* files, .* tests, .* pass, .* fail, .* skipped, .* cancelled/);
});
