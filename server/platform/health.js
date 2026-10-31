import { inputError } from "../lib/limits.js";

const number = (v, max) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
const status = (v, allowed, fallback = "unknown") =>
  allowed.includes(v) ? v : fallback;
export function readHealth(raw) {
  if (raw === undefined) return null;
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    !Array.isArray(raw.media) ||
    raw.media.length > 12
  )
    throw inputError("画面健康数据无效");
  return {
    visible: raw.visible !== false,
    uptimeMs: number(raw.uptimeMs, 365 * 86400000) || 0,
    renderAgeMs: number(raw.renderAgeMs, 365 * 86400000),
    renderError: status(
      raw.renderError,
      ["render-failed", "capture-failed"],
      "",
    ),
    thumbnailAgeMs: number(raw.thumbnailAgeMs, 365 * 86400000),
    audioEnabled: raw.audioEnabled === true,
    renderKind: status(raw.renderKind, ["static", "animated", "live"]),
    media: raw.media.map((m) => ({
      id: /^[a-f0-9]{32}$/.test(m?.id) ? m.id : "",
      protocol: status(m?.protocol, ["webrtc", "hls", "none"], "none"),
      status: status(m?.status, [
        "starting",
        "playing",
        "reconnecting",
        "error",
      ]),
      width: number(m?.width, 8192),
      height: number(m?.height, 8192),
      fps: number(m?.fps, 240),
      frameAgeMs: number(m?.frameAgeMs, 365 * 86400000),
      reconnects: number(m?.reconnects, 1000000) || 0,
      error: status(
        m?.error,
        ["authorization", "connection", "stalled", "playback", "autoplay"],
        "",
      ),
    })),
  };
}
export function healthState(runtime = {}, now = Date.now()) {
  const age = Math.max(0, now - (runtime.seenAt || 0));
  const online = !!runtime.seenAt && age < 15000;
  const h = runtime.health;
  const renderAge =
    h?.renderAgeMs === null || h?.renderAgeMs === undefined
      ? null
      : h.renderAgeMs + age;
  const thumbnailAge =
    h?.thumbnailAgeMs === null || h?.thumbnailAgeMs === undefined
      ? null
      : h.thumbnailAgeMs + age;
  const renderer = !online
    ? "offline"
    : !h || age > 10000
      ? "unknown"
      : !h.visible
        ? "background"
        : h.renderError === "render-failed"
          ? "error"
          : h.uptimeMs + age < 15000 && renderAge === null
            ? "loading"
            : h.renderAgeMs === null || h.renderAgeMs > 5000
              ? "stalled"
              : "healthy";
  return {
    renderer,
    thumbnail: !h
      ? "unknown"
      : thumbnailAge === null
        ? h.uptimeMs + age < 15000
          ? "loading"
          : "stale"
        : thumbnailAge > 20000
          ? "stale"
          : "fresh",
    ...h,
    renderAgeMs: renderAge,
    thumbnailAgeMs: thumbnailAge,
    media: (h?.media || []).map((m) => ({
      ...m,
      status:
        m.status === "playing" && m.frameAgeMs !== null && m.frameAgeMs > 6000
          ? "stalled"
          : m.status,
    })),
  };
}

export class MediaMonitor {
  constructor(store) {
    this.store = store;
    if (!process.env.MEDIA_WORKER_URL || !process.env.MEDIA_INTERNAL_KEY)
      return;
    this.timer = setInterval(() => void this.sample(), 5000);
    this.timer.unref();
    void this.sample();
  }
  async sample() {
    if (this.controller) return;
    const c = (this.controller = new AbortController());
    const t = setTimeout(() => c.abort(), 2000);
    try {
      const r = await fetch(`${process.env.MEDIA_WORKER_URL}/health`, {
        headers: { "X-Media-Key": process.env.MEDIA_INTERNAL_KEY },
        signal: c.signal,
      });
      if (!r.ok) throw Error();
      const value = await r.json();
      this.store.mediaHealth = {
        status: "connected",
        sampledAt: Date.now(),
        jobs: (value.jobs || []).slice(0, 12).map((j) => ({
          id: /^[a-f0-9]{32}$/.test(j.id) ? j.id : "",
          status: status(j.status, ["starting", "running", "reconnecting", "error"]),
          transcoding: j.transcoding === true,
          videoCodec: /^[a-z0-9_]{1,30}$/.test(j.videoCodec)
            ? j.videoCodec
            : null,
        })),
      };
    } catch {
      this.store.mediaHealth = {
        status: "unavailable",
        sampledAt: Date.now(),
        jobs: [],
      };
    } finally {
      clearTimeout(t);
      this.controller = null;
      this.store.emit();
    }
  }
  close() {
    clearInterval(this.timer);
    this.controller?.abort();
  }
}
