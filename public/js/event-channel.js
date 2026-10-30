/** Share identical realtime subscriptions across all tabs; never share capabilities. */
const workerURL = "/js/event-worker.js?v=1";
export function subscribeEvents(
  path,
  headers,
  receive,
  status = () => {},
  unauthorized = () => {},
) {
  let worker,
    closed = false,
    suspended = false,
    pollingFallback = false,
    pollTimer,
    ping,
    controller;
  const fallback = () => {
    if (closed || suspended || pollingFallback) return;
    pollingFallback = true;
    worker?.port.postMessage({ kind: "close" });
    worker?.port.close();
    worker = undefined;
    clearInterval(ping);
    const route = path
      .replace(/\/events$/, "")
      .replace("/broadcast", "/broadcast/output")
      .replace(/(\/displays\/[a-f0-9]{32})$/, "$1/state");
    const poll = async () => {
      controller = new AbortController();
      try {
        const response = await fetch(route, {
          headers,
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          unauthorized();
          status(false);
          return;
        }
        if (!response.ok) throw Error();
        receive(
          await response.json(),
          path.includes("/watch/") ? "snapshot" : "state",
        );
        status(true);
      } catch {
        if (!closed && !suspended) status(false);
      }
      if (!closed && !suspended) pollTimer = setTimeout(poll, 1000);
    };
    if (!closed) void poll();
  };
  const attach = () => {
    suspended = false;
    pollingFallback = false;
    try {
      if (typeof SharedWorker === "undefined") return fallback();
      worker = new SharedWorker(workerURL, { name: workerURL });
      worker.onerror = () => fallback();
      worker.port.onmessage = (event) => {
        if (closed) return;
        const m = event.data;
        if (m.kind === "event") receive(m.value, m.type);
        else if (m.kind === "connection") status(m.online);
        else if (m.kind === "unauthorized") {
          status(false);
          unauthorized();
        }
      };
      worker.port.start();
      worker.port.postMessage({ kind: "subscribe", path, headers });
      ping = setInterval(
        () => worker?.port.postMessage({ kind: "ping", path, headers }),
        15000,
      );
    } catch {
      fallback();
    }
  };
  const suspend = () => {
    suspended = true;
    clearInterval(ping);
    clearTimeout(pollTimer);
    controller?.abort();
    worker?.port.postMessage({ kind: "close" });
    worker?.port.close();
    worker = undefined;
  };
  const resume = (e) => {
    if (e.persisted && !closed) attach();
  };
  attach();
  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", resume);
  return () => {
    closed = true;
    suspend();
    window.removeEventListener("pagehide", suspend);
    window.removeEventListener("pageshow", resume);
  };
}
export function sharedEventSource(path, headers = {}) {
  const target = new EventTarget();
  target.readyState = 0;
  target.close = () => {
    stop();
    target.readyState = 2;
  };
  const stop = subscribeEvents(
    path,
    headers,
    (value, type) =>
      target.dispatchEvent(
        new MessageEvent(type, { data: JSON.stringify(value) }),
      ),
    (online) => {
      target.readyState = online ? 1 : 0;
      const event = new Event(online ? "open" : "error");
      target.dispatchEvent(event);
      target[online ? "onopen" : "onerror"]?.(event);
    },
    () => {
      target.readyState = 2;
      const event = new Event("error");
      target.dispatchEvent(event);
      target.onerror?.(event);
    },
  );
  return target;
}
