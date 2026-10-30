import { subscribe } from "./api";
import displayWorkerURL from "./display-worker?sharedworker&url";
export function subscribeDisplay(
  identity: { id: string; token: string },
  receive: (value: any) => void,
  status: (online: boolean) => void,
  error: (message: string) => void,
) {
  let worker: SharedWorker | undefined;
  let fallback: (() => void) | undefined;
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const startFallback = () => {
    if (closed || fallback) return;
    clearInterval(timer);
    worker?.port.close();
    fallback = subscribe(
      `/displays/${identity.id}/events`,
      { "X-Display-Token": identity.token },
      receive,
      status,
      () => error("展示屏身份已失效，请新建屏幕"),
    );
  };
  const attach = () => {
    try {
      if (typeof SharedWorker === "undefined") return startFallback();
      worker = new SharedWorker(displayWorkerURL, {
        type: "module",
        name: displayWorkerURL,
      });
      worker.onerror = () => startFallback();
      worker.port.onmessage = (event) => {
        const data = event.data;
        if (data.kind === "state") receive(data.value);
        else if (data.kind === "connection") status(data.online);
        else if (data.kind === "error") {
          status(false);
          error(data.message);
        }
      };
      worker.port.start();
      worker.port.postMessage({ kind: "subscribe", identity });
      timer = setInterval(
        () => worker?.port.postMessage({ kind: "ping", identity }),
        15000,
      );
    } catch {
      startFallback();
    }
  };
  const suspend = () => {
    clearInterval(timer);
    fallback?.();
    fallback = undefined;
    worker?.port.postMessage({ kind: "close" });
    worker?.port.close();
    worker = undefined;
  };
  const resume = (event: PageTransitionEvent) => {
    if (event.persisted && !closed) attach();
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
