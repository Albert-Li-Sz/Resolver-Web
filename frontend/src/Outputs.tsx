import React, { useState, useEffect, useRef } from "react";
import { api, subscribe, safeRead, safeWrite } from "./api";
import { Stage, type StageHandle } from "./Stage";
import {
  labels,
  widgetLabels,
  type AnyRecord,
  type Scene,
  type Item,
  type Program,
} from "./types";
import { Field, Button, type Run } from "./ui";
import { subscribeDisplay } from "./display-channel";
export function Display() {
  const [identity, setIdentity] = useState<AnyRecord | null>(() => {
    const screen = new URLSearchParams(location.search).get("screen");
    return screen
      ? safeRead(`icpc.display.identity.${screen}`)
      : safeRead("icpc.display.active.v1");
  });
  const [device, setDevice] = useState<AnyRecord | null>(null);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<AnyRecord>(
    () =>
      safeRead("icpc.screen.settings.v1") || {
        resolution: 1440,
        ratio: 16 / 9,
      },
  );
  const [controls, setControls] = useState(true);
  const handle = useRef<StageHandle | null>(null);
  const applied = useRef(-1);
  const latest = useRef(device);
  latest.current = device;
  const [clockOffset, setClockOffset] = useState(
    () => Number(safeRead(`icpc.display.clock.${identity?.id}`)) || 0,
  );
  async function register() {
    try {
      const v = await api("/displays/register", {});
      safeWrite("icpc.display.active.v1", v);
      safeWrite(`icpc.display.identity.${v.id}`, v);
      history.replaceState(null, "", `/presentations/?screen=${v.id}`);
      applied.current = -1;
      setDevice(null);
      setIdentity(v);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (!identity) {
      void register();
      return;
    }
    applied.current = -1;
    setClockOffset(Number(safeRead(`icpc.display.clock.${identity.id}`)) || 0);
    history.replaceState(null, "", `/presentations/?screen=${identity.id}`);
    setSettings(
      safeRead(`icpc.screen.settings.${identity.id}`) ||
        safeRead("icpc.screen.settings.v1") || {
          resolution: 1440,
          ratio: 16 / 9,
        },
    );
    const headers = { "X-Display-Token": identity.token };
    let cached = safeRead(`icpc.display.cache.${identity.id}`);
    if (cached) setDevice(cached);
    let active = true;
    const stop = subscribeDisplay(
      { id: identity.id, token: identity.token },
      (v) => {
        if (!active) return;
        setDevice(v);
        safeWrite(`icpc.display.cache.${identity.id}`, v);
        setError("");
      },
      setOnline,
      setError,
    );
    const beat = async () => {
      const started = Date.now();
      try {
        const v = await api(
          `/displays/${identity.id}/heartbeat`,
          {
            revision: applied.current,
            thumbnail: handle.current?.capture() || undefined,
            clockOffset,
          },
          "POST",
          headers,
        );
        const offset = v.serverTime - (started + Date.now()) / 2;
        setClockOffset(offset);
        safeWrite(`icpc.display.clock.${identity.id}`, offset);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    void beat();
    const timer = setInterval(beat, 5000);
    return () => {
      active = false;
      stop();
      clearInterval(timer);
    };
  }, [identity?.id]);
  const update = (patch: AnyRecord) =>
    setSettings((old: AnyRecord) => {
      const next = { ...old, ...patch };
      safeWrite(`icpc.screen.settings.${identity?.id || "default"}`, next);
      return next;
    });
  if (!device?.paired)
    return (
      <main className="pair-screen">
        <a href="/">← 平台首页</a>
        <h1>连接展示屏</h1>
        {device || identity ? (
          <>
            <p>在 PresentationAdmin 输入链接码</p>
            <strong className="pair-code">
              {device?.code || identity?.code}
            </strong>
            <p>
              有效期至{" "}
              {new Date(
                device?.expiresAt || identity?.expiresAt,
              ).toLocaleTimeString()}
            </p>
            <Button
              className="secondary"
              onClick={() =>
                void api(`/displays/${identity!.id}/renew-code`, {}, "POST", {
                  "X-Display-Token": identity!.token,
                }).catch((e) => setError(e.message))
              }
            >
              刷新链接码
            </Button>
          </>
        ) : (
          <p>正在生成链接码…</p>
        )}
        {error ? <p role="alert">{error}</p> : null}
        <Button className="secondary" onClick={() => void register()}>
          新建独立展示屏
        </Button>
      </main>
    );
  return (
    <div className="output-shell" onPointerMove={() => setControls(true)}>
      <Stage
        state={device.state}
        program={{ ...device, clockOffset }}
        headers={{
          "X-Display-Id": identity!.id,
          "X-Display-Token": identity!.token,
        }}
        hidden={device.hidden}
        resolution={settings.resolution}
        ratio={settings.ratio}
        handle={handle}
        onApplied={(rev) => {
          if (applied.current !== rev) {
            applied.current = rev;
            void api(
              `/displays/${identity!.id}/heartbeat`,
              { revision: rev, appliedAt: Date.now() + clockOffset },
              "POST",
              { "X-Display-Token": identity!.token },
            ).catch(() => {});
          }
        }}
      />
      {controls ? (
        <div className="output-controls">
          <strong>{device.name}</strong>
          <span>{online ? "已同步" : "连接中断 · 保留画面"}</span>
          <OutputSettings settings={settings} update={update} />
          <Button
            onClick={() => {
              handle.current?.audio();
              void document.documentElement
                .requestFullscreen()
                .catch(() => setError("请使用浏览器全屏功能"));
              setControls(false);
            }}
          >
            启用全屏与声音
          </Button>
          <Button className="secondary" onClick={() => void register()}>
            新建屏幕
          </Button>
          <Button className="secondary" onClick={() => setControls(false)}>
            隐藏控制栏
          </Button>
        </div>
      ) : null}
    </div>
  );
}
function OutputSettings({
  settings,
  update,
}: {
  settings: AnyRecord;
  update: (p: AnyRecord) => void;
}) {
  return (
    <>
      <select
        aria-label="渲染分辨率"
        value={settings.resolution}
        onChange={(e) => update({ resolution: Number(e.target.value) })}
      >
        <option value="1080">1080p</option>
        <option value="1440">2K</option>
        <option value="2160">4K</option>
      </select>
      <select
        aria-label="LED 屏幕比例"
        value={settings.ratio}
        onChange={(e) => update({ ratio: Number(e.target.value) })}
      >
        <option value={16 / 9}>16:9</option>
        <option value={32 / 9}>32:9</option>
        <option value={4 / 3}>4:3</option>
        <option value={1}>1:1</option>
      </select>
    </>
  );
}
export function Output({ transparent }: { transparent: boolean }) {
  const token = location.hash.slice(1);
  const [state, setState] = useState<AnyRecord | null>(null);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState("");
  const handle = useRef<StageHandle | null>(null);
  const [controls, setControls] = useState(
    !new URLSearchParams(location.search).has("clean"),
  );
  const [settings, setSettings] = useState<AnyRecord>(
    () =>
      safeRead("icpc.screen.settings.v1") || {
        resolution: 1440,
        ratio: 16 / 9,
      },
  );
  useEffect(
    () =>
      subscribe(
        "/broadcast/events",
        { "X-Output-Token": token },
        setState,
        setOnline,
        () => {
          setState(null);
          setError("输出链接已失效，请重新获取链接");
        },
      ),
    [token],
  );
  useEffect(() => {
    document.body.style.background = transparent ? "transparent" : "";
    return () => {
      document.body.style.background = "";
    };
  }, [transparent]);
  return (
    <div className={"output-shell " + (transparent ? "transparent" : "")}>
      {error ? (
        <p className="output-error" role="alert">
          {error}
        </p>
      ) : null}
      <Stage
        state={state}
        transparent={transparent}
        resolution={settings.resolution}
        ratio={settings.ratio}
        headers={{ "X-Output-Token": token }}
        muted={false}
        handle={handle}
      />
      {controls ? (
        <div className="output-controls">
          <span>{online ? "Live 正式输出" : "正在连接正式输出"}</span>
          {error ? <span>{error}</span> : null}
          <OutputSettings
            settings={settings}
            update={(p) =>
              setSettings((s: AnyRecord) => {
                const n = { ...s, ...p };
                safeWrite("icpc.screen.settings.v1", n);
                return n;
              })
            }
          />
          <Button
            onClick={() => {
              handle.current?.audio();
              setControls(false);
            }}
          >
            启用声音并隐藏控制栏
          </Button>
          <Button
            className="secondary"
            onClick={() => {
              void document.documentElement
                .requestFullscreen()
                .catch(() => setError("请使用浏览器全屏功能"));
            }}
          >
            全屏
          </Button>
        </div>
      ) : null}
    </div>
  );
}
