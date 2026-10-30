/* Same-origin SSE fan-out. A capability is part of the channel key. */
const clients = new Map(),
  channels = new Map();
const allowed =
  /^\/api\/(?:platform\/events|broadcast\/events|watch\/[a-f0-9]{32}\/events|displays\/[a-f0-9]{32}\/events)$/;
function post(channel, message) {
  for (const port of channel.ports)
    try {
      port.postMessage(message);
    } catch {
      detach(port);
    }
}
function detach(port) {
  const client = clients.get(port);
  if (!client) return;
  clients.delete(port);
  const channel = channels.get(client.key);
  channel?.ports.delete(port);
  if (channel && !channel.ports.size) {
    channel.abort?.abort();
    clearTimeout(channel.timer);
    channels.delete(client.key);
  }
}
async function connect(channel) {
  if (!channel.ports.size) return;
  const controller = new AbortController();
  channel.abort = controller;
  try {
    const response = await fetch(channel.path, {
      headers: channel.headers,
      signal: controller.signal,
      credentials: "same-origin",
    });
    if (response.status === 401 || response.status === 403) {
      channel.online = false;
      channel.unauthorized = true;
      channel.last = null;
      post(channel, { kind: "unauthorized" });
      return;
    }
    if (!response.ok) throw Error("SSE unavailable");
    channel.online = true;
    channel.unauthorized = false;
    post(channel, { kind: "connection", online: true });
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!controller.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const lines = block.split("\n"),
            payload = lines
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
          if (!payload) continue;
          const type =
            lines
              .find((line) => line.startsWith("event:"))
              ?.slice(6)
              .trim() || "message";
          const message = { kind: "event", type, value: JSON.parse(payload) };
          if (type === "state" || type === "snapshot") channel.last = message;
          else if (type === "advance" && channel.last?.type === "snapshot") {
            const previous = channel.last.value;
            if (
              message.value.playback.revision ===
              previous.playback.revision + 1
            )
              channel.last = {
                kind: "event",
                type: "snapshot",
                value: {
                  game: {
                    ...previous.game,
                    steps: [...previous.game.steps, ...message.value.steps],
                  },
                  playback: message.value.playback,
                },
              };
            else channel.last = null;
          } else if (type === "expired") channel.last = null;
          post(channel, message);
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch {
    /* Reconnect always starts from an authoritative snapshot. */
  }
  if (!controller.signal.aborted && channel.ports.size) {
    channel.online = false;
    post(channel, { kind: "connection", online: false });
    channel.timer = setTimeout(() => void connect(channel), 1500);
  }
}
self.onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = (message) => {
    const data = message.data;
    if (data.kind === "close") {
      detach(port);
      port.close();
      return;
    }
    if (data.kind === "ping") {
      const client = clients.get(port);
      if (client) {
        client.seen = Date.now();
        return;
      }
      // A throttled background tab may outlive the worker's stale-client lease.
      data.kind = "subscribe";
    }
    if (data.kind !== "subscribe" || !allowed.test(data.path)) return;
    detach(port);
    const headers = Object.fromEntries(
        Object.entries(data.headers || {}).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      ),
      key = JSON.stringify([data.path, headers]);
    let channel = channels.get(key);
    if (!channel) {
      channel = {
        path: data.path,
        headers,
        ports: new Set(),
        last: null,
        abort: null,
        timer: null,
        online: false,
        unauthorized: false,
      };
      channels.set(key, channel);
    }
    channel.ports.add(port);
    clients.set(port, { key, seen: Date.now() });
    if (channel.unauthorized) {
      // A reloaded management page may have completed a new Basic login.
      if (channel.path === "/api/platform/events") {
        channel.unauthorized = false;
        channel.abort = null;
      } else {
        port.postMessage({ kind: "unauthorized" });
        return;
      }
    }
    if (channel.last) port.postMessage(channel.last);
    if (channel.abort && !channel.abort.signal.aborted)
      port.postMessage({ kind: "connection", online: channel.online });
    else void connect(channel);
  };
  port.start();
};
setInterval(() => {
  for (const [port, c] of clients)
    if (Date.now() - c.seen > 90000) {
      detach(port);
    }
}, 30000);
