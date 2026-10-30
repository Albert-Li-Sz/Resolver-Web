import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../public/js/event-worker.js", import.meta.url),
  "utf8",
);
const flush = () => new Promise((r) => setImmediate(r));
function environment(t, status = 200) {
  let now = Date.now(),
    sweep = () => {};
  const requests = [],
    ports = [];
  const context = {
    self: {},
    AbortController,
    TextDecoder,
    Date: { now: () => now },
    console,
    setTimeout,
    clearTimeout,
    setInterval: (fn) => {
      sweep = fn;
      return 0;
    },
    fetch: async (path, options) => {
      let controller;
      const body = new ReadableStream({
        start(c) {
          controller = c;
          options.signal.addEventListener("abort", () => c.close());
        },
      });
      requests.push({
        path,
        options,
        send: (type, value) =>
          controller.enqueue(
            new TextEncoder().encode(
              `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`,
            ),
          ),
      });
      return new Response(body, {
        status: typeof status === "function" ? status() : status,
      });
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  function client(path, headers = {}) {
    const messages = [],
      port = {
        messages,
        onmessage: null,
        start() {},
        close() {},
        postMessage(m) {
          messages.push(structuredClone(m));
        },
        send(data) {
          this.onmessage({ data });
        },
      };
    ports.push(port);
    context.self.onconnect({ ports: [port] });
    port.send({ kind: "subscribe", path, headers });
    return port;
  }
  t.after(() => ports.forEach((p) => p.send({ kind: "close" })));
  return {
    requests,
    client,
    expire: () => {
      now += 91000;
      sweep();
    },
  };
}
test("identical admin and output subscriptions share streams, while output capabilities stay isolated", async (t) => {
  const e = environment(t),
    a = e.client("/api/platform/events"),
    b = e.client("/api/platform/events");
  e.client("/api/broadcast/events", { "X-Output-Token": "one" });
  e.client("/api/broadcast/events", { "X-Output-Token": "one" });
  const other = e.client("/api/broadcast/events", { "X-Output-Token": "two" });
  await flush();
  assert.equal(e.requests.length, 3);
  e.requests[0].send("state", { revision: 7, private: "admin" });
  await flush();
  assert.equal(a.messages.at(-1).value.revision, 7);
  assert.equal(b.messages.at(-1).value.private, "admin");
  assert.ok(other.messages.every((m) => !m.value?.private));
});
test("a late viewer receives a snapshot without replaying a stale advance event", async (t) => {
  const e = environment(t),
    path = "/api/watch/" + "a".repeat(32) + "/events";
  e.client(path);
  await flush();
  e.requests[0].send("snapshot", {
    game: { steps: [{ id: 1 }] },
    playback: { revision: 1 },
  });
  e.requests[0].send("advance", {
    playback: { revision: 2 },
    steps: [{ id: 2 }],
  });
  await flush();
  const late = e.client(path);
  await flush();
  assert.equal(e.requests.length, 1);
  assert.deepEqual(
    late.messages.filter((m) => m.kind === "event").map((m) => m.type),
    ["snapshot"],
  );
  assert.equal(
    late.messages.find((m) => m.kind === "event").value.playback.revision,
    2,
  );
  assert.deepEqual(
    late.messages.find((m) => m.kind === "event").value.game.steps,
    [{ id: 1 }, { id: 2 }],
  );
});
test("invalid capabilities never receive a cached state or a connected signal", async (t) => {
  const e = environment(t, 403),
    a = e.client("/api/broadcast/events", { "X-Output-Token": "expired" });
  await flush();
  const b = e.client("/api/broadcast/events", { "X-Output-Token": "expired" });
  await flush();
  for (const p of [a, b]) {
    assert.ok(p.messages.some((m) => m.kind === "unauthorized"));
    assert.ok(
      p.messages.every(
        (m) => m.kind !== "event" && !(m.kind === "connection" && m.online),
      ),
    );
  }
});
test("the worker accepts only known same-origin realtime endpoints", async (t) => {
  const e = environment(t);
  e.client("https://example.com/api/platform/events");
  e.client("/api/configs");
  await flush();
  assert.equal(e.requests.length, 0);
});

test("throttled background clients reattach after their stream lease expires", async (t) => {
  const e = environment(t),
    path = "/api/platform/events",
    port = e.client(path);
  await flush();
  e.expire();
  await flush();
  assert.equal(e.requests[0].options.signal.aborted, true);
  port.send({ kind: "ping", path, headers: {} });
  await flush();
  assert.equal(e.requests.length, 2);
  e.requests[1].send("state", { revision: 9 });
  await flush();
  assert.equal(port.messages.at(-1).value.revision, 9);
});

test("a reloaded management page retries after an expired Basic login", async (t) => {
  let attempt = 0;
  const e = environment(t, () => (++attempt === 1 ? 401 : 200));
  e.client("/api/platform/events");
  await flush();
  const authenticated = e.client("/api/platform/events");
  await flush();
  assert.equal(e.requests.length, 2);
  e.requests[1].send("state", { revision: 10 });
  await flush();
  assert.equal(authenticated.messages.at(-1).value.revision, 10);
});
