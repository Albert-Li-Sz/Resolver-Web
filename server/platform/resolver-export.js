import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { atomicWrite } from "../lib/files.js";
import { engineJob } from "../lib/engine-job.js";
import { inputError, LIMITS } from "../lib/limits.js";
import { id, clone, normalizeEvent } from "./model.js";
import { openFeed } from "./feed.js";
import { ccsSnapshot } from "./ccs-snapshot.js";

// Export jobs deliberately never ingest into the live workspace or unlock it.
export class ResolverExports {
  constructor(store, { open = openFeed } = {}) {
    this.store = store;
    this.open = open;
    this.jobs = new Map();
    this.directory = path.join(store.directory, "resolver-exports");
  }
  start(workspaceId) {
    const w = clone(this.store.workspace(workspaceId));
    if (!w.source) throw inputError("请先在赛事中心配置 CCS 连接");
    if (
      [...this.jobs.values()].filter((j) => j.state === "running").length >= 4
    )
      throw inputError("获取任务正在进行，请稍后重试", 429);
    for (const [key, j] of this.jobs)
      if (j.updatedAt < Date.now() - 3600000) this.jobs.delete(key);
    const job = {
      id: id(),
      workspaceId,
      state: "running",
      bytes: 0,
      events: 0,
      updatedAt: Date.now(),
      controller: new AbortController(),
    };
    this.jobs.set(job.id, job);
    void this.run(job, w);
    return this.status(job.id, workspaceId);
  }
  get(key, workspaceId) {
    const j = this.jobs.get(key);
    if (!j || j.workspaceId !== workspaceId)
      throw inputError("获取任务不存在，请重新获取", 404);
    return j;
  }
  status(key, workspaceId) {
    const { controller, ...value } = this.get(key, workspaceId);
    return value;
  }
  cancel(key, workspaceId) {
    const j = this.get(key, workspaceId);
    if (j.state === "running") {
      j.state = "cancelled";
      j.controller.abort();
    }
    return this.status(key, workspaceId);
  }
  async run(j, w) {
    const timer = setTimeout(
      () =>
        j.controller.abort(Error("获取超时，请确认 CCS 已提供完整赛后数据")),
      120000,
    );
    let stream;
    try {
      let pending = "",
        chunks = [],
        finalState = {},
        complete = false;
      if (w.source.mode === "api") {
        const events = await ccsSnapshot(w.source, {
          signal: j.controller.signal,
          progress: (bytes) => {
            j.bytes += bytes;
            j.updatedAt = Date.now();
          },
        });
        chunks = events.map((event) => JSON.stringify(event));
        j.events = events.length;
        finalState = events.find((e) => e.type === "state")?.data || {};
      } else {
        stream = await this.open(w.source, { signal: j.controller.signal });
        for await (const chunk of stream) {
          j.controller.signal.throwIfAborted();
          j.bytes += Buffer.byteLength(chunk);
          if (j.bytes > LIMITS.feedBytes)
            throw inputError("赛后事件流超过容量限制", 413);
          pending += chunk;
          let n;
          while ((n = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, n).trim();
            pending = pending.slice(n + 1);
            if (!line) continue;
            const raw = JSON.parse(line);
            if (!raw) continue;
            if (typeof raw !== "object" || Array.isArray(raw))
              throw Error("事件格式无效");
            const event = normalizeEvent(raw);
            chunks.push(JSON.stringify(event));
            j.events++;
            if (["state", "states"].includes(event.type)) {
              finalState =
                event.op === "delete" ? {} : { ...finalState, ...event.data };
              complete = !!finalState.end_of_updates;
            }
          }
          j.updatedAt = Date.now();
          if (complete) break;
        }
        if (pending.trim()) {
          const event = normalizeEvent(JSON.parse(pending));
          if (event) {
            chunks.push(JSON.stringify(event));
            j.events++;
            if (["state", "states"].includes(event.type))
              finalState =
                event.op === "delete" ? {} : { ...finalState, ...event.data };
          }
        }
      }
      j.controller.signal.throwIfAborted();
      if (
        !j.events ||
        !(finalState.ended || finalState.finalized || finalState.end_of_updates)
      )
        throw Error(
          "CCS 尚未提供比赛结束状态，无法确认赛后数据完整；可稍后重试或手动上传 NDJSON",
        );
      const feed = chunks.join("\n") + "\n";
      if (Buffer.byteLength(feed) > LIMITS.feedBytes)
        throw inputError("赛后事件流超过容量限制", 413);
      const contest = await engineJob("parse", feed);
      if (!contest.freezeDurationMs && w.contest.freezeDurationMs) {
        contest.freezeDurationMs = w.contest.freezeDurationMs;
        contest.freezeSource = "history";
        const event = chunks.findIndex((line) =>
          ["contest", "contests"].includes(JSON.parse(line).type),
        );
        if (event >= 0) {
          const raw = JSON.parse(chunks[event]);
          raw.data.scoreboard_freeze_duration = `${Math.floor(contest.freezeDurationMs / 3600000)}:${String(Math.floor(contest.freezeDurationMs / 60000) % 60).padStart(2, "0")}:${String(Math.floor(contest.freezeDurationMs / 1000) % 60).padStart(2, "0")}`;
          chunks[event] = JSON.stringify(raw);
        }
      }
      if (!contest.teams.length || !contest.problems.length)
        throw Error("赛后事件流缺少队伍或题目");
      if (contest.submissions.some((s) => s.status === "pending"))
        throw Error(
          "CCS 仍有未判题或隐藏判题，请使用具有完整判题权限的账号，或上传完整 NDJSON",
        );
      // Apply shared assets to a copy; later edits cannot alter this archive.
      const snapshot = this.store.workspaceContest({ ...w, contest });
      j.controller.signal.throwIfAborted();
      await mkdir(this.directory, { recursive: true });
      const archive = {
        id: j.id,
        workspaceId: w.id,
        createdAt: Date.now(),
        contest: snapshot,
        events: j.events,
        bytes: Buffer.byteLength(feed),
      };
      await atomicWrite(
        path.join(this.directory, `${j.id}.ndjson`),
        chunks.join("\n") + "\n",
      );
      await atomicWrite(
        path.join(this.directory, `${j.id}.json`),
        JSON.stringify(archive),
      );
      j.controller.signal.throwIfAborted();
      Object.assign(j, {
        state: "complete",
        archiveId: j.id,
        contest: snapshot,
        updatedAt: Date.now(),
      });
    } catch (error) {
      if (j.state !== "cancelled")
        Object.assign(j, {
          state: "error",
          error: j.controller.signal.aborted
            ? j.controller.signal.reason?.message || "获取已中止"
            : error.message,
        });
    } finally {
      clearTimeout(timer);
      stream?.destroy();
      j.updatedAt = Date.now();
    }
  }
  async archive(workspaceId, key) {
    if (!/^[a-f0-9]{32}$/.test(key)) throw inputError("归档不存在", 404);
    let meta;
    try {
      meta = JSON.parse(
        await readFile(path.join(this.directory, `${key}.json`), "utf8"),
      );
    } catch {
      throw inputError("归档不存在", 404);
    }
    if (meta.workspaceId !== workspaceId) throw inputError("归档不存在", 404);
    return { file: path.join(this.directory, `${key}.ndjson`), meta };
  }
  close() {
    for (const j of this.jobs.values())
      if (j.state === "running") j.controller.abort();
  }
}
