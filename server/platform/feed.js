import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicAddress } from "../lib/remote-feed.js";
import { inputError } from "../lib/limits.js";
export async function checkedURL(
  input,
  allowPrivate = false,
  protocols = ["http:", "https:"],
) {
  let u;
  try {
    u = new URL(input);
  } catch {
    throw inputError("链接格式无效");
  }
  if (!protocols.includes(u.protocol) || u.username || u.password)
    throw inputError("链接协议或凭据位置无效");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true });
  if (
    !addresses.length ||
    addresses.some(
      (a) =>
        !isPublicAddress(a.address) && (!allowPrivate || !isPrivate(a.address)),
    )
  )
    throw inputError("来源地址不允许访问；场馆内网来源需明确启用内网访问");
  return { url: u, address: addresses[0] };
}
function isPrivate(ip) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|f[cd][0-9a-f]{2}:)/i.test(
    ip,
  );
}
export async function openFeed(source, { signal, cursor } = {}) {
  let target = source.url;
  if (source.mode === "api")
    target = new URL(
      `contests/${encodeURIComponent(source.contestId)}/event-feed`,
      target.replace(/\/?$/, "/"),
    ).href;
  const { url, address } = await checkedURL(target, source.allowPrivate);
  if (cursor) url.searchParams.set("since_token", cursor);
  const authorization = source.bearer
    ? `Bearer ${source.bearer}`
    : source.username || source.password
      ? `Basic ${Buffer.from(`${source.username}:${source.password}`).toString("base64")}`
      : undefined;
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).get(
      url,
      {
        signal,
        agent: false,
        autoSelectFamily: false,
        lookup: (_h, _o, cb) => cb(null, address.address, address.family),
        headers: {
          Accept: "application/x-ndjson",
          "Accept-Encoding": "identity",
          ...(authorization ? { Authorization: authorization } : {}),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(inputError(`来源返回 HTTP ${res.statusCode}`, 502));
          return;
        }
        if (
          res.headers["content-encoding"] &&
          res.headers["content-encoding"] !== "identity"
        ) {
          res.resume();
          reject(inputError("持续事件流需要未压缩响应", 502));
          return;
        }
        res.setEncoding("utf8");
        resolve(res);
      },
    );
    req.setTimeout(60000, () => req.destroy(Error("事件流心跳超时")));
    req.on("error", reject);
  });
}
export class FeedManager {
  constructor(store, { open = openFeed } = {}) {
    this.open = open;
    this.store = store;
    this.current = null;
    this.status = { state: "stopped" };
    this.unsubscribe = store.subscribe(() => this.reconcile());
  }
  reconcile() {
    const key = this.store.state.activeWorkspaceId;
    const w = key ? this.store.workspace() : null;
    const signature = JSON.stringify([key, w?.source]);
    if (this.current?.signature === signature) return;
    this.current?.controller.abort();
    this.current = null;
    if (!w?.source) {
      this.status = { state: "stopped" };
      return;
    }
    const controller = new AbortController();
    this.current = { signature, controller };
    this.run(key, controller.signal).catch(() => {});
  }
  async run(key, signal) {
    let failures = 0;
    while (!signal.aborted) {
      let batch = [];
      let pending = "";
      let timer;
      const sourceFingerprint = JSON.stringify(
        this.store.workspace(key).source,
      );
      const flush = async () => {
        if (batch.length) {
          const b = batch;
          batch = [];
          await this.store.ingest(key, b, { sourceFingerprint });
        }
      };
      try {
        this.status = { state: "connecting" };
        const w = this.store.workspace(key);
        const stream = await this.open(w.source, { signal, cursor: w.cursor });
        this.status = { state: "connected", updatedAt: Date.now() };
        this.store.emit();
        for await (const chunk of stream) {
          pending += chunk;
          if (pending.length > 2 * 1024 * 1024)
            throw inputError("单条事件超过容量限制");
          let index;
          while ((index = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, index).trim();
            pending = pending.slice(index + 1);
            if (line) {
              const event = JSON.parse(line);
              if (event !== null) batch.push(event);
              if (batch.length >= 100) await flush();
            }
          }
          if (batch.length) {
            clearTimeout(timer);
            await flush();
          }
          this.status.updatedAt = Date.now();
        }
        if (pending.trim()) {
          const event = JSON.parse(pending);
          if (event !== null) batch.push(event);
          await flush();
        }
        failures = 0;
        this.status = { state: "reconnecting", updatedAt: Date.now() };
        this.store.emit();
      } catch (e) {
        if (signal.aborted) return;
        this.status = {
          state: "error",
          message: e.expose ? e.message : "事件流连接中断，正在重连",
          updatedAt: Date.now(),
        };
        this.store.emit();
        failures++;
      } finally {
        clearTimeout(timer);
      }
      await new Promise((resolve) => {
        if (signal.aborted) return resolve();
        const t = setTimeout(
          done,
          Math.min(30000, 1000 * 2 ** Math.min(failures, 5)),
        );
        t.unref();
        function done() {
          signal.removeEventListener("abort", cancel);
          resolve();
        }
        function cancel() {
          clearTimeout(t);
          done();
        }
        signal.addEventListener("abort", cancel, { once: true });
      });
    }
  }
  close() {
    this.current?.controller.abort();
    this.unsubscribe();
  }
}
