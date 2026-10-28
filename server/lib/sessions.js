import { randomBytes, randomUUID } from 'node:crypto';
import { actionIndicesFor, startIndexFor } from '../../public/js/playback-model.js';
import { LIMITS, inputError, jsonBytes } from './limits.js';

function spectatorSteps(steps) {
  return steps.map((step) => {
    if (!step.teamId || !Array.isArray(step.awards)) return step;
    // A detail page reveals this team only. A shared medal/FTS award can also
    // contain recipients whose rows have not been resolved yet. List pages
    // have no teamId and are emitted only after every recipient is revealed.
    return { ...step, awards: step.awards.map((award) => ({ ...award,
      teamIds: award.teamIds.filter((id) => id === step.teamId),
    })) };
  });
}

export class SessionStore {
  constructor({ ttl = 6 * 60 * 60 * 1000, maxGames = 80, activeGrace = 120_000,
    maxBytes = LIMITS.sessionBytes, maxClients = 500, maxClientsPerGame = 100, now = Date.now } = {}) {
    this.games = new Map();
    this.activeGameId = null;
    this.ttl = ttl;
    this.maxGames = maxGames;
    this.now = now;
    this.activeGrace = Math.min(activeGrace, ttl);
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.maxClients = maxClients;
    this.maxClientsPerGame = maxClientsPerGame;
    this.heartbeat = null;
  }

  remove(id) {
    const entry = this.games.get(id);
    if (!entry) return;
    for (const client of entry.clients) {
      client.write('event: expired\ndata: {}\n\n');
      client.end();
    }
    this.games.delete(id);
    if (this.activeGameId === id) this.activeGameId = null;
    this.bytes -= entry.bytes;
  }

  prune() {
    const now = this.now();
    for (const [id, entry] of this.games) {
      if (id !== this.activeGameId && now - entry.touchedAt >= this.ttl) this.remove(id);
    }
  }

  create(game) {
    this.prune();
    const id = randomUUID().replaceAll('-', '');
    const storedGame = { ...game, id };
    const bytes = jsonBytes(storedGame, LIMITS.gameBytes, '滚榜会话');
    const victims = [...this.games.values()].filter((entry) => entry.id !== this.activeGameId && !entry.clients.size && this.now() - entry.touchedAt >= this.activeGrace)
      .sort((a, b) => a.touchedAt - b.touchedAt);
    let count = this.games.size;
    let total = this.bytes;
    const removed = [];
    while (count >= this.maxGames || total + bytes > this.maxBytes) {
      const victim = victims.shift();
      if (!victim) throw inputError('滚榜会话容量已满，现有直播受到保护，请稍后重试', 503);
      removed.push(victim.id); count--; total -= victim.bytes;
    }
    for (const id of removed) this.remove(id);
    const entry = {
      id, game: storedGame, controlToken: randomBytes(32).toString('hex'),
      touchedAt: this.now(), index: startIndexFor(game), revision: 0,
      actions: actionIndicesFor(game.steps), clients: new Set(),
      bytes, snapshotRevision: -1, snapshotMessage: null,
    };
    this.games.set(id, entry);
    this.bytes += bytes;
    return entry;
  }

  get(id, { touch = true } = {}) {
    this.prune();
    const entry = this.games.get(id);
    if (entry && touch) entry.touchedAt = this.now();
    return entry;
  }

  publish(entry) {
    if (this.games.get(entry.id) !== entry) throw inputError('滚榜会话不存在', 404);
    this.activeGameId = entry.id;
  }

  current() {
    return this.activeGameId ? this.get(this.activeGameId, { touch: false }) : null;
  }

  playback(entry) {
    return {
      index: entry.index, revision: entry.revision,
      currentAction: entry.actions.indexOf(entry.index) + 1, totalActions: entry.actions.length,
    };
  }

  snapshot(entry) {
    // Full future steps and award recipients are only available to the presenter.
    return {
      game: {
        ...entry.game,
        contest: { ...entry.game.contest, awards: [] },
        steps: spectatorSteps(entry.game.steps.slice(0, entry.index + 1)),
      },
      playback: this.playback(entry),
    };
  }

  snapshotMessage(entry) {
    if (entry.snapshotRevision !== entry.revision) {
      entry.snapshotMessage = `event: snapshot\ndata: ${JSON.stringify(this.snapshot(entry))}\n\n`;
      entry.snapshotRevision = entry.revision;
    }
    return entry.snapshotMessage;
  }

  canSubscribe(entry) {
    const total = [...this.games.values()].reduce((sum, item) => sum + item.clients.size, 0);
    return entry.clients.size < this.maxClientsPerGame && total < this.maxClients;
  }

  // Share serialized messages and stream in bounded chunks, including the
  // initial snapshot. A lagging viewer reconnects to the latest revision.
  send(client, message) {
    if (client.destroyed || client.writableEnded || client.resolverSending || client.writableLength > 1024 * 1024) { client.destroy?.(); return; }
    if (typeof client.once !== 'function') { client.write(message); return; }
    let offset = 0;
    let timer;
    const cleanup = () => { clearTimeout(timer); client.off('drain', pump); client.off('close', cleanup); client.resolverSending = false; };
    const pump = () => {
      clearTimeout(timer);
      while (offset < message.length && !client.destroyed) {
        let end = Math.min(message.length, offset + 16_384);
        if (end < message.length && /[\uD800-\uDBFF]/.test(message[end - 1])) end--;
        const chunk = message.slice(offset, end); offset = end;
        const ready = client.write(chunk);
        if (client.writableLength > 1024 * 1024) { cleanup(); client.destroy(); return; }
        if (!ready) {
          client.once('drain', pump);
          timer = setTimeout(() => { cleanup(); client.destroy(); }, 15_000);
          timer.unref?.();
          return;
        }
      }
      cleanup();
    };
    client.resolverSending = true;
    client.once('close', cleanup);
    pump();
  }

  subscribe(entry, client) {
    entry.clients.add(client);
    this.send(client, this.snapshotMessage(entry));
    const lifetime = setTimeout(() => client.end(), this.ttl);
    lifetime.unref?.();
    client.once('close', () => { clearTimeout(lifetime); entry.clients.delete(client); });
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => {
        this.prune();
        let count = 0;
        for (const game of this.games.values()) for (const viewer of game.clients) {
          count++;
          if (!viewer.resolverSending) this.send(viewer, ': heartbeat\n\n');
        }
        if (!count) { clearInterval(this.heartbeat); this.heartbeat = null; }
      }, 15_000);
      this.heartbeat.unref?.();
    }
  }

  validateMove(entry, index, revision) {
    if (this.games.get(entry.id) !== entry) return { status: 404, error: '滚榜会话不存在或已过期' };
    if (!Number.isInteger(index) || !entry.actions.includes(index)) {
      return { status: 400, error: '无效的滚榜步骤' };
    }
    if (revision !== entry.revision) {
      return { status: 409, error: '主持进度已更新，请重试', playback: this.playback(entry) };
    }
    return null;
  }

  move(entry, index, revision) {
    const invalid = this.validateMove(entry, index, revision);
    if (invalid) return invalid;
    if (index === entry.index) return { playback: this.playback(entry) };
    const previous = entry.index;
    const sequential = entry.actions.indexOf(index) === entry.actions.indexOf(previous) + 1;
    entry.index = index;
    entry.revision += 1;
    entry.touchedAt = this.now();
    const message = sequential ? `event: advance\ndata: ${JSON.stringify({
      playback: this.playback(entry),
      steps: spectatorSteps(entry.game.steps.slice(previous + 1, index + 1)),
    })}\n\n` : this.snapshotMessage(entry);
    for (const client of entry.clients) {
      this.send(client, message);
    }
    return { playback: this.playback(entry) };
  }
}
