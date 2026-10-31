import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { captureOutput } from "./OutputProfile";
import type { StageHandle } from "./Stage";
import type { AnyRecord } from "./types";

const labels: Record<string, string> = {
  healthy: "渲染正常",
  loading: "正在载入",
  stalled: "画面停滞",
  error: "渲染异常",
  offline: "离线",
  background: "后台页面",
  unknown: "指标未提供",
};
export function HealthSummary({ health }: { health?: AnyRecord }) {
  if (!health) return <small className="health-note">指标未提供</small>;
  return (
    <small
      className={
        "health-note " +
        (["stalled", "error"].includes(health.renderer) ? "health-error" : "")
      }
    >
      {labels[health.renderer] || "指标未提供"}
      {health.renderKind === "static" && health.renderer === "healthy" ? " · 静态画面" : ""}
      {health.thumbnail === "stale" ? " · 回传画面陈旧" : ""}
      {health.renderError === "capture-failed" ? " · 画面捕获失败" : ""}
      {health.media?.some((m: any) =>
        ["stalled", "error", "reconnecting"].includes(m.status),
      )
        ? " · 媒体异常"
        : ""}
    </small>
  );
}
export function MediaHealth({ health, state }: { health?: AnyRecord; state: AnyRecord }) {
  return <>{(health?.media || []).map((m: any, index: number) => {
    const job = state.mediaHealth?.jobs?.find((j: any) => j.id === m.id);
    return <div className="health-source" key={m.id + index}>
      <span>{state.media.find((s: any) => s.id === m.id)?.name || "媒体来源"}</span>
      <span>{m.protocol === "webrtc" ? "WebRTC" : m.protocol === "hls" ? "HLS" : "尚未连接"} · {m.width && m.height ? `${m.width}×${m.height}` : "分辨率未知"} · {m.fps === null ? "FPS 未提供" : `${m.fps?.toFixed(1) || "0"} FPS`}</span>
      <span>{({ starting: "连接中", playing: "播放中", stalled: "断帧", reconnecting: "重连中", error: "播放异常", unknown: "状态未知" } as Record<string, string>)[m.status] || "状态未知"}{m.reconnects ? ` · 重连 ${m.reconnects} 次` : ""}{job?.transcoding ? " · 转码中" : job?.status === "running" ? " · 协议转发" : ""}{m.error === "autoplay" ? " · 需本机启用声音" : ""}</span>
    </div>;
  })}</>;
}
export function LiveHealth({ state }: { state: AnyRecord }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const jobs = state.mediaHealth?.jobs || [];
  return (
    <section className="panel health-panel">
      <h2>输出与媒体状态</h2>
      <p className="muted">
        媒体工作服务：
        {{
          connected: "已连接",
          unavailable: "连接异常",
          unconfigured: "未配置",
        }[state.mediaHealth?.status as string] || "未配置"}
      </p>
      {!(state.outputs || []).length ? (
        <p className="muted">尚无正式输出浏览器连接。</p>
      ) : (
        state.outputs.map((o: any) => (
          <div className="health-output" key={o.clientId}>
            <strong>
              {o.kind === "overlay" ? "透明叠加" : "正式输出"} ·{" "}
              {o.clientId.slice(0, 6)}
            </strong>
            <span>{Date.now() - o.seenAt < 15000 ? "在线" : "离线"}</span>
            <HealthSummary
              health={
                Date.now() - o.seenAt < 15000
                  ? o.health
                  : { ...o.health, renderer: "offline" }
              }
            />
            {o.thumbnail ? (
              <img
                className="health-thumbnail"
                src={o.thumbnail}
                alt={
                  o.kind === "overlay" ? "透明叠加实际画面" : "正式输出实际画面"
                }
              />
            ) : null}
            {(o.health?.media || []).map((m: any, i: number) => {
              const job = jobs.find((j: any) => j.id === m.id);
              return (
                <div className="health-source" key={m.id + i}>
                  <span>
                    {state.media.find((s: any) => s.id === m.id)?.name ||
                      "媒体来源"}
                  </span>
                  <span>
                    {m.protocol === "webrtc"
                      ? "WebRTC"
                      : m.protocol === "hls"
                        ? "HLS（延迟较高）"
                        : "尚未连接"}
                  </span>
                  <span>
                    {m.width && m.height
                      ? `${m.width}×${m.height}`
                      : "分辨率未知"}{" "}
                    ·{" "}
                    {m.fps === null
                      ? "FPS 未提供"
                      : `${m.fps?.toFixed(1) || "0"} FPS`}
                  </span>
                  <span>
                    {
                      {
                        starting: "连接中",
                        playing: "播放中",
                        stalled: "断帧",
                        reconnecting: "重连中",
                        error: "播放异常",
                        unknown: "状态未知",
                      }[m.status as string]
                    }
                    {m.reconnects ? ` · 重连 ${m.reconnects} 次` : ""}
                    {job?.transcoding ? " · 转码中" : ""}
                    {job?.videoCodec ? ` · 输入 ${job.videoCodec}` : ""}
                    {m.error === "autoplay" ? " · 需本机启用声音" : ""}
                  </span>
                </div>
              );
            })}
          </div>
        ))
      )}
    </section>
  );
}
export function useOutputHeartbeat(
  token: string,
  kind: string,
  handle: { current: StageHandle | null },
) {
  const clientId = useRef(
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
  );
  useEffect(() => {
    let active = true,
      beating = false,
      capturing = false,
      thumbnail: string | undefined,
      capturedAt = 0;
    const capture = async () => {
      if (capturing) return;
      capturing = true;
      try {
        const frame = await handle.current?.capture();
        if (frame && active) {
          thumbnail = await captureOutput(frame);
          capturedAt = Date.now();
        }
      } catch { /* Frame capture never delays the health sample. */ }
      finally { capturing = false; }
    };
    const beat = async () => {
      if (!active || beating || !token) return;
      beating = true;
      void capture();
      try {
        const health = handle.current?.health();
        await api(
          "/broadcast/heartbeat",
          {
            clientId: clientId.current,
            kind,
            thumbnail,
            health: health
              ? {
                  ...health,
                  thumbnailAgeMs: capturedAt ? Date.now() - capturedAt : null,
                }
              : undefined,
          },
          "POST",
          { "X-Output-Token": token },
        );
      } catch {
        /* A monitor failure must not alter the program. */
      } finally {
        beating = false;
      }
    };
    void beat();
    const timer = setInterval(beat, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [token, kind, handle]);
}
