import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createConfigStore } from '../server/lib/store.js';

test('concurrent preset saves and deletes preserve every transaction', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'resolver-store-'));
  try {
    const store = createConfigStore(directory);
    const records = await Promise.all(Array.from({ length: 20 }, (_, i) => store.saveConfig({ name: `Preset ${i}`, config: { i } })));
    assert.equal((await store.listConfigs()).length, 20);
    await Promise.all([
      store.deleteConfig(records[0].id),
      store.saveConfig({ id: records[1].id, name: 'Updated', config: { updated: true } }),
      store.saveConfig({ name: 'New', config: {} }),
    ]);
    assert.equal((await store.listConfigs()).length, 20);
    assert.equal(await store.getConfig(records[0].id), null);
    assert.equal((await store.getConfig(records[1].id)).name, 'Updated');
    assert.ok((await store.listConfigs()).some((item) => item.name === 'New'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('new preset IDs are issued by the server and oversized records do not change saved data', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'resolver-store-quota-'));
  try {
    const store = createConfigStore(directory);
    await assert.rejects(store.saveConfig({ id: 'chosen', config: {} }), { status: 404 });
    await assert.rejects(store.saveConfig({ id: 123, config: {} }), { status: 400 });
    const record = await store.saveConfig({ name: 'Retain', config: {} });
    assert.throws(() => store.saveConfig({ id: record.id, config: { huge: 'a'.repeat(4 * 1024 * 1024) } }), { status: 413 });
    assert.equal((await store.getConfig(record.id)).name, 'Retain');
    assert.equal((await store.listConfigs()).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('damaged preset files are preserved and the queue recovers after repair', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'resolver-store-'));
  const file = path.join(directory, 'configs.json');
  try {
    const store = createConfigStore(directory);
    await writeFile(file, '{broken');
    await assert.rejects(store.saveConfig({ config: {} }));
    assert.equal(await readFile(file, 'utf8'), '{broken');
    await writeFile(file, '{"configs":[]}');
    const recovered = await store.saveConfig({ config: {} });
    assert.ok(await store.getConfig(recovered.id));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
