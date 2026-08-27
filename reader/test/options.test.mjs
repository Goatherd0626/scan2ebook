import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCliArgs, validateHost, validatePort } from '../lib/options.js';

test('CLI options use a stable default origin', () => {
  assert.deepEqual(parseCliArgs([]), {
    host: '127.0.0.1', port: 8765, openBrowser: true, help: false, version: false,
  });
});

test('CLI options parse explicit values', () => {
  assert.deepEqual(parseCliArgs(['--host=localhost', '--port', '9000', '--no-open']), {
    host: 'localhost', port: 9000, openBrowser: false, help: false, version: false,
  });
});

test('CLI options reject unsafe host, invalid port and unknown arguments', () => {
  assert.throws(() => validateHost('0.0.0.0'), /只允许/);
  assert.throws(() => validatePort(80), /1024/);
  assert.throws(() => validatePort(65536), /65535/);
  assert.throws(() => parseCliArgs(['--unknown']), /未知参数/);
});
