import path from 'node:path';
import { readdir, rm } from 'node:fs/promises';
import { atomicWrite, cleanupTemps, DATA_DIR, readJSONFile } from './files.js';
import { SessionStore } from './sessions.js';
import { actionIndicesFor } from '../../public/js/playback-model.js';
import { LIMITS, jsonBytes } from './limits.js';

// One durable live show. Previews remain temporary. The small pointer is also
// the progress journal: publishing and advancing each have one atomic commit.
export class LiveSessionStore extends SessionStore {
  constructor({ directory = path.join(DATA_DIR, 'live'), write = atomicWrite, ...options } = {}) {
    super(options);
    this.directory = directory;
    this.write = write;
    this.pointer = path.join(directory, 'current.json');
    this.chain = Promise.resolve();
  }

  async restore() {
    await cleanupTemps(this.directory);
    let record;
    try { record = await readJSONFile(this.pointer, 4096); }
    catch (err) { if (err.code === 'ENOENT') return; throw err; }
    if (record.version !== 1 || !/^[a-f0-9]{32}$/.test(record.id) ||
      !Number.isSafeInteger(record.revision) || record.revision < 0) throw new Error('直播恢复记录损坏，请保留 data/live 并检查备份');
    const saved = await readJSONFile(path.join(this.directory, `${record.id}.json`), LIMITS.gameBytes + 4096);
    const game = saved.game;
    if (game?.id !== record.id || !Array.isArray(game.steps) || !Array.isArray(game.contest?.teams) ||
      !/^[a-f0-9]{64}$/.test(saved.controlToken)) throw new Error('直播赛事数据损坏');
    const actions = actionIndicesFor(game.steps);
    if (!actions.includes(record.index)) throw new Error('直播进度无效');
    const entry = { id: record.id, game, controlToken: saved.controlToken, actions,
      index: record.index, revision: record.revision, touchedAt: this.now(),
      savedAt: record.savedAt, clients: new Set(), bytes: jsonBytes(game, LIMITS.gameBytes, '滚榜会话'),
      snapshotRevision: -1, snapshotMessage: null };
    this.games.set(entry.id, entry);
    this.bytes += entry.bytes;
    super.publish(entry);
    await this.cleanup();
  }

  serial(operation) {
    const pending = this.chain.then(operation);
    this.chain = pending.catch(() => {});
    return pending;
  }

  record(entry, index = entry.index, revision = entry.revision) {
    return { version: 1, id: entry.id, index, revision, savedAt: this.now() };
  }

  publish(entry) {
    return this.serial(async () => {
      if (this.games.get(entry.id) !== entry) throw new Error('会话已失效');
      await this.write(path.join(this.directory, `${entry.id}.json`), JSON.stringify({ game: entry.game, controlToken: entry.controlToken }));
      const record = this.record(entry);
      await this.write(this.pointer, JSON.stringify(record));
      entry.savedAt = record.savedAt;
      super.publish(entry);
      // Orphan files from an interrupted publication are safe to remove only
      // after the new pointer is durable. Cleanup failure cannot undo a commit.
      await this.cleanup().catch(() => {});
    });
  }

  move(entry, index, revision) {
    return this.serial(async () => {
      const invalid = this.validateMove(entry, index, revision);
      if (invalid) return invalid;
      if (index !== entry.index && entry.id === this.activeGameId) {
        const record = this.record(entry, index, entry.revision + 1);
        await this.write(this.pointer, JSON.stringify(record));
        entry.savedAt = record.savedAt;
      }
      return super.move(entry, index, revision);
    });
  }

  async cleanup() {
    for (const name of await readdir(this.directory)) {
      if (/^[a-f0-9]{32}\.json$/.test(name) && name !== `${this.activeGameId}.json`) {
        await rm(path.join(this.directory, name), { force: true });
      }
    }
  }
}
