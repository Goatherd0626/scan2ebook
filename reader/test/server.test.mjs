import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HEALTH_PATH,
  PortInUseError,
  createReaderServer,
  startReader,
} from '../lib/server.js';

async function makeDist() {
  const root = await mkdtemp(join(tmpdir(), 'scan2ebook-reader-'));
  const dist = join(root, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>Reader</title>');
  await writeFile(join(dist, 'assets', 'app-test.mjs'), 'export const ready = true;');
  return dist;
}

function rawRequest(port, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path, method }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({
        status: response.statusCode,
        body,
        headers: response.headers,
      }));
    });
    request.once('error', reject);
    request.end();
  });
}

test('serves health, index and immutable Vite assets', async () => {
  const instance = await createReaderServer({ port: 0, distDir: await makeDist() });
  try {
    const health = await fetch(`${instance.url}${HEALTH_PATH}`);
    assert.deepEqual(await health.json(), { app: 'scan2ebook-reader', version: '0.1.0' });
    assert.equal(health.headers.get('cache-control'), 'no-store');

    const index = await fetch(instance.url);
    const indexBody = await index.text();
    assert.match(indexBody, /Reader/);
    assert.equal(index.headers.get('cache-control'), 'no-cache');

    const indexHead = await rawRequest(instance.port, '/', 'HEAD');
    assert.equal(indexHead.status, 200);
    assert.equal(indexHead.body, '');
    assert.equal(Number(indexHead.headers['content-length']), Buffer.byteLength(indexBody));

    const asset = await fetch(`${instance.url}/assets/app-test.mjs`);
    assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  } finally {
    await instance.close();
  }
});

test('rejects path traversal and unsupported methods', async () => {
  const instance = await createReaderServer({ port: 0, distDir: await makeDist() });
  try {
    const traversal = await rawRequest(instance.port, '/%2e%2e/secret.txt');
    assert.ok([400, 404].includes(traversal.status));
    const method = await fetch(instance.url, { method: 'POST' });
    assert.equal(method.status, 405);
  } finally {
    await instance.close();
  }
});

test('reuses an existing reader but rejects an unrelated service', async () => {
  const distDir = await makeDist();
  const first = await createReaderServer({ port: 0, distDir });
  try {
    const reused = await startReader({ port: first.port, distDir, openBrowser: false });
    assert.equal(reused.reused, true);
  } finally {
    await first.close();
  }

  const unrelated = createHttpServer((_request, response) => response.end('not scan2ebook'));
  await new Promise((resolve) => unrelated.listen(0, '127.0.0.1', resolve));
  const address = unrelated.address();
  try {
    await assert.rejects(
      () => startReader({ port: address.port, distDir, openBrowser: false }),
      PortInUseError,
    );
  } finally {
    await new Promise((resolve) => unrelated.close(resolve));
  }
});
