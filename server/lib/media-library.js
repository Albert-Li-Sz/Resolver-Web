import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { MEDIA_KINDS } from '../../public/js/media-library.js';
import { atomicWrite, cleanupTemps, DATA_DIR, readJSONFile } from './files.js';
import { jsonBytes } from './limits.js';

export function createMediaLibrary(directory = DATA_DIR) {
  const file = path.join(directory, 'media-library.json');
  let chain = cleanupTemps(directory);
  async function read() {
    try {
      const value = await readJSONFile(file, 8 * 1024 * 1024);
      if (!Array.isArray(value.items)) throw new Error('素材库格式无效');
      return value.items;
    } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  }
  function mutate(fn) {
    const operation = chain.then(async () => {
      const items = await read(); const result = fn(items);
      jsonBytes({ items }, 8 * 1024 * 1024, '素材规则库');
      await atomicWrite(file, JSON.stringify({ items }));
      return result;
    });
    chain = operation.catch(() => {}); return operation;
  }
  return {
    async list() { await chain; return read(); },
    save(input = {}) {
      const { kind, matchBy, url } = input;
      const key = typeof input.key === 'string' ? input.key.trim() : '';
      if (!Object.hasOwn(MEDIA_KINDS, kind) || !['id', 'name'].includes(matchBy) || !key || key.length > 300 || !/^\/media\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(url || '')) {
        throw Object.assign(new Error('请选择素材类型、匹配方式并填写有效 ID 或名称'), { status: 400, expose: true });
      }
      return mutate((items) => {
        let record = items.find((item) => item.kind === kind && item.matchBy === matchBy && item.key === key);
        if (!record) {
          if (items.length >= 5000) throw Object.assign(new Error('素材规则数量已达上限'), { status: 400, expose: true });
          record = { id: randomUUID() }; items.push(record);
        }
        Object.assign(record, { kind, matchBy, key, url, updatedAt: new Date().toISOString() }); return record;
      });
    },
    remove(id) { return mutate((items) => { const i = items.findIndex((item) => item.id === id); if (i < 0) return false; items.splice(i, 1); return true; }); },
  };
}
export const mediaLibrary = createMediaLibrary();
