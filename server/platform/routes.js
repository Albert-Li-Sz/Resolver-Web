import express from "express";
import { PlatformStore, validateSource } from "./store.js";
import { ResolverExports } from "./resolver-export.js";
import { FeedManager, openFeed, checkedURL, probeFeed } from "./feed.js";
import {
  clone,
  id,
  secret,
  hash,
  text,
  scene,
  program,
  templates,
  code,
  sceneMediaIds,
} from "./model.js";
import { inputError } from "../lib/limits.js";
import { equalSecret } from "../lib/access.js";
import { outputProfile } from "../../public/js/output-profile.js";
import { readHealth, MediaMonitor } from "./health.js";
import { currentContent } from "./emergency.js";
import { networkPolicy, restrictedNetwork } from "../lib/network-policy.js";
import { mediaAddresses, mediaPort } from "./media-address.js";
export async function createPlatform() {
  const store = new PlatformStore();
  await store.restore();
  const feeds = new FeedManager(store);
  const exports = new ResolverExports(store);
  const mediaMonitor = new MediaMonitor(store);
  feeds.reconcile();
  const router = express.Router();
  const rates = new Map();
  let streamCount = 0;
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (e) {
      next(e);
    }
  };
  const device = (req) =>
    store.device(req.params.id, req.get("X-Display-Token") || "");
  const output = (req) => {
    if (!equalSecret(req.get("X-Output-Token"), store.state.broadcast.token))
      throw inputError("输出链接无效", 403);
  };
  const stream = (req, res, snapshot) => {
    if (streamCount >= 128) throw inputError("实时连接数量已达上限", 503);
    streamCount++;
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    let dirty = false,
      lastKey = "";
    const send = () => {
      const key =
        String(store.state.revision) +
        (req.path.startsWith("/platform") ? ":" + Date.now() : "");
      if (key === lastKey) return;
      lastKey = key;
      if (res.writableLength > 2 * 1024 * 1024) {
        res.end();
        return;
      }
      res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
    };
    send();
    const stop = store.subscribe(() => {
      dirty = true;
    });
    const t = setInterval(() => {
      try {
        if (dirty) {
          dirty = false;
          send();
        } else res.write(": heartbeat\n\n");
      } catch {
        res.end();
      }
    }, 250);
    t.unref();
    res.on("close", () => {
      streamCount--;
      clearInterval(t);
      stop();
    });
  };
  router.get("/platform", (_q, r) =>
    r.json({
      ...store.admin(),
      networkPolicy: networkPolicy(),
      templates,
      feed: feeds.status,
      publicState: store.publicState(),
    }),
  );
  router.get(
    "/platform/events",
    wrap((q, r) =>
      stream(q, r, () => ({
        ...store.admin(),
        networkPolicy: networkPolicy(),
        templates,
        feed: feeds.status,
        publicState: store.publicState(),
      })),
    ),
  );
  router.get("/time", (_q, r) => r.json({ serverTime: Date.now() }));
  router.get("/workspaces", (_q, r) => r.json(store.admin().workspaces));
  router.get(
    "/workspaces/:id",
    wrap((q, r) => r.json(store.workspaceAdmin(store.workspace(q.params.id)))),
  );
  router.post(
    "/workspaces",
    wrap(async (q, r) =>
      r
        .status(201)
        .json(
          await store.createWorkspace(
            typeof q.body === "string"
              ? { feed: q.body, name: text(q.query.name) || undefined }
              : q.body,
          ),
        ),
    ),
  );
  router.put(
    "/workspaces/:id",
    wrap(async (q, r) =>
      r.json(await store.updateWorkspace(q.params.id, q.body)),
    ),
  );
  router.post(
    "/workspaces/:id/activate",
    wrap(async (q, r) =>
      r.json(
        await store.activate(
          q.params.id,
          q.body.revision,
          q.body.currentWorkspaceId,
          q.body.expectedContextRevision,
        ),
      ),
    ),
  );
  router.get(
    "/workspaces/:id/snapshot",
    wrap((q, r) =>
      r.json({ contest: store.workspaceContest(store.workspace(q.params.id)) }),
    ),
  );
  router.post(
    "/workspaces/:id/events",
    wrap(async (q, r) =>
      r.json(await store.ingest(q.params.id, q.body.events || [])),
    ),
  );
  router.post(
    "/workspaces/:id/test",
    wrap(async (q, r) => {
      const w = store.workspace(q.params.id);
      if (!q.body.source && !w.source) throw inputError("请先填写来源");
      const source = q.body.source
        ? validateSource({
            ...q.body.source,
            password: q.body.source.password ?? w.source?.password,
            bearer: q.body.source.bearer ?? w.source?.bearer,
          })
        : w.source;
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 10000);
      try {
        r.json(await probeFeed(source, { signal: c.signal }));
      } finally {
        clearTimeout(t);
      }
    }),
  );
  router.post(
    "/workspaces/:id/resolver-exports",
    wrap((q, r) => {
      limit(q, "resolver-export", 12);
      r.status(202).json(exports.start(q.params.id));
    }),
  );
  router.get(
    "/workspaces/:id/resolver-exports/:job",
    wrap((q, r) => r.json(exports.status(q.params.job, q.params.id))),
  );
  router.delete(
    "/workspaces/:id/resolver-exports/:job",
    wrap((q, r) => r.json(exports.cancel(q.params.job, q.params.id))),
  );
  router.get(
    "/workspaces/:id/resolver-exports/:job/feed",
    wrap(async (q, r) => {
      const { file } = await exports.archive(q.params.id, q.params.job);
      r.set("Cache-Control", "no-store");
      r.download(file, "event-feed.ndjson");
    }),
  );
  router.put(
    "/broadcast/presets/:id",
    wrap(async (q, r) =>
      r.json(
        await store.change(() => {
          const p = store.state.broadcast.presets?.find(
            (p) => p.id === q.params.id,
          );
          if (!p) throw inputError("预设不存在", 404);
          guardWorkspace(q);
          store.check(q.body.revision, p.revision || 0);
          Object.assign(p, {
            name: text(q.body.name) || p.name,
            scene: scene(q.body.scene),
            workspaceId: sceneScope(q.body.scene),
            revision: (p.revision || 0) + 1,
          });
          return p;
        }),
      ),
    ),
  );
  router.put(
    "/broadcast/preview",
    wrap(async (q, r) =>
      r.json(
        await store.change(() => {
          store.check(q.body.revision, store.state.broadcast.revision);
          store.state.broadcast.preview = scene(q.body.scene);
          store.state.broadcast.revision++;
          return store.state.broadcast;
        }),
      ),
    ),
  );
  router.put(
    "/broadcast/output-settings",
    wrap(async (q, r) =>
      r.json(
        await store.change(() => {
          const b = store.state.broadcast;
          store.check(q.body.revision, b.outputRevision || 0);
          if (!["program", "overlay"].includes(q.body.type))
            throw inputError("输出类型无效");
          b.outputProfiles ||= {};
          b.outputProfiles[q.body.type] = outputProfile(q.body.outputProfile);
          b.outputRevision = (b.outputRevision || 0) + 1;
          return { revision: b.outputRevision };
        }),
      ),
    ),
  );
  router.post(
    "/broadcast/presets",
    wrap(async (q, r) =>
      r.json(
        await store.change(() => {
          const p = {
            id: id(),
            name: text(q.body.name) || "布局预设",
            revision: 0,
            scene: scene(q.body.scene),
            workspaceId: sceneScope(q.body.scene),
          };
          guardWorkspace(q);
          store.state.broadcast.presets ??= [];
          if (store.state.broadcast.presets.length >= 50)
            throw inputError("布局预设最多 50 个");
          store.state.broadcast.presets.push(p);
          return p;
        }),
      ),
    ),
  );
  router.post(
    "/broadcast/take",
    wrap(async (q, r) => r.json(await store.takeBroadcast(q.body))),
  );
  router.post(
    "/broadcast/standby",
    wrap(async (q, r) => r.json(await store.standbyBroadcast(q.body))),
  );
  router.post(
    "/broadcast/rollback",
    wrap(async (q, r) => r.json(await store.rollbackBroadcast(q.body))),
  );
  router.post(
    "/broadcast/heartbeat",
    wrap((q, r) => {
      output(q);
      const clientId = q.body.clientId;
      if (
        !/^[a-f0-9]{32}$/.test(clientId) ||
        !["program", "overlay"].includes(q.body.kind)
      )
        throw inputError("输出身份无效");
      for (const [key, value] of store.outputs)
        if (Date.now() - value.seenAt > 300000) store.outputs.delete(key);
      if (!store.outputs.has(clientId) && store.outputs.size >= 100)
        throw inputError("输出连接数量已达上限", 429);
      const thumbnail = q.body.thumbnail;
      if (
        thumbnail &&
        (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(thumbnail) ||
          thumbnail.length > 180000)
      )
        throw inputError("缩略图无效");
      store.outputs.set(clientId, {
        clientId,
        kind: q.body.kind,
        seenAt: Date.now(),
        health: readHealth(q.body.health),
        thumbnail: thumbnail || null,
      });
      store.emit();
      r.json({ serverTime: Date.now() });
    }),
  );
  router.post(
    "/broadcast/rotate-token",
    wrap(async (q, r) =>
      r.json(
        await store.change(() => {
          if (q.body.tokenRevision !== undefined)
            store.check(
              q.body.tokenRevision,
              store.state.broadcast.tokenRevision || 0,
            );
          store.state.broadcast.token = secret();
          store.state.broadcast.tokenRevision =
            (store.state.broadcast.tokenRevision || 0) + 1;
          store.outputs.clear();
          return {
            token: store.state.broadcast.token,
            tokenRevision: store.state.broadcast.tokenRevision,
          };
        }),
      ),
    ),
  );
  router.get(
    "/broadcast/output",
    wrap((q, r) => {
      output(q);
      r.json(store.publicState());
    }),
  );
  router.get(
    "/broadcast/events",
    wrap((q, r) => {
      output(q);
      stream(q, r, () => {
        output(q);
        return store.publicState();
      });
    }),
  );
  router.post(
    "/displays/events",
    wrap((q, r) => {
      const identities = q.body.identities;
      if (
        !Array.isArray(identities) ||
        !identities.length ||
        identities.length > 32
      )
        throw inputError("展示连接数量无效");
      const snapshot = () => {
        let paired = false;
        const devices = identities.map((entry) => {
          try {
            const value = store.deviceState(
              store.device(entry.id, entry.token),
            );
            paired ||= value.paired;
            delete value.state;
            return value;
          } catch {
            return {
              id: String(entry?.id || ""),
              error: "展示屏身份已失效，请新建屏幕",
            };
          }
        });
        return {
          serverTime: Date.now(),
          data: paired ? store.publicState() : null,
          devices,
        };
      };
      stream(q, r, snapshot);
    }),
  );
  router.post(
    "/displays/register",
    wrap(async (q, r) => {
      limit(q, "register", 20);
      r.status(201).json(await store.register());
    }),
  );
  router.get(
    "/displays/:id/state",
    wrap((q, r) => r.json(store.deviceState(device(q)))),
  );
  router.get(
    "/displays/:id/events",
    wrap((q, r) => {
      device(q);
      stream(q, r, () => store.deviceState(device(q)));
    }),
  );
  router.post(
    "/displays/:id/heartbeat",
    wrap((q, r) => {
      const d = device(q);
      const thumbnail = q.body.thumbnail;
      if (
        thumbnail &&
        (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(thumbnail) ||
          thumbnail.length > 180000)
      )
        throw inputError("缩略图无效");
      const before = store.runtime.get(d.id) || {};
      const health = readHealth(q.body.health);
      const ack = Number(q.body.revision);
      if (!Number.isInteger(ack) || ack < -1 || ack > d.revision)
        throw inputError("屏幕回执版本无效");
      if (ack < (before.appliedRevision ?? -1)) {
        r.json({ serverTime: Date.now() });
        return;
      }
      store.runtime.set(d.id, {
        seenAt: Date.now(),
        thumbnail: thumbnail || store.runtime.get(d.id)?.thumbnail,
        appliedRevision: Number(q.body.revision),
        appliedAt:
          Number(q.body.appliedAt) ||
          (ack === before.appliedRevision ? before.appliedAt : Date.now()),
        clockOffset: Number(q.body.clockOffset) || 0,
        health: q.body.health === undefined ? before.health || null : health,
      });
      store.emit();
      r.json({ serverTime: Date.now() });
    }),
  );
  router.post(
    "/displays/:id/renew-code",
    wrap(async (q, r) => {
      const d = device(q);
      if (d.paired) throw inputError("屏幕已配对");
      r.json(
        await store.change(() => {
          d.code = code();
          d.expiresAt = Date.now() + 600000;
          return store.deviceState(d);
        }),
      );
    }),
  );
  router.post(
    "/displays/pair",
    wrap(async (q, r) => {
      limit(q, "pair", 10);
      r.json(await store.pair(q.body));
    }),
  );
  router.put(
    "/displays/:id/settings",
    wrap(async (q, r) =>
      r.json(
        await store.change(() => {
          const d = device(q);
          if (!d.paired) throw inputError("展示端尚未配对", 403);
          store.check(q.body.revision, d.revision);
          d.outputProfile = outputProfile(q.body.outputProfile);
          d.revision++;
          return store.deviceState(d);
        }),
      ),
    ),
  );
  router.post(
    "/displays/command",
    wrap(async (q, r) => r.json(await store.command(q.body))),
  );
  router.post(
    "/presentations/plans",
    wrap(async (q, r) =>
      r.json(
        await store.change(() => {
          const p = {
            id: id(),
            name: text(q.body.name) || "节目单",
            revision: 0,
            ...program(q.body),
            workspaceId: q.body.items?.some((item) => item.teamId)
              ? store.state.activeWorkspaceId || ""
              : "",
          };
          guardWorkspace(q);
          store.state.plans.push(p);
          return p;
        }),
      ),
    ),
  );
  router.put(
    "/presentations/plans/:id",
    wrap(async (q, r) =>
      r.json(
        await store.change(() => {
          const p = store.state.plans.find((p) => p.id === q.params.id);
          if (!p) throw inputError("节目单不存在", 404);
          guardWorkspace(q);
          store.check(q.body.revision, p.revision || 0);
          Object.assign(p, {
            name: text(q.body.name) || p.name,
            ...program(q.body),
            workspaceId: q.body.items?.some((item) => item.teamId)
              ? store.state.activeWorkspaceId || ""
              : "",
            revision: (p.revision || 0) + 1,
          });
          return p;
        }),
      ),
    ),
  );
  router.delete(
    "/presentations/plans/:id",
    wrap(async (q, r) =>
      r.json(
        await store.change(() => {
          store.state.plans = store.state.plans.filter(
            (x) => x.id !== q.params.id,
          );
          return { ok: true };
        }),
      ),
    ),
  );
  router.post(
    "/media/sources",
    wrap(async (q, r) => {
      const raw = q.body;
      const source = await mediaSource({
        ...raw,
        workspaceId: raw.teamId
          ? raw.workspaceId || store.state.activeWorkspaceId
          : "",
      });
      r.status(201).json(
        await store.change(() => {
          if (store.state.media.length >= 1000)
            throw inputError("媒体来源已达上限");
          store.state.media.push(source);
          return { ...source, password: undefined, token: undefined };
        }),
      );
    }),
  );
  router.put(
    "/media/sources/:id",
    wrap(async (q, r) => {
      const old = store.state.media.find((m) => m.id === q.params.id);
      if (!old) throw inputError("来源不存在", 404);
      const next = await mediaSource({
        ...old,
        ...q.body,
        password: q.body.password ?? old.password,
      });
      next.id = old.id;
      next.token = old.token;
      next.revision = (old.revision || 0) + 1;
      r.json(
        await store.change(() => {
          const index = store.state.media.findIndex((m) => m.id === old.id);
          if (index < 0) throw inputError("来源已被移除", 404);
          if (q.body.expectedBroadcastRevision !== undefined)
            store.check(q.body.expectedBroadcastRevision, store.state.broadcast.revision);
          if (q.body.sourceRevision !== undefined)
            store.check(
              q.body.sourceRevision,
              store.state.media[index].revision || 0,
            );
          else store.check(q.body.revision);
          const current = store.state.media[index];
          const changed = ["kind", "url", "username", "password", "allowPrivate", "transcode"].some(key => next[key] !== current[key]);
          next.streamRevision = (current.streamRevision || 0) + (changed ? 1 : 0);
          next.revision = (store.state.media[index].revision || 0) + 1;
          store.state.media[index] = next;
          return { ...next, password: undefined, token: undefined };
        }),
      );
    }),
  );
  router.delete(
    "/media/sources/:id",
    wrap(async (q, r) => {
      const removed = await store.change(() => {
          const old = store.state.media.find((x) => x.id === q.params.id);
          if (q.body?.expectedBroadcastRevision !== undefined)
            store.check(q.body.expectedBroadcastRevision, store.state.broadcast.revision);
          if (q.body?.sourceRevision !== undefined && old)
            store.check(q.body.sourceRevision, old.revision || 0);
          store.state.media = store.state.media.filter(
            (x) => x.id !== q.params.id,
          );
          return old || null;
        });
      if (removed) await worker("drop", { source: { id: removed.id } }).catch(() => {});
      r.json({ ok: true });
    }),
  );
  router.post(
    "/media/sources/:id/test",
    wrap(async (q, r) => {
      const m = store.state.media.find((x) => x.id === q.params.id);
      if (!m) throw inputError("来源不存在", 404);
      r.json(await worker("probe", { source: m }));
    }),
  );
  router.get(
    "/media/sources/:id/publish",
    wrap((q, r) => {
      const m = store.state.media.find((x) => x.id === q.params.id);
      if (!m || m.kind !== "publish") throw inputError("不是发布来源");
      const host = mediaAddresses(q).publishHost;
      r.json({
        rtmp: `rtmp://${host}:${mediaPort('MEDIA_RTMP_PORT', 20002)}/source-${m.id}?user=publisher&pass=${m.token}`,
        srt: `srt://${host}:${mediaPort('MEDIA_SRT_PORT', 20003)}?streamid=publish:source-${m.id}:publisher:${m.token}`,
        rtsp: `rtsp://publisher:${m.token}@${host}:${mediaPort('MEDIA_RTSP_PORT', 20001)}/source-${m.id}`,
      });
    }),
  );
  // Output/device capability is checked before issuing short-lived, source-scoped media read credentials.
  const grantMedia = async (q, r) => {
    const m = store.state.media.find((x) => x.id === q.params.id);
    if (!m) throw inputError("媒体来源不存在", 404);
    const readerId = text(q.body?.readerId, 80);
    const consumer = hash(
      `${q.get("X-Display-Token") || q.get("X-Output-Token") || "admin"}:${readerId}`,
    );
    if (q.body?.release) {
      await worker("release", { source: { id: m.id }, consumer });
      return r.json({ ok: true });
    }
    await worker("ensure", { source: m, consumer });
    const expiry = Date.now() + 60000;
    const key = process.env.MEDIA_INTERNAL_KEY;
    if (!key) throw inputError("媒体网关尚未配置", 503);
    const payload = `play-${m.id}:${expiry}`;
    const token = hash(`${key}:${payload}`);
    const addresses = mediaAddresses(q);
    r.json({
      whep: `${addresses.whepBase}/play-${m.id}/whep`,
      hls: `${addresses.hlsBase}/play-${m.id}/index.m3u8`,
      user: String(expiry),
      password: token,
      expiresAt: expiry,
    });
  };
  router.post("/media/preview-read/:id", wrap(grantMedia));
  router.post(
    "/media/read/:id",
    wrap(async (q, r) => {
      if (q.get("X-Display-Id")) {
        const d = store.device(q.get("X-Display-Id"), q.get("X-Display-Token"));
        const current = currentContent(d, store.now());
        if (
          !q.body?.release &&
          (!d.paired ||
            current.mode === "standby" ||
            !current.program.items.some((i) => i.type === "live"))
        )
          throw inputError("屏幕未获准播放 Live", 403);
      } else if (q.get("X-Output-Token")) output(q);
      else throw inputError("缺少输出身份", 403);
      if (
        !q.body?.release &&
        (store.state.broadcast.mode === "standby" ||
          !sceneMediaIds(
            store.state.broadcast.program,
            store.state.media,
            store.state.activeWorkspaceId,
          ).includes(q.params.id))
      )
        throw inputError("来源尚未上屏", 403);
      await grantMedia(q, r);
    }),
  );
  router.post(
    "/media/admin-read/:id",
    wrap(async (q, r) => {
      const m = store.state.media.find((x) => x.id === q.params.id);
      if (!m) throw inputError("来源不存在");
      await worker("ensure", { source: m });
      r.json({ ok: true });
    }),
  );
  function limit(req, kind, max) {
    if (!restrictedNetwork()) return;
    const key = `${kind}:${req.ip}`;
    const now = Date.now();
    const old = rates.get(key);
    const item =
      old && old.until > now ? old : { until: now + 60000, count: 0 };
    if (++item.count > max) throw inputError("操作过于频繁，请稍后重试", 429);
    rates.set(key, item);
    if (rates.size > 1000)
      for (const [k, v] of rates) if (v.until < now) rates.delete(k);
  }
  function guardWorkspace(q) {
    if (
      q.body.workspaceId !== undefined &&
      q.body.workspaceId !== store.state.activeWorkspaceId
    )
      throw inputError("当前赛事已切换，请重新选择队伍后保存", 409);
  }
  function sceneScope(raw) {
    const value = scene(raw);
    return value.teamIds.some(Boolean) ||
      value.mediaIds.some(Boolean) ||
      value.audioMediaId
      ? store.state.activeWorkspaceId || ""
      : "";
  }
  return { router, store, feeds, exports, mediaMonitor };
}
async function mediaSource(raw) {
  const kind = raw.kind === "publish" ? "publish" : "pull";
  const source = {
    id: id(),
    name: text(raw.name) || "媒体来源",
    teamId: text(raw.teamId, 100),
    workspaceId: text(raw.workspaceId, 100),
    role: ["camera", "desktop", "audio"].includes(raw.role)
      ? raw.role
      : "camera",
    kind,
    revision: 0,
    streamRevision: 0,
    url: kind === "pull" ? text(raw.url, 4096) : "",
    username: text(raw.username),
    password: String(raw.password ?? "").slice(0, 2000),
    allowPrivate: raw.allowPrivate === true,
    transcode: raw.transcode === true,
    fallbackId: text(raw.fallbackId, 100),
    token: secret(),
  };
  if (kind === "pull")
    await checkedURL(source.url, source.allowPrivate, [
      "rtsp:",
      "rtmp:",
      "srt:",
      "http:",
      "https:",
    ]);
  return source;
}
export async function worker(action, body) {
  const base = process.env.MEDIA_WORKER_URL,
    key = process.env.MEDIA_INTERNAL_KEY;
  if (!base || !key)
    throw inputError("媒体网关尚未配置，请使用完整 Compose 部署", 503);
  try {
    const r = await fetch(`${base}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Media-Key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(action === "probe" ? 15000 : 5000),
    });
    if (!r.ok) throw Error();
    return r.json();
  } catch {
    throw inputError("媒体来源不可用或网关连接失败", 502);
  }
}
