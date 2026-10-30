type Identity = { id: string; token: string };
const clients = new Map<MessagePort, { identity: Identity; seenAt: number }>();
let abort: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
function schedule() {
  clearTimeout(timer);
  abort?.abort();
  timer = setTimeout(() => void connect(), 40);
}
async function connect() {
  if (!clients.size) return;
  const controller = new AbortController();
  abort = controller;
  const identities = [
    ...new Map(
      [...clients.values()].map((c) => [c.identity.id, c.identity]),
    ).values(),
  ];
  try {
    const response = await fetch("/api/displays/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identities }),
      signal: controller.signal,
    });
    if (!response.ok) throw Error("Connection unavailable");
    for (const port of clients.keys())
      port.postMessage({ kind: "connection", online: true });
    const reader = response.body!.getReader();
    let buffer = "";
    const decoder = new TextDecoder();
    try {
      while (!controller.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = block.split("\n").find((l) => l.startsWith("data: "));
          if (!data) continue;
          const value = JSON.parse(data.slice(6));
          for (const [port, client] of clients) {
            const device = value.devices.find(
              (d: Identity) => d.id === client.identity.id,
            );
            if (device?.error) {
              port.postMessage({ kind: "error", message: device.error });
              continue;
            }
            if (device)
              port.postMessage({
                kind: "state",
                value: { ...device, state: device.paired ? value.data : null },
              });
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch {
    /* Every reconnect receives an authoritative snapshot. */
  }
  if (!controller.signal.aborted) {
    for (const port of clients.keys())
      port.postMessage({ kind: "connection", online: false });
    timer = setTimeout(() => void connect(), 1500);
  }
}
(self as unknown as { onconnect: (event: MessageEvent) => void }).onconnect = (
  event,
) => {
  const port = event.ports[0];
  port.onmessage = (message) => {
    const data = message.data;
    if (data.kind === "subscribe") {
      clients.set(port, { identity: data.identity, seenAt: Date.now() });
      schedule();
    } else if (data.kind === "ping") {
      const client = clients.get(port);
      if (client) client.seenAt = Date.now();
      else if (data.identity) {
        clients.set(port, { identity: data.identity, seenAt: Date.now() });
        schedule();
      }
    } else if (data.kind === "close") {
      clients.delete(port);
      port.close();
      schedule();
    }
  };
  port.start();
};
setInterval(() => {
  let changed = false;
  for (const [port, client] of clients)
    if (Date.now() - client.seenAt > 90000) {
      clients.delete(port);
      port.close();
      changed = true;
    }
  if (changed) schedule();
}, 30000);
