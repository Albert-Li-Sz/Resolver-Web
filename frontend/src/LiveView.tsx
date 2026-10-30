import React, { useEffect, useMemo, useRef, useState } from "react";
import { Provider } from "react-redux";
import { createOverlayStore } from "../vendor/icpc-live/redux/store";
import {
  setMessages,
  startScrolling,
  stopScrolling,
} from "../vendor/icpc-live/redux/ticker";
import { MediaContext } from "../vendor/icpc-live/components/organisms/holder/TeamMediaHolder";
import Scoreboard from "../vendor/icpc-live/components/organisms/widgets/scoreboard/ScoreboardContainer";
import Queue from "../vendor/icpc-live/components/organisms/widgets/queue/QueueContainer";
import { TeamView } from "../vendor/icpc-live/components/organisms/widgets/TeamView";
import { SingleTicker } from "../vendor/icpc-live/components/organisms/widgets/Ticker";
import { ContestantViewCorner } from "../vendor/icpc-live/components/molecules/info/ContestantViewCorner";
import Pictures from "../vendor/icpc-live/components/organisms/widgets/Pictures";
import Ticker from "../vendor/icpc-live/components/organisms/widgets/Ticker";
import Advertisement from "../vendor/icpc-live/components/organisms/widgets/Advertisement";
import { liveSnapshot } from "./live-model";
import { MediaReader } from "./media";
import type { AnyRecord, Scene } from "./types";
import c from "../vendor/icpc-live/config";
import { TickerMessageSettings, TickerPart } from "../vendor/icpc-live/api";
import "./live-output.css";
import { sceneMediaSlots } from "../../public/js/broadcast-media.js";
export type LiveViewHandle = {
  capture: () => Promise<string>;
  audio: () => void;
};
export function LiveView({
  state,
  scene,
  headers,
  muted,
  transparent,
  ratio,
  handle,
}: {
  state: AnyRecord | null;
  scene: Scene;
  headers: Record<string, string>;
  muted: boolean;
  transparent: boolean;
  ratio: number;
  handle: { current: LiveViewHandle | null };
}) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [audio, setAudio] = useState(false);
  const store = useMemo(() => createOverlayStore(), []);
  const clockStore = useMemo(() => createOverlayStore(), []);
  const firstSolveStore = useMemo(() => createOverlayStore(), []);
  const snapshot = useMemo(() => liveSnapshot(state), [state?.data]);
  useEffect(() => {
    const rows = scene.widgets.queue
      ? snapshot.queue.queue
      : snapshot.firstSolves;
    const queue = rows.map((r: any) => ({
      ...r,
      result: {
        ...r.result,
        isFirstToSolveRun:
          !!scene.widgets.firstSolves && r.result.isFirstToSolveRun,
      },
    }));
    store.dispatch({
      type: "PLATFORM_SNAPSHOT",
      payload: { ...snapshot, queue: { queue, totalQueueItems: queue.length } },
    });
    clockStore.dispatch({ type: "PLATFORM_SNAPSHOT", payload: snapshot });
    firstSolveStore.dispatch({
      type: "PLATFORM_SNAPSHOT",
      payload: {
        ...snapshot,
        queue: {
          queue: snapshot.firstSolves,
          totalQueueItems: snapshot.firstSolves.length,
        },
      },
    });
  }, [
    snapshot,
    scene.widgets.queue,
    scene.widgets.firstSolves,
    store,
    clockStore,
    firstSolveStore,
  ]);
  useEffect(() => {
    store.dispatch(
      setMessages([
        {
          message: {
            id: `clock:${scene.widgets.clock}:${!!scene.positions?.clock}`,
            settings: {
              type:
                scene.widgets.clock && !scene.positions?.clock
                  ? TickerMessageSettings.Type.clock
                  : TickerMessageSettings.Type.empty,
              part: TickerPart.short,
              periodMs: 86400000,
              showSeconds: true,
            },
          },
          showOrder: 0,
        },
        {
          message: {
            id: `ticker:${scene.widgets.ticker}:${scene.ticker}`,
            settings: {
              type: TickerMessageSettings.Type.text,
              part: TickerPart.long,
              periodMs: 86400000,
              text: scene.widgets.ticker ? scene.ticker : "",
            },
          },
          showOrder: 0,
        },
      ]) as any,
    );
  }, [
    scene.ticker,
    scene.widgets.ticker,
    scene.widgets.clock,
    scene.positions?.clock,
    store,
  ]);
  useEffect(() => {
    if (!scene.positions?.clock) return;
    clockStore.dispatch(
      setMessages([
        {
          message: {
            id: "standalone-clock",
            settings: {
              type: TickerMessageSettings.Type.clock,
              part: TickerPart.short,
              periodMs: 86400000,
              showSeconds: true,
            },
          },
          showOrder: 0,
        },
      ]) as any,
    );
    clockStore.dispatch(startScrolling() as any);
    return () => {
      clockStore.dispatch(stopScrolling() as any);
    };
  }, [clockStore, !!scene.positions?.clock]);
  useEffect(() => {
    const el = root.current!;
    const obs = new ResizeObserver(([v]) =>
      setSize({ width: v.contentRect.width, height: v.contentRect.height }),
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    handle.current = {
      audio: () => setAudio(true),
      capture: async () => {
        try {
          const html2canvas = (await import("html2canvas")).default;
          return (
            await html2canvas(root.current!, {
              scale: 320 / root.current!.clientWidth,
              useCORS: true,
              logging: false,
              backgroundColor: transparent ? null : "#000",
            })
          ).toDataURL("image/jpeg", 0.6);
        } catch {
          return "";
        }
      },
    };
    return () => {
      handle.current = null;
    };
  }, [handle, transparent]);
  useEffect(() => {
    if (
      !scene.audioMediaId ||
      transparent ||
      sceneMediaSlots(scene, state?.media || [], state?.workspaceId).some(
        (s) =>
          s.primary === scene.audioMediaId ||
          s.secondary === scene.audioMediaId,
      )
    )
      return;
    const r = new MediaReader(scene.audioMediaId, headers);
    const t = setInterval(() => r.audio(scene.volume, muted && !audio), 250);
    return () => {
      clearInterval(t);
      r.close();
    };
  }, [
    scene.audioMediaId,
    scene.volume,
    muted,
    audio,
    transparent,
    JSON.stringify(headers),
    JSON.stringify(scene.mediaIds),
    JSON.stringify(scene.teamIds),
    state?.workspaceId,
    state?.media,
  ]);
  const slots = sceneMediaSlots(scene, state?.media || [], state?.workspaceId);
  const scale = Math.min(size.width / 1920, size.height / 1080);
  const context = useMemo(
    () => ({
      headers,
      muted: muted && !audio,
      volume: scene.volume,
      audioMediaId: scene.audioMediaId,
    }),
    [JSON.stringify(headers), muted, audio, scene.volume, scene.audioMediaId],
  );
  const count = scene.layout === "quad" ? 4 : scene.layout === "dual" ? 2 : 1;
  const positions =
    scene.layout === "quad"
      ? [
          "teamViewTopLeft",
          "teamViewTopRight",
          "teamViewBottomLeft",
          "teamViewBottomRight",
        ]
      : scene.layout === "dual"
        ? ["teamViewPvpTop", "teamViewPvpBottom"]
        : ["teamViewSingle"];
  const variants =
    scene.layout === "quad"
      ? ["TOP_LEFT", "TOP_RIGHT", "BOTTOM_LEFT", "BOTTOM_RIGHT"]
      : scene.layout === "dual"
        ? ["PVP_TOP", "PVP_BOTTOM"]
        : ["SINGLE"];
  const widget = (name: string, location: string, child: React.ReactNode) => {
    const box = (c.WIDGET_POSITIONS as AnyRecord)[location];
    const custom = scene.positions?.[name];
    return (
      <div
        key={name}
        data-live-widget={name}
        className="live-widget"
        style={{
          left: custom ? custom.x * 19.2 : box.positionX,
          top: custom ? custom.y * 10.8 : box.positionY,
          width: box.sizeX,
          height: box.sizeY,
        }}
      >
        {child}
      </div>
    );
  };
  return (
    <div
      ref={root}
      className="live-output"
      role="img"
      aria-label="Live 原版节目画面"
      style={{
        aspectRatio: String(ratio),
        background: transparent ? "transparent" : "#000",
      }}
    >
      <div
        className="live-logical"
        style={{
          transform: `translate(${(size.width - 1920 * scale) / 2}px,${(size.height - 1080 * scale) / 2}px) scale(${scale})`,
        }}
      >
        {scale > 0 && (
          <Provider store={store}>
            <MediaContext.Provider value={context}>
              {Array.from({ length: count }, (_, i) => {
                const source = slots[i].primary,
                  secondary = slots[i].secondary;
                return widget(
                  "team-" + i,
                  positions[i],
                  <TeamView
                    widgetData={
                      {
                        widgetLocationId: positions[i],
                        settings: {
                          teamId: scene.teamIds[i],
                          primary: transparent ? [] : [{ sourceId: source }],
                          secondary:
                            !transparent && secondary
                              ? [{ sourceId: secondary }]
                              : [],
                          achievement: [],
                          showTaskStatus:
                            !!scene.widgets.team && !scene.positions?.team,
                          showTimeLine: false,
                          position: variants[i],
                        },
                      } as any
                    }
                    transitionState="entered"
                  />,
                );
              })}
              {scene.widgets.scoreboard &&
                widget(
                  "scoreboard",
                  "scoreboard",
                  <Scoreboard
                    widgetData={
                      {
                        settings: {
                          optimismLevel: "normal",
                          group: "all",
                          scrollDirection: "Forward",
                        },
                      } as any
                    }
                    transitionState="entered"
                  />,
                )}
              {(scene.widgets.queue || scene.widgets.firstSolves) &&
                widget(
                  scene.widgets.queue ? "queue" : "firstSolves",
                  "queue",
                  <Queue
                    widgetData={
                      {
                        widgetLocationId: "queue",
                        settings: { horizontal: false },
                      } as any
                    }
                  />,
                )}
              {scene.widgets.queue &&
                scene.widgets.firstSolves &&
                scene.positions?.firstSolves &&
                widget(
                  "firstSolves",
                  "queue",
                  <Provider store={firstSolveStore}>
                    <Queue
                      widgetData={
                        {
                          widgetLocationId: "queue",
                          settings: { horizontal: false },
                        } as any
                      }
                    />
                  </Provider>,
                )}
              {(scene.widgets.ticker || scene.widgets.clock) &&
                widget("ticker", "ticker", <Ticker />)}
              {scene.widgets.title &&
                widget(
                  "title",
                  "advertisement",
                  <Advertisement
                    widgetData={{ advertisement: { text: scene.title } }}
                  />,
                )}
              {scene.widgets.image &&
                widget(
                  "image",
                  "picture",
                  <Pictures
                    widgetData={{ picture: { url: scene.image, name: "" } }}
                    transitionState="entered"
                  />,
                )}
              {scene.widgets.clock && scene.positions?.clock && (
                <div
                  className="live-widget"
                  data-live-widget="clock"
                  style={{
                    left: scene.positions.clock.x * 19.2,
                    top: scene.positions.clock.y * 10.8,
                    width: 226.56,
                    height: 48,
                  }}
                >
                  <Provider store={clockStore}>
                    <SingleTicker part="short" color="#CB2E28" />
                  </Provider>
                </div>
              )}
              {scene.widgets.team && scene.positions?.team && (
                <div
                  className="live-widget"
                  data-live-widget="team"
                  style={{
                    left: scene.positions.team.x * 19.2,
                    top: scene.positions.team.y * 10.8,
                    width: 600,
                    height: 450,
                  }}
                >
                  <ContestantViewCorner
                    teamId={scene.teamIds[0]}
                    isSmall={false}
                  />
                </div>
              )}
            </MediaContext.Provider>
          </Provider>
        )}
      </div>
    </div>
  );
}
