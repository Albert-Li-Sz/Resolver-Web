import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inputError } from './limits.js';

export const DATA_DIR = process.env.RESOLVER_DATA_DIR || fileURLToPath(new URL('../../data/', import.meta.url));

export async function atomicWrite(file, contents) {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true });
  const temp = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, file);
    const dir = await open(directory, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  } finally { await rm(temp, { force: true }); }
}

export async function cleanupTemps(directory) {
  try {
    for (const name of await readdir(directory)) {
      if (!/^\..+\.[a-f0-9-]{36}\.tmp$/.test(name)) continue;
      const file = path.join(directory, name);
      if (Date.now() - (await stat(file)).mtimeMs > 24 * 60 * 60 * 1000) await rm(file, { force: true });
    }
  } catch (err) { if (err.code !== 'ENOENT') throw err; }
}

export async function readJSONFile(file, maxBytes = 64 * 1024 * 1024) {
  const handle = await open(file, 'r');
  try {
    if ((await handle.stat()).size > maxBytes) throw inputError('已保存数据超出容量上限，请由管理员检查');
    try { return JSON.parse(await handle.readFile('utf8')); }
    catch (err) { if (err instanceof SyntaxError) throw new Error('已保存的 JSON 数据损坏'); throw err; }
  } finally { await handle.close(); }
}
