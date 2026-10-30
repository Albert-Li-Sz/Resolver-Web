import express from "express";
import { PlatformStore } from "./store.js";
import { FeedManager, openFeed, checkedURL } from "./feed.js";
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
export async function createPlatform() {
  const store = new PlatformStore();
  await store.restore();
  const feeds = new FeedManager(store);
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
        templates,
        feed: feeds.status,
        publicState: store.publicState(),
      })),
    ),
  );
  router.get("/time", (_q, r) => r.json({ serverTime: Date.now() }));
  router.get("/workspaces", (_q, r) => r.json(store.admin().workspaces));
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
        await store.change(() => {
          store.workspace(q.params.id);
          store.state.activeWorkspaceId = q.params.id;
          return { ok: true };
        }),
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
      if (!w.source) throw inputError("请先保存来源");
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 10000);
      try {
        const s = await openFeed(w.source, { signal: c.signal });
        s.destroy();
        r.json({ ok: true });
      } finally {
        clearTimeout(t);
      }
    }),
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
  router.post(
    "/broadcast/presets",
    wrap(async (q, r) =>
      r.json(
        await store.change(() => {
          const p = {
            id: id(),
            name: text(q.body.name) || "布局预设",
            scene: scene(q.body.scene),
          };
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
    wrap(async (q, r) =>
      r.json(
        await store.change(() => {
          store.check(q.body.revision, store.state.broadcast.revision);
          store.state.broadcast.program = clone(store.state.broadcast.preview);
          store.state.broadcast.revision++;
          return store.state.broadcast;
        }),
      ),
    ),
  );
  router.post(
    "/broadcast/rotate-token",
    wrap(async (_q, r) =>
      r.json(
        await store.change(() => {
          store.state.broadcast.token = secret();
          return { token: store.state.broadcast.token };
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
            ...program(q.body),
          };
          store.state.plans.push(p);
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
      const source = await mediaSource(raw);
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
      r.json(
        await store.change(() => {
          store.check(q.body.revision);
          const index = store.state.media.findIndex((m) => m.id === old.id);
          store.state.media[index] = next;
          return { ...next, password: undefined, token: undefined };
        }),
      );
    }),
  );
  router.delete(
    "/media/sources/:id",
    wrap(async (q, r) =>
      r.json(
        await store.change(() => {
          store.state.media = store.state.media.filter(
            (x) => x.id !== q.params.id,
          );
          return { ok: true };
        }),
      ),
    ),
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
      const host = process.env.MEDIA_PUBLIC_HOST || q.hostname;
      r.json({
        rtmp: `rtmp://${host}:1935/source-${m.id}?user=publisher&pass=${m.token}`,
        srt: `srt://${host}:8890?streamid=publish:source-${m.id}:publisher:${m.token}`,
        rtsp: `rtsp://publisher:${m.token}@${host}:8554/source-${m.id}`,
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
    const base =
      process.env.MEDIA_BROWSER_BASE || `${q.protocol}://${q.hostname}:8889`;
    r.json({
      whep: `${base}/play-${m.id}/whep`,
      hls: `${process.env.MEDIA_HLS_BASE || `${q.protocol}://${q.hostname}:8888`}/play-${m.id}/index.m3u8`,
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
        if (
          !q.body?.release &&
          (!d.paired || !d.program.items.some((i) => i.type === "live"))
        )
          throw inputError("屏幕未获准播放 Live", 403);
      } else if (q.get("X-Output-Token")) output(q);
      else throw inputError("缺少输出身份", 403);
      if (
        !q.body?.release &&
        !sceneMediaIds(
          store.state.broadcast.program,
          store.state.media,
        ).includes(q.params.id)
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
    const key = `${kind}:${req.socket.remoteAddress}`;
    const now = Date.now();
    const old = rates.get(key);
    const item =
      old && old.until > now ? old : { until: now + 60000, count: 0 };
    if (++item.count > max) throw inputError("操作过于频繁，请稍后重试", 429);
    rates.set(key, item);
    if (rates.size > 1000)
      for (const [k, v] of rates) if (v.until < now) rates.delete(k);
  }
  return { router, store, feeds };
}
async function mediaSource(raw) {
  const kind = raw.kind === "publish" ? "publish" : "pull";
  const source = {
    id: id(),
    name: text(raw.name) || "媒体来源",
    teamId: text(raw.teamId, 100),
    role: ["camera", "desktop", "audio"].includes(raw.role)
      ? raw.role
      : "camera",
    kind,
    url: kind === "pull" ? text(raw.url, 4096) : "",
    username: text(raw.username),
    password: text(raw.password, 2000),
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
