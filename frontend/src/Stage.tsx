import { useEffect, useRef } from "react";
import { MediaReader } from "./media";
import type { AnyRecord, Item, Scene, Program } from "./types";
export type StageHandle = { capture: () => string; audio: () => void };
export function currentItem(
  program: Program,
  startedAt: number,
  paused: boolean,
  offset: number,
  now: number,
) {
  const duration = program.items.reduce((a, b) => a + b.duration * 1000, 0);
  let time = paused ? offset : Math.max(0, now - startedAt);
  time = program.loop ? time % duration : Math.min(time, duration - 1);
  for (const item of program.items) {
    if (time < item.duration * 1000) return item;
    time -= item.duration * 1000;
  }
  return program.items[0];
}
export function Stage({
  state,
  item,
  scene,
  program,
  headers = {},
  muted = true,
  hidden = false,
  transparent = false,
  resolution = 1440,
  ratio = 16 / 9,
  handle,
  onApplied,
}: {
  state: AnyRecord | null;
  item?: Item;
  scene?: Scene;
  program?: AnyRecord;
  headers?: Record<string, string>;
  muted?: boolean;
  hidden?: boolean;
  transparent?: boolean;
  resolution?: number;
  ratio?: number;
  handle?: { current: StageHandle | null };
  onApplied?: (revision: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({
    state,
    item,
    scene,
    program,
    headers,
    muted,
    hidden,
    transparent,
    resolution,
    ratio,
    onApplied,
  });
  latest.current = {
    state,
    item,
    scene,
    program,
    headers,
    muted,
    hidden,
    transparent,
    resolution,
    ratio,
    onApplied,
  };
  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    let frame = 0,
      last = performance.now(),
      disposed = false;
    const images = new Map<string, HTMLImageElement>();
    const readers = new Map<string, MediaReader>();
    let resolver: any = null,
      resolverId = "",
      revision = -1;
    let source: EventSource | null = null;
    let polling = false;
    let resolverWanted = false;
    let nextPoll = 0;
    let shownType = "",
      fadeAt = 0;
    let previous: HTMLCanvasElement | null = null;
    let audioEnabled = false;
    let playingProgram: any = null;
    let preloaded = "";
    const image = (url: string) => {
      if (!url || !/^(https?:|\/|data:image\/)/.test(url)) return null;
      let img = images.get(url);
      if (!img) {
        img = new Image();
        img.crossOrigin = "anonymous";
        img.onerror = () => {
          if (!img!.src.endsWith("/assets/img/icpc-logo.png"))
            img!.src = "/assets/img/icpc-logo.png";
        };
        img.src = url;
        images.set(url, img);
        if (images.size > 256) images.delete(images.keys().next().value!);
      }
      return img.complete && img.naturalWidth ? img : null;
    };
    const drawImage = (
      url: string,
      x: number,
      y: number,
      w: number,
      h: number,
    ) => {
      const img = image(url);
      if (img) {
        const scale = Math.min(w / img.width, h / img.height);
        ctx.drawImage(
          img,
          x + (w - img.width * scale) / 2,
          y + (h - img.height * scale) / 2,
          img.width * scale,
          img.height * scale,
        );
      }
    };
    const txt = (
      text: unknown,
      x: number,
      y: number,
      size = 28,
      color = "#fff",
      max = 1800,
    ) => {
      ctx.fillStyle = color;
      ctx.font = `600 ${size}px system-ui`;
      ctx.fillText(String(text ?? ""), x, y, max);
    };
    const table = (data: any, leaders = false) => {
      const allRows = data?.standings || [];
      const pages = Math.max(1, Math.ceil(allRows.length / 12));
      const page = leaders
        ? 0
        : Math.floor(
            (Date.now() + (latest.current.program?.clockOffset || 0)) / 10000,
          ) % pages;
      const rows = allRows.slice(page * 12, page * 12 + (leaders ? 5 : 12));
      if (!leaders && pages > 1)
        txt(`${page + 1} / ${pages}`, 1780, 45, 24, "#aaa", 120);
      const teams = data?.contest?.teams || [];
      const probs = data?.contest?.problems || [];
      txt("排名", 30, 90);
      txt("队伍", 145, 90);
      txt("解题 / 用时", 1570, 90);
      rows.forEach((r: any, i: number) => {
        const y = 125 + i * 74;
        ctx.fillStyle = i % 2 ? "#222" : "#151515";
        ctx.fillRect(0, y, 1920, 72);
        const t = teams.find((t: any) => t.id === r.teamId);
        txt(r.rank || "—", 28, y + 42, 30);
        drawImage(t?.logo, 85, y + 10, 55, 55);
        txt(
          t?.displayName || t?.name || r.teamId,
          150,
          y + 32,
          27,
          "#fff",
          1200,
        );
        const cells = data.results?.[r.teamId] || [];
        cells.forEach((cell: any, j: number) => {
          const x = 150 + j * Math.min(90, 1150 / Math.max(1, probs.length));
          ctx.fillStyle =
            cell.status === "solved"
              ? "#398b3e"
              : cell.status === "pending"
                ? "#bf8b20"
                : cell.status === "failed"
                  ? "#ab322c"
                  : "#333";
          ctx.fillRect(
            x,
            y + 42,
            Math.min(85, 1100 / Math.max(1, probs.length)),
            24,
          );
          txt(probs[j]?.label || j + 1, x + 6, y + 61, 17);
        });
        txt(`${r.solved} / ${r.time}`, 1580, y + 44, 32);
      });
    };
    const list = (rows: any[], type: string) =>
      rows
        .slice(-12)
        .reverse()
        .forEach((s, i) => {
          const team = latest.current.state?.data?.contest?.teams?.find(
            (t: any) => t.id === s.teamId,
          );
          txt(
            `${type === "first-solves" ? "★ " : ""}${team?.displayName || team?.name || s.teamId}   ${s.problemId}   ${s.status === "pending" ? "待判" : s.status === "solved" ? "通过" : "未通过"}`,
            80,
            170 + i * 65,
            30,
          );
        });
    const pollResolver = async () => {
      if (polling) return;
      polling = true;
      try {
        const current = await fetch("/api/watch/current").then((r) => r.json());
        if (disposed || !resolverWanted) return;
        if (current.id && current.id !== resolverId) {
          source?.close();
          resolver?.dispose();
          resolver = null;
          resolverId = current.id;
          revision = -1;
          const url = "/js/render/resolver-view.js";
          const { ResolverView } = await import(/* @vite-ignore */ url);
          if (disposed || !resolverWanted) return;
          const apply = (v: any) => {
            if (!resolverWanted || disposed) return;
            if (v.playback.revision <= revision) return;
            revision = v.playback.revision;
            if (!resolver) {
              c.dataset.resolution = `${latest.current.resolution}p`;
              c.dataset.logicalWidth = String(
                Math.round(latest.current.ratio * 1080),
              );
              resolver = new ResolverView(c, v.game);
            }
            resolver.seek(v.game.steps, v.game.steps.length - 1);
          };
          const data = await fetch(`/api/watch/${resolverId}`).then((r) =>
            r.json(),
          );
          if (disposed || !resolverWanted) return;
          apply(data);
          source = new EventSource(`/api/watch/${resolverId}/events`);
          source.addEventListener("snapshot", (e) =>
            apply(JSON.parse((e as MessageEvent).data)),
          );
          source.addEventListener("advance", (e) => {
            const v = JSON.parse((e as MessageEvent).data);
            if (v.playback.revision === revision + 1) {
              for (const step of v.steps) resolver.applyStep(step);
              revision = v.playback.revision;
            } else {
              resolverId = "";
            }
          });
        }
      } catch {
        /* Keep last rendered frame during reconnect. */
      } finally {
        polling = false;
      }
    };
    if (handle)
      handle.current = {
        capture: () => {
          const small = document.createElement("canvas");
          small.width = 320;
          small.height = 180;
          small.getContext("2d")!.drawImage(c, 0, 0, 320, 180);
          try {
            return small.toDataURL("image/jpeg", 0.55);
          } catch {
            return "";
          }
        },
        audio: () => {
          audioEnabled = true;
          for (const r of readers.values())
            r.audio(
              latest.current.scene?.volume ??
                latest.current.state?.broadcast?.program?.volume ??
                0,
              false,
            );
        },
      };
    function render(now: number) {
      if (disposed) return;
      frame = requestAnimationFrame(render);
      const p = latest.current;
      const serverNow = Date.now() + (p.program?.clockOffset || 0);
      if (
        p.program &&
        (!playingProgram || serverNow >= (p.program.effectiveAt || 0))
      )
        playingProgram = p.program;
      const active = playingProgram
        ? currentItem(
            playingProgram.program,
            playingProgram.startedAt,
            playingProgram.paused,
            playingProgram.offset,
            serverNow,
          )
        : p.item || { type: "live", duration: 15 };
      const data = p.state?.data;
      const type = active?.type || "logo";
      resolverWanted = type === "resolver";
      const itemKey = JSON.stringify(active);
      if (shownType !== itemKey) {
        if (shownType && p.program?.program?.transition === "fade") {
          previous = document.createElement("canvas");
          previous.width = c.width;
          previous.height = c.height;
          previous.getContext("2d")!.drawImage(c, 0, 0);
          fadeAt = now;
        }
        shownType = itemKey;
      }
      const width = Math.min(8192, Math.round(p.resolution * p.ratio));
      const height = Math.round(width / p.ratio);
      if (type !== "resolver" && (c.width !== width || c.height !== height)) {
        c.width = width;
        c.height = height;
      }
      const acknowledge = () =>
        p.onApplied?.(playingProgram?.revision ?? p.state?.revision ?? 0);
      if (p.hidden) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, c.width, c.height);
        for (const r of readers.values()) r.close();
        readers.clear();
        acknowledge();
        return;
      }
      if (type === "resolver") {
        for (const r of readers.values()) r.close();
        readers.clear();
        if (now > nextPoll) {
          nextPoll = now + 3000;
          void pollResolver();
        }
        if (resolver) {
          const pref = `${p.resolution}p`;
          const logical = String(Math.round(p.ratio * 1080));
          if (
            c.dataset.resolution !== pref ||
            c.dataset.logicalWidth !== logical
          ) {
            c.dataset.resolution = pref;
            c.dataset.logicalWidth = logical;
            resolver.resize();
          }
          resolver.update(now - last);
          resolver.render(now);
          last = now;
          acknowledge();
          return;
        }
      } else if (resolver || resolverId) {
        source?.close();
        source = null;
        resolver?.dispose();
        resolver = null;
        resolverId = "";
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      if (!p.transparent) {
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, c.width, c.height);
      }
      const fit = Math.min(c.width / 1920, c.height / 1080);
      ctx.setTransform(
        fit,
        0,
        0,
        fit,
        (c.width - 1920 * fit) / 2,
        (c.height - 1080 * fit) / 2,
      );
      if (!p.transparent) {
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, 1920, 1080);
      }
      last = now;
      const preloadKey =
        String(p.program?.revision) + ":" + p.state?.workspaceId;
      if (preloaded !== preloadKey) {
        preloaded = preloadKey;
        for (const entry of p.program?.program?.items || [])
          for (const url of entry.images || []) image(url);
        for (const t of (data?.contest?.teams || []).slice(0, 24))
          image(t.logo);
        image(data?.contest?.logo || "/assets/img/icpc-logo.png");
      }
      const scene = p.scene || p.state?.broadcast?.program;
      const ids =
        type === "live"
          ? Array.from(
              {
                length:
                  scene?.layout === "quad"
                    ? 4
                    : scene?.layout === "dual"
                      ? 2
                      : 1,
              },
              (_, i) =>
                scene?.mediaIds?.[i] ||
                p.state?.media?.find(
                  (m: any) =>
                    m.teamId === scene?.teamIds?.[i] && m.role === "camera",
                )?.id,
            )
          : [];
      const activeIds = new Set<string>(
        (p.transparent ? [] : ids)
          .slice(
            0,
            scene?.layout === "quad" ? 4 : scene?.layout === "dual" ? 2 : 1,
          )
          .filter((v): v is string => !!v),
      );
      if (type === "live" && !p.transparent && scene?.audioMediaId)
        activeIds.add(scene.audioMediaId);
      for (const [key, r] of readers)
        if (!activeIds.has(key)) {
          r.close();
          readers.delete(key);
        }
      for (const key of activeIds)
        if (!readers.has(key))
          readers.set(
            key,
            new MediaReader(key, p.headers, () => {
              const fallback = p.state?.media?.find(
                (m: any) => m.id === key,
              )?.fallbackId;
              if (fallback && !readers.has(fallback)) {
                /* Failure is visible; director selects fallback explicitly. */
              }
            }),
          );
      if (type === "live" && scene) {
        const count =
          scene.layout === "quad" ? 4 : scene.layout === "dual" ? 2 : 1;
        const columns = count === 1 ? 1 : 2;
        Array.from({ length: p.transparent ? 0 : count }, (_, i) => {
          const w = 1920 / columns,
            h = count === 4 ? 540 : 1080,
            x = (i % columns) * w,
            y = Math.floor(i / columns) * h;
          const reader = readers.get(ids[i]);
          if (reader?.ready) {
            const scale = Math.min(
              w / reader.video.videoWidth,
              h / reader.video.videoHeight,
            );
            const vw = reader.video.videoWidth * scale,
              vh = reader.video.videoHeight * scale;
            ctx.drawImage(
              reader.video,
              x + (w - vw) / 2,
              y + (h - vh) / 2,
              vw,
              vh,
            );
          } else if (!p.transparent) {
            ctx.fillStyle = "#1e1e1d";
            ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
            txt(
              ids[i] ? "视频暂不可用" : "等待媒体来源",
              x + 40,
              y + h / 2,
              32,
              "#a7a39e",
              w - 80,
            );
          }
        });
        for (const [key, reader] of readers)
          reader.audio(
            scene.volume,
            (p.muted && !audioEnabled) ||
              (!!scene.audioMediaId && key !== scene.audioMediaId),
          );
        const anchors: Record<string, [number, number]> = {
          clock: [40, 20],
          title: [40, 850],
          ticker: [0, 1015],
          image: [1440, 30],
          scoreboard: [0, 0],
          queue: [1440, 400],
          firstSolves: [80, 170],
          team: [45, 950],
        };
        const widget = (key: string, fn: (x: number, y: number) => void) => {
          if (scene.widgets?.[key]) {
            const pos = scene.positions?.[key];
            const origin = anchors[key];
            fn(pos ? pos.x * 19.2 : origin[0], pos ? pos.y * 10.8 : origin[1]);
          }
        };
        widget("clock", (x, y) => txt(clock(data, serverNow), x, y + 40, 36));
        widget("title", (x, y) => {
          ctx.fillStyle = "#111d";
          ctx.fillRect(x, y, Math.min(1750, 1920 - x), 110);
          txt(scene.title, x + 25, y + 70, 42, "#fff", 1920 - x - 50);
        });
        widget("ticker", (x, y) => {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, 1920 - x, 65);
          ctx.clip();
          ctx.fillStyle = "#111e";
          ctx.fillRect(x, y, 1920 - x, 65);
          txt(
            scene.ticker,
            x + 1920 - ((now / 12) % (1920 + scene.ticker.length * 30)),
            y + 45,
            30,
          );
          ctx.restore();
        });
        widget("image", (x, y) => drawImage(scene.image, x, y, 400, 250));
        widget("scoreboard", (x, y) => {
          ctx.save();
          ctx.translate(x, y);
          table(data, true);
          ctx.restore();
        });
        widget("queue", (x, y) => {
          for (const [submission, index] of (data?.contest?.submissions || [])
            .slice(-5)
            .reverse()
            .map((v: any, i: number) => [v, i]))
            txt(
              `${submission.teamId} · ${submission.problemId} · ${submission.status === "pending" ? "待判" : submission.status === "solved" ? "通过" : "未通过"}`,
              x,
              y + index * 55,
              24,
              "#fff",
              450,
            );
        });
        widget("firstSolves", (x, y) => {
          ctx.save();
          ctx.translate(x - 80, y - 170);
          list(firstSolves(data), "first-solves");
          ctx.restore();
        });
        widget("team", (x, y) => {
          const team = data?.contest?.teams?.find(
            (t: any) => t.id === scene.teamIds[0],
          );
          if (team) txt(team.displayName || team.name, x, y + 40, 35);
        });
      } else if (["scoreboard", "leaders"].includes(type)) {
        txt(data?.contest?.name || "等待赛事数据", 30, 45, 32);
        table(data, type === "leaders");
      } else if (type === "resolver") {
        txt("等待 Resolver 开始滚榜", 150, 560, 64);
      } else if (type === "clock" || type === "countdown") {
        txt(type === "clock" ? "比赛剩余时间" : "倒计时", 100, 270, 52);
        txt(
          type === "clock"
            ? clock(data, serverNow)
            : formatTime((active.targetTime || serverNow) - serverNow),
          100,
          600,
          190,
        );
      } else if (type === "queue") {
        txt("判题队列", 80, 75, 46);
        list(data?.contest?.submissions || [], "queue");
      } else if (type === "first-solves") {
        txt("首解列表", 80, 75, 46);
        list(firstSolves(data), "first-solves");
      } else if (type === "team") {
        const team =
          data?.contest?.teams?.find((t: any) => t.id === active.teamId) ||
          data?.contest?.teams?.[0];
        if (team) {
          drawImage(team.photo || team.logo, 80, 100, 800, 800);
          txt(team.displayName || team.name, 950, 480, 65, "#fff", 850);
          txt(team.organizationName || "", 950, 580, 38, "#bbb", 850);
        }
      } else if (type === "message") {
        const lines = String(active.text || "欢迎参加比赛").split("\n");
        lines
          .slice(0, 8)
          .forEach((line, i) => txt(line, 110, 330 + i * 85, 60));
      } else if (type === "photos") {
        const photos = active.images || [];
        drawImage(
          photos[Math.floor(serverNow / 5000) % Math.max(1, photos.length)] ||
            "",
          0,
          0,
          1920,
          1080,
        );
      } else if (type === "calibration") {
        ctx.strokeStyle = "#777";
        ctx.lineWidth = 2;
        for (let x = 0; x <= 1920; x += 120) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, 1080);
          ctx.stroke();
        }
        for (let y = 0; y <= 1080; y += 120) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(1920, y);
          ctx.stroke();
        }
        txt(`${c.width} × ${c.height}`, 650, 540, 70);
      } else {
        drawImage(
          data?.contest?.logo || "/assets/img/icpc-logo.png",
          600,
          130,
          720,
          650,
        );
        txt(data?.contest?.name || "ICPC", 100, 920, 70, "#fff", 1700);
      }
      if (previous) {
        const alpha = Math.max(0, 1 - (now - fadeAt) / 450);
        if (alpha) {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = alpha;
          ctx.drawImage(previous, 0, 0, c.width, c.height);
          ctx.restore();
        } else previous = null;
      }
      acknowledge();
    }
    frame = requestAnimationFrame(render);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      source?.close();
      resolver?.dispose();
      for (const r of readers.values()) r.close();
      if (handle) handle.current = null;
    };
  }, [handle]);
  return (
    <canvas ref={canvas} className="stage-canvas" aria-label="实时展示画面" />
  );
}
function formatTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function clock(data: any, now: number) {
  const c = data?.contest;
  if (!c) return "00:00:00";
  const meta = data.clock;
  const startValue = meta?.startTime || c.startTime;
  const start =
    typeof startValue === "number" ? startValue : Date.parse(startValue);
  const ended = Date.parse(meta?.ended);
  const elapsed = Number.isFinite(start)
    ? Math.max(
        0,
        (Math.min(now, Number.isFinite(ended) ? ended : now) - start) *
          (meta?.multiplier || 1),
      )
    : 0;
  return formatTime(c.durationMs - elapsed);
}

function firstSolves(data: any) {
  if (data?.firstSolves) return data.firstSolves;
  const seen = new Set();
  return (data?.contest?.submissions || [])
    .filter((s: any) => s.status === "solved")
    .sort((a: any, b: any) => a.contestTime - b.contestTime)
    .filter((s: any) => {
      if (seen.has(s.problemId)) return false;
      seen.add(s.problemId);
      return true;
    });
}
