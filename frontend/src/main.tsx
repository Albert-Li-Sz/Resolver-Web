import React, { useState, useEffect, useRef, lazy } from "react";
import { createRoot } from "react-dom/client";
import { subscribe } from "./api";
import type { AnyRecord } from "./types";
import "./style.css";
const Live = lazy(() => import("./Live"));
const Admin = lazy(() => import("./Admin"));
const Display = lazy(() =>
  import("./Outputs").then((m) => ({ default: m.Display })),
);
const Output = lazy(() =>
  import("./Outputs").then((m) => ({ default: m.Output })),
);
const HOME = [
  ["Resolver", "滚榜", "/resolver/", "01"],
  ["Live", "赛事导播", "/live/", "02"],
  ["PresentationAdmin", "多屏管理", "/presentation-admin/", "03"],
  ["Presentations", "展示屏", "/presentations/", "04"],
];
function App() {
  const path = location.pathname;
  const output =
    path.startsWith("/live/program") || path.startsWith("/live/overlay");
  const display = path.startsWith("/presentations");
  const [state, setState] = useState<AnyRecord | null>(null);
  const [message, setMessage] = useState("");
  const [online, setOnline] = useState(false);
  useEffect(() => {
    if (display || output || path === "/") return;
    return subscribe("/platform/events", {}, setState, setOnline);
  }, [display, output]);
  const run = async (fn: () => Promise<unknown>, success = "已保存") => {
    try {
      await fn();
      setMessage(success);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  if (display)
    return (
      <React.Suspense fallback={<p>正在加载展示屏…</p>}>
        <Display />
      </React.Suspense>
    );
  if (output)
    return (
      <React.Suspense fallback={null}>
        <Output transparent={path.startsWith("/live/overlay")} />
      </React.Suspense>
    );
  if (path === "/")
    return (
      <>
        <Header />
        <main className="home">
          <div className="home-heading">
            <h1>赛事制作台</h1>
            <p>滚榜、导播与多屏展示</p>
          </div>
          <div className="entry-grid">
            {HOME.map(([name, desc, url]) => (
              <a className="entry" href={url} key={name}>
                <h2>{name}</h2>
                <p>{desc}</p>
                <span className="entry-action">
                  进入 <ArrowIcon />
                </span>
              </a>
            ))}
          </div>
        </main>
      </>
    );
  return (
    <>
      <Header />
      <main className="workspace">
        <div className="heading">
          <h1>{path.startsWith("/live") ? "Live" : "PresentationAdmin"}</h1>
          <span className={"connection " + (online ? "online" : "")}>
            {online ? "服务已连接" : "正在重连"}
          </span>
        </div>
        {message ? (
          <div className="notice" role="status">
            {message}
            <button onClick={() => setMessage("")} aria-label="关闭消息">
              ×
            </button>
          </div>
        ) : null}
        <React.Suspense fallback={<p>正在加载…</p>}>
          {state ? (
            path.startsWith("/live") ? (
              <Live state={state} run={run} />
            ) : (
              <Admin state={state} run={run} />
            )
          ) : (
            <p role="status">正在连接服务…</p>
          )}
        </React.Suspense>
      </main>
    </>
  );
}
function ArrowIcon() {
  return (
    <svg
      className="arrow-icon"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 10h12m-5-5 5 5-5 5" />
    </svg>
  );
}
function Header() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <header className="platform-header">
      <a className="brand" href="/">
        <span>ICPC 赛事制作台</span>
      </a>
      <button
        ref={toggle}
        type="button"
        className="nav-toggle"
        aria-label={open ? "关闭模块导航" : "打开模块导航"}
        aria-expanded={open}
        aria-controls="platform-nav"
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          className="menu-icon"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d={open ? "m5 5 10 10M15 5 5 15" : "M4 6h12M4 10h12M4 14h12"} />
        </svg>
      </button>
      <nav
        id="platform-nav"
        className={"platform-nav" + (open ? " is-open" : "")}
        aria-label="模块导航"
      >
        {HOME.map(([name, , url]) => (
          <a
            className={location.pathname.startsWith(url) ? "active" : ""}
            href={url}
            key={name}
            aria-current={
              location.pathname.startsWith(url) ? "page" : undefined
            }
          >
            {name}
          </a>
        ))}
      </nav>
    </header>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
