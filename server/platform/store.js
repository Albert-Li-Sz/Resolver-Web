import path from "node:path";
import { engineJob } from "../lib/engine-job.js";
import { mkdir, appendFile, readFile, rm } from "node:fs/promises";
import { atomicWrite, DATA_DIR, readJSONFile } from "../lib/files.js";
import { normalizeContest, parseEventFeed } from "../lib/engine.js";
import { inputError, LIMITS, jsonBytes } from "../lib/limits.js";
import {
  id,
  secret,
  hash,
  code,
  clone,
  text,
  scene,
  sceneDefault,
  program,
  publicContest,
  sceneMediaIds,
  normalizeEvent,
  clockMetadata,
} from "./model.js";
export class PlatformStore {
  constructor({
    directory = path.join(DATA_DIR, "platform"),
    now = Date.now,
  } = {}) {
    this.directory = directory;
    this.now = now;
    this.queue = Promise.resolve();
    this.listeners = new Set();
    this.records = new Map();
    this.recordSizes = new Map();
    this.runtime = new Map();
    this.state = {
      version: 1,
      revision: 0,
      activeWorkspaceId: null,
      workspaces: [],
      broadcast: {
        preview: sceneDefault(),
        program: sceneDefault(),
        revision: 0,
        token: secret(),
      },
      displays: [],
      plans: [],
      media: [],
    };
  }
  async restore() {
    try {
      this.state = await readJSONFile(
        path.join(this.directory, "state.json"),
        16 * 1024 * 1024,
      );
      if (this.state.version !== 1) throw Error("平台数据版本不兼容");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    let total = 0;
    for (const w of this.state.workspaces) {
      if (
        !/^[a-f0-9]{32}$/.test(w.id) ||
        (w.file && !new RegExp(`^${w.id}\\.r[0-9]+\\.json$`).test(w.file))
      )
        throw Error("赛事检查点路径无效");
      const record = await readJSONFile(
        path.join(this.directory, w.file || `${w.id}.json`),
        96 * 1024 * 1024,
      );
      const size = Buffer.byteLength(JSON.stringify(record));
      total += size;
      if (total > 256 * 1024 * 1024) throw Error("赛事工作区总容量超过 256 MB");
      this.records.set(w.id, record);
      this.recordSizes.set(w.id, size);
    }
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {}
    }
  }
  async change(fn) {
    const run = this.queue.then(async () => {
      const old = clone(this.state);
      const oldRecords = new Map(this.records);
      const oldSizes = new Map(this.recordSizes);
      const staged = (this.staged = new Map());
      try {
        const result = await fn();
        if (result?.__unchanged) return clone(result.value);
        for (const [key, file] of staged)
          this.state.workspaces.find((w) => w.id === key).file = file;
        this.state.revision++;
        jsonBytes(this.state, 16 * 1024 * 1024, "平台配置");
        await atomicWrite(
          path.join(this.directory, "state.json"),
          JSON.stringify(this.state),
        );
        this.emit();
        // State points at complete immutable checkpoints before old ones are removed.
        for (const [key, file] of staged) {
          const previous = old.workspaces.find((w) => w.id === key);
          const oldFile = previous && (previous.file || `${key}.json`);
          if (oldFile && oldFile !== file)
            void rm(path.join(this.directory, oldFile), { force: true }).catch(
              () => {},
            );
        }
        return clone(result ?? this.state);
      } catch (e) {
        this.state = old;
        this.records = oldRecords;
        this.recordSizes = oldSizes;
        for (const file of staged.values())
          await rm(path.join(this.directory, file), { force: true }).catch(
            () => {},
          );
        throw e;
      } finally {
        this.staged = null;
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }
  check(revision, current = this.state.revision) {
    if (!Number.isInteger(revision) || revision !== current)
      throw inputError("内容已更新，请刷新后重试", 409);
  }
  workspace(key = this.state.activeWorkspaceId) {
    const w = this.records.get(key);
    if (!w) throw inputError("请先选择赛事工作区", 404);
    return w;
  }
  async createWorkspace(raw) {
    return this.change(async () => {
      if (this.state.workspaces.length >= 20)
        throw inputError("最多保存 20 个赛事工作区");
      const contest = raw.feed
        ? await engineJob(
            "parse",
            parseLines(raw.feed)
              .map((e) => JSON.stringify(normalizeEvent(e)))
              .join("\n"),
          )
        : normalizeContest(
            raw.contest || {
              name: raw.name || "新赛事",
              teams: [],
              problems: [],
            },
          );
      const w = {
        id: id(),
        name: text(raw.name || contest.name),
        contest,
        events: raw.feed ? parseLines(raw.feed).map(normalizeEvent) : [],
        source: null,
        unlocked: false,
        revision: 0,
        savedAt: this.now(),
        cursor: null,
      };
      await this.writeWorkspace(w);
      this.state.workspaces.push({ id: w.id, name: w.name });
      this.state.activeWorkspaceId = w.id;
      return this.workspaceAdmin(w);
    });
  }
  async writeWorkspace(w) {
    const bytes = jsonBytes(w, 96 * 1024 * 1024, "赛事工作区");
    const other = [...this.records.entries()]
      .filter(([key]) => key !== w.id)
      .reduce(
        (total, [key, record]) =>
          total +
          (this.recordSizes.get(key) ||
            Buffer.byteLength(JSON.stringify(record))),
        0,
      );
    if (bytes + other > 256 * 1024 * 1024)
      throw inputError("赛事工作区总容量超过 256 MB，请先归档旧赛事", 413);
    const file = `${w.id}.r${w.revision}.json`;
    await atomicWrite(path.join(this.directory, file), JSON.stringify(w));
    this.staged.set(w.id, file);
    this.records.set(w.id, w);
    this.recordSizes.set(w.id, bytes);
  }
  workspaceContest(w) {
    const contest = clone(w.contest);
    if (w.assets?.logo) contest.logo = w.assets.logo;
    for (const team of contest.teams)
      Object.assign(team, w.assets?.teams?.[team.id] || {});
    return contest;
  }
  workspaceAdmin(w) {
    return {
      ...clone(w),
      contest: this.workspaceContest(w),
      events: undefined,
      source: w.source
        ? {
            ...w.source,
            password: undefined,
            bearer: undefined,
            hasPassword: !!w.source.password,
            hasBearer: !!w.source.bearer,
          }
        : null,
    };
  }
  admin() {
    return {
      ...clone(this.state),
      activeWorkspace: this.state.activeWorkspaceId
        ? this.workspaceAdmin(this.workspace())
        : null,
      displays: this.state.displays
        .filter((d) => d.paired)
        .map((d) => this.displayAdmin(d)),
      media: this.state.media.map((m) => ({
        ...m,
        password: undefined,
        token: undefined,
        hasPassword: !!m.password,
      })),
      serverTime: this.now(),
    };
  }
  publicState() {
    const w = this.state.activeWorkspaceId ? this.workspace() : null;
    if (this.cachedPublic?.revision === this.state.revision)
      return { ...this.cachedPublic, serverTime: this.now() };
    const value = {
      revision: this.state.revision,
      serverTime: this.now(),
      workspaceId: w?.id,
      data: w
        ? {
            ...publicContest(this.workspaceContest(w), w.unlocked),
            clock: clockMetadata(w.events),
          }
        : null,
      broadcast: {
        program: clone(this.state.broadcast.program),
        revision: this.state.broadcast.revision,
      },
      media: this.state.media
        .filter((m) =>
          sceneMediaIds(
            this.state.broadcast.program,
            this.state.media,
          ).includes(m.id),
        )
        .map((m) => ({
          id: m.id,
          name: m.name,
          teamId: m.teamId,
          role: m.role,
          kind: m.kind,
          fallbackId: m.fallbackId,
        })),
      resolver: true,
    };
    this.cachedPublic = value;
    return value;
  }
  async updateWorkspace(key, raw) {
    return this.change(async () => {
      const w = clone(this.workspace(key));
      this.check(raw.revision, w.revision);
      if (raw.name !== undefined) w.name = text(raw.name);
      if (raw.source !== undefined) {
        const previous = w.source;
        w.source = raw.source
          ? validateSource({
              ...raw.source,
              password: raw.source.password ?? previous?.password,
              bearer: raw.source.bearer ?? previous?.bearer,
            })
          : null;
        if (
          w.source &&
          JSON.stringify([
            previous?.url,
            previous?.mode,
            previous?.contestId,
          ]) !==
            JSON.stringify([w.source.url, w.source.mode, w.source.contestId])
        ) {
          w.events = [];
          w.cursor = null;
          w.contest = normalizeContest({
            name: w.name,
            teams: [],
            problems: [],
          });
        }
      }
      if (raw.assets) {
        const url = (value) => {
          const v = text(value, 4096);
          if (
            v &&
            !/^(https?:\/\/|\/media\/[a-f0-9]{64}\.(?:png|jpg|webp)$|\/assets\/img\/icpc-logo\.png$)/.test(
              v,
            )
          )
            throw inputError("素材地址需要 HTTP(S) 或已上传的图片");
          return v;
        };
        w.assets ||= { teams: {} };
        if (raw.assets.logo !== undefined) w.assets.logo = url(raw.assets.logo);
        if (raw.assets.teamId) {
          const teamId = text(raw.assets.teamId, 100);
          if (!w.contest.teams.some((t) => t.id === teamId))
            throw inputError("队伍不存在");
          const asset = (w.assets.teams[teamId] ||= {});
          for (const key of ["logo", "photo"])
            if (raw.assets[key] !== undefined) {
              const value = url(raw.assets[key]);
              if (value) asset[key] = value;
              else delete asset[key];
            }
        }
      }
      if (raw.contest) w.contest = normalizeContest(raw.contest);
      if (typeof raw.unlocked === "boolean") w.unlocked = raw.unlocked;
      w.revision++;
      w.savedAt = this.now();
      await this.writeWorkspace(w);
      const meta = this.state.workspaces.find((x) => x.id === key);
      meta.name = w.name;
      return this.workspaceAdmin(w);
    });
  }
  async ingest(key, events, { cursor, sourceFingerprint } = {}) {
    return this.change(async () => {
      if (
        !Array.isArray(events) ||
        events.length > LIMITS.events ||
        events.some((e) => !e || typeof e !== "object" || Array.isArray(e))
      )
        throw inputError("请提供有效的事件对象数组");
      const w = clone(this.workspace(key));
      if (sourceFingerprint && JSON.stringify(w.source) !== sourceFingerprint)
        return { __unchanged: true, value: this.workspaceAdmin(w) };
      const known = new Set(
        w.events.map((e) => e.token || e.event_id || JSON.stringify(e)),
      );
      const added = events.map(normalizeEvent).filter((e) => {
        const k = e.token || e.event_id || JSON.stringify(e);
        if (known.has(k)) return false;
        known.add(k);
        return true;
      });
      if (!added.length)
        return { __unchanged: true, value: this.workspaceAdmin(w) };
      const all = w.events.concat(added);
      if (all.length > LIMITS.events)
        throw inputError("赛事事件数量超出容量", 413);
      const feed = all.map((e) => JSON.stringify(e)).join("\n");
      w.contest = await engineJob("parse", feed);
      w.events = all;
      w.cursor = cursor ?? added.at(-1)?.token ?? w.cursor;
      w.revision++;
      w.savedAt = this.now();
      await mkdir(this.directory, { recursive: true });
      await appendFile(
        path.join(this.directory, `${key}.ndjson`),
        added.map((e) => JSON.stringify(e)).join("\n") + "\n",
        { mode: 0o600 },
      );
      await this.writeWorkspace(w);
      return this.workspaceAdmin(w);
    });
  }
  async register() {
    return this.change(() => {
      this.state.displays = this.state.displays.filter(
        (d) => d.paired || d.expiresAt > this.now(),
      );
      if (this.state.displays.length >= 100)
        throw inputError("展示端数量已达上限", 429);
      const token = secret();
      let pairingCode;
      do {
        pairingCode = code();
      } while (this.state.displays.some((d) => d.code === pairingCode));
      const d = {
        id: id(),
        tokenHash: hash(token),
        code: pairingCode,
        expiresAt: this.now() + 600000,
        paired: false,
        name: "待配对屏幕",
        group: "",
        revision: 0,
        hidden: false,
        program: program({ items: [{ type: "logo" }] }),
        startedAt: this.now(),
        paused: false,
        offset: 0,
      };
      this.state.displays.push(d);
      return { id: d.id, token, code: d.code, expiresAt: d.expiresAt };
    });
  }
  device(key, token) {
    const d = this.state.displays.find((x) => x.id === key);
    if (!d || hash(token) !== d.tokenHash)
      throw inputError("展示端身份无效，请重新配对", 403);
    return d;
  }
  displayAdmin(d) {
    const r = this.runtime.get(d.id) || {};
    return {
      ...clone(d),
      tokenHash: undefined,
      code: undefined,
      online: this.now() - (r.seenAt || 0) < 15000,
      seenAt: r.seenAt || null,
      thumbnail: r.thumbnail || null,
      appliedRevision: r.appliedRevision ?? null,
      appliedAt: r.appliedAt ?? null,
      clockOffset: r.clockOffset || 0,
    };
  }
  deviceState(d) {
    return {
      id: d.id,
      name: d.name,
      group: d.group,
      paired: d.paired,
      code: d.paired ? undefined : d.code,
      expiresAt: d.expiresAt,
      revision: d.revision,
      hidden: d.hidden,
      program: d.program,
      startedAt: d.startedAt,
      paused: d.paused,
      offset: d.offset,
      effectiveAt: d.effectiveAt || 0,
      serverTime: this.now(),
      state: d.paired ? this.publicState() : null,
    };
  }
  async pair(raw) {
    return this.change(() => {
      const d = this.state.displays.find(
        (d) => !d.paired && d.code === raw.code && d.expiresAt > this.now(),
      );
      if (!d) throw inputError("链接码无效、已使用或已过期", 404);
      d.paired = true;
      delete d.code;
      d.name = text(raw.name) || "展示屏";
      d.revision++;
      return this.displayAdmin(d);
    });
  }
  async command(raw) {
    return this.change(() => {
      const selected = this.state.displays.filter(
        (d) => d.paired && raw.ids?.includes(d.id),
      );
      if (!selected.length) throw inputError("请先选择展示屏");
      const start = this.now() + 750;
      for (const d of selected) {
        if (raw.revisions?.[d.id] !== d.revision)
          throw inputError("屏幕状态已改变，请刷新后重试", 409);
        if (raw.action === "rename") {
          d.name = text(raw.name) || d.name;
          d.group = text(raw.group, 80);
        } else if (raw.action === "apply") {
          d.program = program(raw.program);
          d.effectiveAt = start;
          d.startedAt = start;
          d.offset = 0;
          d.paused = false;
        } else if (raw.action === "hide") d.hidden = true;
        else if (raw.action === "show") d.hidden = false;
        else if (raw.action === "pause") {
          if (!d.paused) d.offset = Math.max(0, this.now() - d.startedAt);
          d.paused = true;
        } else if (raw.action === "resume") {
          if (d.paused) {
            d.startedAt = start - d.offset;
            d.effectiveAt = start;
            d.paused = false;
          }
        } else if (["next", "previous"].includes(raw.action)) {
          let total = 0;
          const elapsed = d.paused
            ? d.offset
            : Math.max(0, this.now() - d.startedAt);
          const length = d.program.items.reduce(
            (a, v) => a + v.duration * 1000,
            0,
          );
          const phase = d.program.loop
            ? elapsed % length
            : Math.min(elapsed, length - 1);
          let current = 0;
          for (let i = 0; i < d.program.items.length; i++) {
            total += d.program.items[i].duration * 1000;
            if (phase < total) {
              current = i;
              break;
            }
          }
          const index =
            (current +
              (raw.action === "next" ? 1 : -1) +
              d.program.items.length) %
            d.program.items.length;
          const offset = d.program.items
            .slice(0, index)
            .reduce((a, v) => a + v.duration * 1000, 0);
          d.startedAt = start - offset;
          d.effectiveAt = start;
          d.offset = offset;
        } else if (raw.action === "revoke") {
          d.paired = false;
          d.code = code();
          d.expiresAt = this.now() + 600000;
          d.hidden = true;
        } else throw inputError("不支持的屏幕操作");
        d.revision++;
      }
      return selected.map((d) => this.displayAdmin(d));
    });
  }
}
export function parseLines(feed) {
  try {
    const data = feed.trim().startsWith("[")
      ? JSON.parse(feed)
      : feed
          .split(/\r?\n/)
          .filter((s) => s.trim())
          .map((s) => JSON.parse(s));
    if (!Array.isArray(data)) throw Error();
    const events = data.filter((e) => e !== null);
    if (events.some((e) => typeof e !== "object" || Array.isArray(e)))
      throw Error();
    return events;
  } catch {
    throw inputError("事件流格式无效");
  }
}
export function validateSource(raw) {
  let u;
  try {
    u = new URL(raw.url);
  } catch {
    throw inputError("来源地址无效");
  }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw inputError("请填写不包含凭据的 HTTP(S) 地址");
  return {
    url: u.href,
    contestId: text(raw.contestId, 100),
    mode: raw.mode === "api" ? "api" : "feed",
    username: text(raw.username),
    password: text(raw.password, 2000),
    bearer: text(raw.bearer, 4000),
    allowPrivate: raw.allowPrivate === true,
  };
}
