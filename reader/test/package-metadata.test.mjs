import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('package exposes a CLI and reusable server without runtime dependencies', () => {
  assert.equal(packageJson.name, 'scan2ebook-reader');
  assert.equal(packageJson.version, '0.1.0');
  assert.equal(packageJson.bin['scan2ebook-reader'], './bin/scan2ebook-reader.js');
  assert.equal(packageJson.exports['.'], './lib/server.js');
  assert.deepEqual(packageJson.dependencies || {}, {});
  assert.ok(packageJson.files.includes('dist'));
  assert.equal(packageJson.private, undefined);
});
