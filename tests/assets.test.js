import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAssetStore } from '../server/lib/assets.js';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=', 'base64');
test('photos are persisted as stable content-addressed URLs, with concurrent deduplication', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'resolver-images-'));
  try {
    const store = createAssetStore(directory);
    const results = await Promise.all([store.saveImage(pixel, 'image/png'), store.saveImage(pixel, 'image/png')]);
    assert.equal(results[0].url, results[1].url);
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    assert.deepEqual(await readFile(path.join(directory, files[0])), pixel);
    await assert.rejects(store.saveImage(Buffer.from('<svg/>'), 'image/svg+xml'), { status: 400 });
    await assert.rejects(store.saveImage(Buffer.from('<html/>'), 'image/png'), { status: 400 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('pixel bombs, count quotas and orphan cleanup never delete referenced images', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'resolver-image-quota-'));
  try {
    const store = createAssetStore(directory, { maxFiles: 1 });
    const saved = await store.saveImage(pixel, 'image/png');
    const bomb = Buffer.from(pixel); bomb.writeUInt32BE(100000, 16);
    await assert.rejects(store.saveImage(bomb, 'image/png'), /尺寸/);
    const different = Buffer.from(pixel); different[different.length - 1] ^= 1;
    await assert.rejects(store.saveImage(different, 'image/png'), { status: 413 });
    assert.equal(await store.collectUnused(new Set([saved.url]), { graceMs: -1 }), 0);
    assert.equal(await store.collectUnused(new Set(), { graceMs: -1 }), 1);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
