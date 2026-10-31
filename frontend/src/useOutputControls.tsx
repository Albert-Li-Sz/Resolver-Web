import { useEffect, useState } from "react";
import { safeRead, safeWrite } from "./api";
export function useOutputControls(identity: string, clean = false) {
  const key = `icpc.output.controls.${identity}`;
  const [visible, setVisible] = useState(
    () => !clean && safeRead(key) !== false,
  );
  const [hint, setHint] = useState(false);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const toggleFullscreen = async (error: (message: string) => void) => {
    try {
      error("");
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        if (!document.documentElement.requestFullscreen) throw Error();
        await document.documentElement.requestFullscreen();
      }
    } catch {
      error("无法进入全屏，请使用浏览器全屏功能");
    }
  };
  useEffect(() => {
    setVisible(!clean && safeRead(key) !== false);
    setHint(false);
  }, [key, clean]);
  const show = () => {
    if (!clean) {
      setVisible(true);
      safeWrite(key, true);
    }
  };
  const hide = () => {
    if (!safeRead(`${key}.hinted`)) {
      setHint(true);
      safeWrite(`${key}.hinted`, true);
      return;
    }
    setHint(false);
    setVisible(false);
    safeWrite(key, false);
  };
  useEffect(() => {
    if (clean) return;
    const listener = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        e.key.toLowerCase() !== "h" ||
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        ["INPUT", "SELECT", "TEXTAREA"].includes(tag) ||
        (e.target as HTMLElement)?.isContentEditable
      )
        return;
      e.preventDefault();
      setHint(false);
      setVisible((v) => {
        safeWrite(key, !v);
        return !v;
      });
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [key, clean]);
  return {
    visible: !clean && visible,
    hide,
    fullscreen,
    toggleFullscreen,
    show,
    restore:
      !clean && !visible ? (
        <button
          className="controls-hotspot"
          aria-label="显示控制栏"
          title="显示控制栏（H）"
          onClick={show}
        />
      ) : null,
    hint:
      hint && !clean ? (
        <div className="controls-hint" role="status">
          隐藏后按 H 或点击右上角可打开控制栏。
          <button onClick={hide}>知道了，隐藏</button>
        </div>
      ) : null,
  };
}
