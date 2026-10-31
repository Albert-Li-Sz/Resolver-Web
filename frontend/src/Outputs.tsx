import { useState, useEffect, useRef } from "react";
import { api, subscribe, safeRead, safeWrite } from "./api";
import { Stage, type StageHandle } from "./Stage";
import type { AnyRecord } from "./types";
import { Button } from "./ui";
import { subscribeDisplay } from "./display-channel";
import {
  readDisplayCache,
  writeDisplayCache,
} from "../../public/js/display-cache.js";
import { useOutputControls } from "./useOutputControls";
import { useOutputHeartbeat } from "./Health";
import {
  OutputArea,
  ProfileFields,
  outputProfile,
  captureOutput,
} from "./OutputProfile";
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
  const [heartbeatError, setHeartbeatError] = useState("");
  const [settings, setSettings] = useState<AnyRecord>(
    () =>
      safeRead("icpc.screen.settings.v1") || {
        resolution: 1440,
        ratio: 16 / 9,
      },
  );
  const controls = useOutputControls(identity?.id || "unpaired");
  const handle = useRef<StageHandle | null>(null);
  const applied = useRef(-1);
  const latest = useRef(device);
  latest.current = device;
  const [clockOffset, setClockOffset] = useState(
    () => Number(safeRead(`icpc.display.clock.${identity?.id}`)) || 0,
  );
  const clockRef = useRef(clockOffset);
  clockRef.current = clockOffset;
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
    setHeartbeatError("");
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
    let received = false;
    void readDisplayCache(identity.id).then((cached) => {
      if (active && !received && cached) setDevice(cached);
    });
    let pendingCache: AnyRecord | null = null,
      cacheTimer: ReturnType<typeof setTimeout> | undefined,
      persisting = false;
    const persist = async () => {
      cacheTimer = undefined;
      if (persisting || !pendingCache) return;
      const next = pendingCache;
      pendingCache = null;
      persisting = true;
      const saved = await writeDisplayCache(identity.id, next);
      if (saved) {
        try {
          localStorage.removeItem(`icpc.display.cache.${identity.id}`);
        } catch {
          /* Storage may be disabled. */
        }
      } else safeWrite(`icpc.display.cache.${identity.id}`, next);
      persisting = false;
      if (pendingCache) cacheTimer = setTimeout(() => void persist(), 100);
    };
    const stop = subscribeDisplay(
      { id: identity.id, token: identity.token },
      (v) => {
        if (!active) return;
        received = true;
        setDevice(v);
        pendingCache = v;
        if (!cacheTimer && !persisting)
          cacheTimer = setTimeout(() => void persist(), 100);
        setError("");
      },
      setOnline,
      setError,
    );
    let capturing = false,
      beating = false,
      thumbnail: string | undefined;
    let capturedAt = 0;
    const capture = async () => {
      if (capturing) return;
      capturing = true;
      try {
        const next = await handle.current?.capture();
        if (active && next) {
          thumbnail = await captureOutput(next);
          capturedAt = Date.now();
        }
      } catch {
        /* A screenshot must never interrupt heartbeats. */
      } finally {
        capturing = false;
      }
    };
    const beat = async () => {
      if (beating || !active) return;
      beating = true;
      void capture();
      try {
        const started = Date.now();
        const v = await api(
          `/displays/${identity.id}/heartbeat`,
          {
            revision: applied.current,
            thumbnail,
            clockOffset: clockRef.current,
            health: handle.current
              ? {
                  ...handle.current.health(),
                  thumbnailAgeMs: capturedAt ? Date.now() - capturedAt : null,
                }
              : undefined,
          },
          "POST",
          headers,
        );
        const offset = v.serverTime - (started + Date.now()) / 2;
        if (!active) return;
        setClockOffset(offset);
        setHeartbeatError("");
        safeWrite(`icpc.display.clock.${identity.id}`, offset);
      } catch {
        if (active) setHeartbeatError("状态上报失败，正在重试");
      } finally {
        beating = false;
      }
    };
    void beat();
    const timer = setInterval(beat, 5000);
    return () => {
      active = false;
      stop();
      clearInterval(timer);
      clearTimeout(cacheTimer);
      if (pendingCache) void persist();
    };
  }, [identity?.id]);
  const profile = outputProfile(device?.outputProfile || settings);
  const update = async (next: AnyRecord) => {
    try {
      const saved = await api(
        `/displays/${identity!.id}/settings`,
        { revision: device!.revision, outputProfile: next },
        "PUT",
        { "X-Display-Token": identity!.token },
      );
      setDevice(saved);
      setSettings(next);
      safeWrite(`icpc.screen.settings.${identity!.id}`, next);
    } catch (e) {
      setError((e as Error).message);
    }
  };
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
        {error || heartbeatError ? <p role="alert">{error || heartbeatError}</p> : null}
        <Button className="secondary" onClick={() => void register()}>
          新建独立展示屏
        </Button>
      </main>
    );
  return (
    <div className="output-shell">
      <OutputArea profile={profile}>
        {(resolution, ratio) => (
          <Stage
            state={device.state}
            program={{ ...device, clockOffset }}
            headers={{
              "X-Display-Id": identity!.id,
              "X-Display-Token": identity!.token,
            }}
            hidden={device.hidden}
            resolution={resolution}
            ratio={ratio}
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
        )}
      </OutputArea>
      {controls.restore}
      {controls.hint}
      {controls.visible ? (
        <div className="output-controls">
          <strong>{device.name}</strong>
          <span>{online ? "已同步" : "连接中断 · 保留画面"}</span>
          <ProfileFields value={profile} change={update} />
          {error || heartbeatError ? <span role="alert">{error || heartbeatError}</span> : null}
          <Button onClick={() => void controls.toggleFullscreen(setError)}>
            {controls.fullscreen ? "退出全屏" : "全屏"}
          </Button>
          <Button className="secondary" onClick={() => handle.current?.audio()}>
            启用声音
          </Button>
          <Button className="secondary" onClick={() => void register()}>
            新建屏幕
          </Button>
          <Button className="secondary" onClick={controls.hide}>
            隐藏控制栏
          </Button>
        </div>
      ) : null}
    </div>
  );
}
export function Output({ transparent }: { transparent: boolean }) {
  const token = location.hash.slice(1);
  const [state, setState] = useState<AnyRecord | null>(null);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState("");
  const handle = useRef<StageHandle | null>(null);
  useOutputHeartbeat(token, transparent ? "overlay" : "program", handle);
  const controls = useOutputControls(
    transparent ? "live-overlay" : "live-program",
    new URLSearchParams(location.search).has("clean"),
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
      <OutputArea
        profile={outputProfile(
          state?.broadcast?.outputProfiles?.[
            transparent ? "overlay" : "program"
          ] || settings,
        )}
      >
        {(resolution, ratio) => (
          <Stage
            state={state}
            transparent={transparent}
            resolution={resolution}
            ratio={ratio}
            headers={{ "X-Output-Token": token }}
            muted={false}
            handle={handle}
          />
        )}
      </OutputArea>
      {controls.restore}
      {controls.hint}
      {controls.visible ? (
        <div className="output-controls">
          <span>{online ? "Live 正式输出" : "正在连接正式输出"}</span>
          {error ? <span>{error}</span> : null}
          <Button
            onClick={() => {
              handle.current?.audio();
            }}
          >
            启用声音
          </Button>
          <Button
            className="secondary"
            onClick={() => void controls.toggleFullscreen(setError)}
          >
            {controls.fullscreen ? "退出全屏" : "全屏"}
          </Button>
          <Button className="secondary" onClick={controls.hide}>
            隐藏控制栏
          </Button>
        </div>
      ) : null}
    </div>
  );
}
