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

async function makeStorage() {
  return mkdtemp(join(tmpdir(), 'scan2ebook-reader-storage-'));
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
  const instance = await createReaderServer({ port: 0, distDir: await makeDist(), storageDir: await makeStorage() });
  try {
    const health = await fetch(`${instance.url}${HEALTH_PATH}`);
    assert.deepEqual(await health.json(), {
      app: 'scan2ebook-reader', version: '0.1.0', storageDir: instance.storageDir,
    });
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
  const instance = await createReaderServer({ port: 0, distDir: await makeDist(), storageDir: await makeStorage() });
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
  const storageDir = await makeStorage();
  const first = await createReaderServer({ port: 0, distDir, storageDir });
  try {
    const reused = await startReader({ port: first.port, distDir, storageDir, openBrowser: false });
    assert.equal(reused.reused, true);
  } finally {
    await first.close();
  }

  const unrelated = createHttpServer((_request, response) => response.end('not scan2ebook'));
  await new Promise((resolve) => unrelated.listen(0, '127.0.0.1', resolve));
  const address = unrelated.address();
  try {
    await assert.rejects(
      () => startReader({ port: address.port, distDir, storageDir, openBrowser: false }),
      PortInUseError,
    );
  } finally {
    await new Promise((resolve) => unrelated.close(resolve));
  }
});

test('不同端口通过同一数据目录共享书库和 PDF', async () => {
  const distDir = await makeDist();
  const storageDir = await makeStorage();
  const first = await createReaderServer({ port: 0, distDir, storageDir });
  const second = await createReaderServer({ port: 0, distDir, storageDir });
  try {
    const origin = first.url;
    const commandResponse = await fetch(`${first.url}/__scan2ebook__/storage/command`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'putBook', book: { id: 'shared-book', meta: { title: '共享书' } } }),
    });
    assert.equal(commandResponse.status, 200);
    const pdfResponse = await fetch(`${first.url}/__scan2ebook__/storage/books/shared-book/pdf`, {
      method: 'PUT',
      headers: { origin, 'content-type': 'application/pdf' },
      body: Buffer.from('%PDF-shared'),
    });
    assert.equal(pdfResponse.status, 200);

    const snapshot = await fetch(`${second.url}/__scan2ebook__/storage`).then((response) => response.json());
    assert.deepEqual(snapshot.books.map((book) => book.id), ['shared-book']);
    const pdf = await fetch(`${second.url}/__scan2ebook__/storage/books/shared-book/pdf`);
    assert.equal(await pdf.text(), '%PDF-shared');

    const crossOrigin = await fetch(`${second.url}/__scan2ebook__/storage/command`, {
      method: 'POST',
      headers: { origin: 'http://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'deleteBooks', ids: ['shared-book'] }),
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    await first.close();
    await second.close();
  }
});
