import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { atomicWrite, cleanupTemps, DATA_DIR, readJSONFile } from './files.js';
import { inputError, jsonBytes, validateContestInput } from './limits.js';

export function createConfigStore(directory = DATA_DIR) {
  const file = path.join(directory, 'configs.json');
  let writeChain = cleanupTemps(directory);

  async function readAll() {
    try {
      const data = await readJSONFile(file);
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.configs)) return data.configs;
      throw new Error('配置文件格式无效');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      // Never silently overwrite a damaged/unreadable file with an empty list.
      throw err;
    }
  }

  function mutate(change) {
    // Serialize the whole read-modify-write transaction, not just writeFile.
    const operation = writeChain.then(async () => {
      const configs = await readAll();
      const result = change(configs);
      jsonBytes({ configs }, 64 * 1024 * 1024, '预设库');
      await atomicWrite(file, JSON.stringify({ configs }));
      return result;
    });
    // A failed write must not poison every subsequent operation.
    writeChain = operation.catch(() => {});
    return operation;
  }

  return {
    async listConfigs() {
      await writeChain;
      return (await readAll()).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .map(({ id, name, updatedAt, config, contest }) => ({ id, name, updatedAt, config, hasContest: Boolean(contest) }));
    },
    async getConfig(id) {
      await writeChain;
      return (await readAll()).find((record) => record.id === id) || null;
    },
    saveConfig({ id, name, config, contest }) {
      if (id != null && (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) return Promise.reject(inputError('预设 ID 无效'));
      if (!config || typeof config !== 'object' || Array.isArray(config)) return Promise.reject(inputError('配置内容无效'));
      if (contest != null) validateContestInput(contest);
      jsonBytes({ name, config, contest }, 4 * 1024 * 1024, '单条预设');
      return mutate((configs) => {
        const now = new Date().toISOString();
        const cleanName = String(name || '').trim().slice(0, 120) || '未命名配置';
        const existing = id && configs.find((record) => record.id === id);
        if (id && !existing) throw inputError('预设不存在，不能指定新预设的 ID', 404);
        if (existing) {
          existing.name = cleanName;
          existing.config = config ?? existing.config;
          if (contest !== undefined) existing.contest = contest;
          existing.updatedAt = now;
          return existing;
        }
        if (configs.length >= 60) throw inputError('预设数量已达上限 60，请先删除不需要的预设', 413);
        const record = { id: randomUUID(), name: cleanName, updatedAt: now, config: config ?? {}, contest: contest ?? null };
        configs.push(record);
        return record;
      });
    },
    deleteConfig(id) {
      return mutate((configs) => {
        const index = configs.findIndex((record) => record.id === id);
        if (index < 0) return false;
        configs.splice(index, 1);
        return true;
      });
    },
  };
}

export const { listConfigs, getConfig, saveConfig, deleteConfig } = createConfigStore();
