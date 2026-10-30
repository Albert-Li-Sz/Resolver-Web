import { sharedEventSource } from "../../public/js/event-channel.js";
import { useEffect, useRef, useState } from "react";
import { LiveView, type LiveViewHandle } from "./LiveView";
import {
  labels,
  type AnyRecord,
  type Item,
  type Scene,
  type Program,
} from "./types";
export type StageHandle = {
  capture: () => string | Promise<string>;
  audio: () => void;
};
function programTime(
  program: Program,
  startedAt: number,
  paused: boolean,
  offset: number,
  now: number,
) {
  const duration = program.items.reduce((a, b) => a + b.duration * 1000, 0);
  let time = paused ? offset : Math.max(0, now - startedAt);
  return program.loop ? time % duration : Math.min(time, duration - 1);
}
export function currentItem(
  program: Program,
  startedAt: number,
  paused: boolean,
  offset: number,
  now: number,
) {
  let time = programTime(program, startedAt, paused, offset, now);
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
  const liveHandle = useRef<LiveViewHandle | null>(null);
  const [live, setLive] = useState(!item || item.type === "live");
  const liveFlag = useRef(live);
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
    let playingProgram: any = null;
    let preloaded = "";
    let presentations: any = null;
    let PresentationClass: any = null;
    let prepared: any = null;
    const presentationModule = "/js/render/presentation-view.js";
    void import(/* @vite-ignore */ presentationModule).then(
      ({ PresentationView }) => {
        if (!disposed) {
          PresentationClass = PresentationView;
          presentations = new PresentationView();
        }
      },
    );
    let itemStartedAt = Date.now();
    let restorePresentation = false;
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
          source = sharedEventSource(`/api/watch/${resolverId}/events`);
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
        capture: async () => {
          if (liveFlag.current && liveHandle.current && !latest.current.hidden)
            return liveHandle.current.capture();
          const small = document.createElement("canvas");
          small.width = 320;
          small.height = 180;
          small.getContext("2d")!.drawImage(c, 0, 0, 320, 180);
          try {
            return await new Promise<string>((resolve) =>
              small.toBlob(
                (blob) => {
                  if (!blob) return resolve("");
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result || ""));
                  reader.onerror = () => resolve("");
                  reader.readAsDataURL(blob);
                },
                "image/jpeg",
                0.55,
              ),
            );
          } catch {
            return "";
          }
        },
        audio: () => {
          liveHandle.current?.audio();
        },
      };
    function render(now: number) {
      if (disposed) return;
      frame = requestAnimationFrame(render);
      const p = latest.current;
      const serverNow = Date.now() + (p.program?.clockOffset || 0);
      const width = Math.min(8192, Math.round(p.resolution * p.ratio));
      const height = Math.round(width / p.ratio);
      if (
        p.program &&
        (!playingProgram || serverNow >= (p.program.effectiveAt || 0))
      ) {
        if (
          prepared?.revision === p.program.revision &&
          prepared.data === p.state?.data &&
          prepared.width === width &&
          prepared.height === height
        ) {
          presentations?.dispose();
          presentations = prepared.view;
          prepared = null;
        }
        prepared?.view.dispose();
        prepared = null;
        playingProgram = p.program;
      }
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
      if (liveFlag.current !== (type === "live")) {
        liveFlag.current = type === "live";
        setLive(liveFlag.current);
      }
      const itemKey = JSON.stringify(active);
      if (shownType !== itemKey) {
        c.dataset.presentation = type;
        c.setAttribute("aria-label", labels[type] || "实时展示画面");
        if (shownType && p.program?.program?.transition === "fade") {
          previous = document.createElement("canvas");
          previous.width = c.width;
          previous.height = c.height;
          previous.getContext("2d")!.drawImage(c, 0, 0);
          fadeAt = now;
        }
        shownType = itemKey;
        itemStartedAt = serverNow;
      }
      // Render scheduled content before its deadline so font paths, images and
      // the first scoreboard frame do not delay the synchronized screen swap.
      if (
        PresentationClass &&
        p.program &&
        playingProgram?.revision !== p.program.revision &&
        serverNow < p.program.effectiveAt
      ) {
        const next = currentItem(
          p.program.program,
          p.program.startedAt,
          p.program.paused,
          p.program.offset,
          p.program.effectiveAt,
        );
        if (!["live", "resolver"].includes(next.type)) {
          if (
            !prepared ||
            prepared.revision !== p.program.revision ||
            prepared.data !== data ||
            prepared.width !== width ||
            prepared.height !== height
          ) {
            prepared?.view.dispose();
            const bitmap = document.createElement("canvas");
            bitmap.width = width;
            bitmap.height = height;
            prepared = {
              revision: p.program.revision,
              data,
              width,
              height,
              bitmap,
              view: new PresentationClass(),
              ready: false,
            };
          }
          if (!prepared.ready) {
            let phase = programTime(
              p.program.program,
              p.program.startedAt,
              p.program.paused,
              p.program.offset,
              p.program.effectiveAt,
            );
            for (const entry of p.program.program.items) {
              if (phase < entry.duration * 1000) break;
              phase -= entry.duration * 1000;
            }
            prepared.ready = prepared.view.render(
              prepared.bitmap.getContext("2d"),
              data,
              next,
              { width, height, now: p.program.effectiveAt, elapsed: phase },
            );
          }
        }
      }
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
        restorePresentation = true;
        acknowledge();
        return;
      }
      if (type === "resolver") {
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
      if (type === "live") {
        if (liveHandle.current) acknowledge();
        return;
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
      last = now;
      const preloadKey =
        String(p.program?.revision) + ":" + p.state?.workspaceId;
      if (preloaded !== preloadKey) {
        preloaded = preloadKey;
        for (const entry of p.program?.program?.items || [])
          for (const url of entry.images || []) presentations?.image(url);
        for (const t of (data?.contest?.teams || []).slice(0, 24))
          presentations?.image(t.logo);
        presentations?.image(
          data?.contest?.logo || "/assets/img/icpc-logo.png",
        );
      }
      const scene = p.scene || p.state?.broadcast?.program;
      if (type === "resolver") {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, 1920, 1080);
        txt("等待 Resolver 开始滚榜", 150, 560, 64);
      } else if (presentations) {
        let elapsed = serverNow - itemStartedAt;
        if (playingProgram) {
          elapsed = programTime(
            playingProgram.program,
            playingProgram.startedAt,
            playingProgram.paused,
            playingProgram.offset,
            serverNow,
          );
          for (const entry of playingProgram.program.items) {
            if (elapsed < entry.duration * 1000) break;
            elapsed -= entry.duration * 1000;
          }
        }
        if (
          !presentations.render(ctx, data, active, {
            width: c.width,
            height: c.height,
            now: serverNow,
            elapsed,
            restore: restorePresentation || !!previous,
          })
        )
          return;
        restorePresentation = false;
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
      presentations?.dispose();
      prepared?.view.dispose();
      if (handle) handle.current = null;
    };
  }, [handle]);
  return (
    <div
      className="stage-canvas stage-surface"
      style={{ aspectRatio: String(ratio) }}
    >
      <canvas
        ref={canvas}
        className="stage-bitmap"
        aria-label="实时展示画面"
        style={{ visibility: live && !hidden ? "hidden" : undefined }}
      />
      {live && !hidden && (scene || state?.broadcast?.program) && (
        <LiveView
          state={state}
          scene={scene || state?.broadcast?.program}
          headers={headers}
          muted={muted}
          transparent={transparent}
          ratio={ratio}
          handle={liveHandle}
        />
      )}
    </div>
  );
}
