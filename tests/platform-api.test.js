import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
const directory = await mkdtemp(path.join(tmpdir(), "icpc-platform-api-"));
process.env.RESOLVER_DATA_DIR = directory;
process.env.RESOLVER_ADMIN_KEY = "platform-test-key";
const { app, platform } = await import("../server/index.js");
after(async () => {
  platform.feeds.close();
  await rm(directory, { recursive: true, force: true });
});
async function serve(t) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}
const manage = {
  "X-Resolver-Admin": "platform-test-key",
  "Content-Type": "application/json",
};
const post = (body, headers = manage) => ({
  method: "POST",
  headers,
  body: JSON.stringify(body),
});
test("module routes enforce management access while home and output shells stay public", async (t) => {
  const base = await serve(t);
  for (const route of [
    "/",
    "/presentations/",
    "/live/program/",
    "/live/overlay/",
    "/view",
  ])
    assert.equal((await fetch(base + route)).status, 200, route);
  for (const route of [
    "/resolver/",
    "/resolver/display",
    "/live/",
    "/presentation-admin/",
    "/api/platform",
    "/api/workspaces",
    "/api/presentations/plans",
    "/api/media/sources",
  ])
    assert.equal((await fetch(base + route)).status, 401, route);
  assert.equal((await fetch(base + "/api/broadcast/output")).status, 403);
  assert.equal(
    (
      await fetch(
        base + "/api/media/read/" + "a".repeat(32),
        post({}, { "Content-Type": "application/json" }),
      )
    ).status,
    403,
  );
  for (const [old, target] of [
    ["/index.html", "/resolver/"],
    ["/display.html", "/resolver/display"],
    ["/logos.html", "/resolver/logos"],
    ["/presets.html", "/resolver/presets"],
  ]) {
    const r = await fetch(base + old, { headers: manage, redirect: "manual" });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), target);
  }
  assert.equal((await fetch(base + "/nonexistent-module")).status, 404);
});
test("output capabilities receive public data, never preview settings or source passwords", async (t) => {
  const base = await serve(t);
  let state = await (
    await fetch(base + "/api/platform", { headers: manage })
  ).json();
  const token = state.broadcast.token;
  const p = await fetch(base + "/api/broadcast/preview", {
    method: "PUT",
    headers: manage,
    body: JSON.stringify({
      revision: state.broadcast.revision,
      scene: { title: "PRIVATE-PREVIEW" },
    }),
  });
  assert.equal(p.status, 200);
  let output = await (
    await fetch(base + "/api/broadcast/output", {
      headers: { "X-Output-Token": token },
    })
  ).json();
  assert.equal(output.broadcast.program.title, "");
  assert.doesNotMatch(
    JSON.stringify(output),
    /PRIVATE-PREVIEW|tokenHash|password/,
  );
  const updated = await p.json();
  assert.equal(
    (
      await fetch(
        base + "/api/broadcast/take",
        post({ revision: updated.revision }),
      )
    ).status,
    200,
  );
  output = await (
    await fetch(base + "/api/broadcast/output", {
      headers: { "X-Output-Token": token },
    })
  ).json();
  assert.equal(output.broadcast.program.title, "PRIVATE-PREVIEW");
  assert.equal(
    (
      await fetch(
        base + "/api/broadcast/take",
        post({ revision: updated.revision }),
      )
    ).status,
    409,
  );
  const rotated = await (
    await fetch(base + "/api/broadcast/rotate-token", post({}))
  ).json();
  assert.notEqual(rotated.token, token);
  assert.equal(
    (
      await fetch(base + "/api/broadcast/output", {
        headers: { "X-Output-Token": token },
      })
    ).status,
    403,
  );
});
test("pair, command and heartbeat require the correct independent identities", async (t) => {
  const base = await serve(t);
  const reg = await (
    await fetch(
      base + "/api/displays/register",
      post({}, { "Content-Type": "application/json" }),
    )
  ).json();
  const own = {
    "X-Display-Token": reg.token,
    "Content-Type": "application/json",
  };
  assert.equal(
    (await fetch(base + `/api/displays/${reg.id}/state`)).status,
    403,
  );
  let state = await (
    await fetch(base + `/api/displays/${reg.id}/state`, { headers: own })
  ).json();
  assert.equal(state.paired, false);
  assert.equal(state.state, null);
  assert.equal(
    (
      await fetch(
        base + "/api/displays/pair",
        post({ code: reg.code, name: "Stage" }),
      )
    ).status,
    200,
  );
  state = await (
    await fetch(base + `/api/displays/${reg.id}/state`, { headers: own })
  ).json();
  assert.equal(state.name, "Stage");
  assert.equal(state.code, undefined);
  assert.equal(
    (
      await fetch(
        base + `/api/displays/${reg.id}/heartbeat`,
        post(
          {
            revision: state.revision,
            thumbnail: "data:image/jpeg;base64,YQ==",
          },
          own,
        ),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(
        base + `/api/displays/${reg.id}/heartbeat`,
        post({ thumbnail: "data:image/svg+xml,SECRET" }, own),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(
        base + "/api/displays/command",
        post(
          {
            ids: [reg.id],
            revisions: { [reg.id]: state.revision },
            action: "hide",
          },
          own,
        ),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(
        base + "/api/displays/command",
        post({
          ids: [reg.id],
          revisions: { [reg.id]: state.revision },
          action: "hide",
        }),
      )
    ).status,
    200,
  );
  const admin = await (
    await fetch(base + "/api/platform", { headers: manage })
  ).json();
  assert.equal(admin.displays[0].online, true);
  assert.equal(admin.displays[0].hidden, true);
  assert.equal(admin.displays[0].tokenHash, undefined);
});
test("media routes validate sources and return an explicit unavailable error without a configured gateway", async (t) => {
  const base = await serve(t);
  assert.equal(
    (
      await fetch(
        base + "/api/media/sources",
        post({ name: "bad", url: "http://127.0.0.1", allowPrivate: true }),
      )
    ).status,
    400,
  );
  const source = await (
    await fetch(
      base + "/api/media/sources",
      post({
        name: "Camera",
        url: "rtsp://192.168.1.20/live",
        allowPrivate: true,
        password: "SOURCE-SECRET",
      }),
    )
  ).json();
  assert.ok(source.id);
  assert.equal(source.password, undefined);
  assert.equal(
    (await fetch(base + `/api/media/sources/${source.id}/test`, post({})))
      .status,
    503,
  );
  const admin = await (
    await fetch(base + "/api/platform", { headers: manage })
  ).json();
  assert.doesNotMatch(JSON.stringify(admin), /SOURCE-SECRET/);
  const out = await (
    await fetch(base + "/api/broadcast/output", {
      headers: { "X-Output-Token": admin.broadcast.token },
    })
  ).json();
  assert.equal(
    out.media.length,
    0,
    "unselected private camera sources are absent from public output",
  );
  assert.equal(
    (
      await fetch(
        base + `/api/media/read/${source.id}`,
        post(
          {},
          {
            "Content-Type": "application/json",
            "X-Output-Token": admin.broadcast.token,
          },
        ),
      )
    ).status,
    403,
  );
});

test("multiplexed display SSE remains subscribed after its POST body ends", async (t) => {
  const base = await serve(t);
  const reg = await (
    await fetch(
      base + "/api/displays/register",
      post({}, { "Content-Type": "application/json" }),
    )
  ).json();
  await fetch(
    base + "/api/displays/pair",
    post({ code: reg.code, name: "Multiplex screen" }),
  );
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(base + "/api/displays/events", {
    ...post(
      { identities: [{ id: reg.id, token: reg.token }] },
      { "Content-Type": "application/json" },
    ),
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  let buffer = "";
  const decoder = new TextDecoder();
  async function event() {
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      while (true) {
        let end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const row = block.split("\n").find((l) => l.startsWith("data: "));
          if (row) return JSON.parse(row.slice(6));
          continue;
        }
        const next = await reader.read();
        assert.equal(next.done, false);
        buffer += decoder.decode(next.value);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  const initial = await event();
  const device = initial.devices.find((d) => d.id === reg.id);
  assert.equal(device.name, "Multiplex screen");
  await fetch(
    base + "/api/displays/command",
    post({
      ids: [reg.id],
      revisions: { [reg.id]: device.revision },
      action: "hide",
    }),
  );
  const update = await event();
  assert.equal(update.devices.find((d) => d.id === reg.id).hidden, true);
  controller.abort();
});

test("unpaired screen accepts its initial heartbeat and rejects impossible future revisions", async (t) => {
  const base = await serve(t);
  const reg = await (
    await fetch(
      base + "/api/displays/register",
      post({}, { "Content-Type": "application/json" }),
    )
  ).json();
  const headers = {
    "Content-Type": "application/json",
    "X-Display-Token": reg.token,
  };
  assert.equal(
    (
      await fetch(
        base + `/api/displays/${reg.id}/heartbeat`,
        post({ revision: -1 }, headers),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(
        base + `/api/displays/${reg.id}/heartbeat`,
        post({ revision: 30 }, headers),
      )
    ).status,
    400,
  );
});

test("one invalid multiplex identity cannot disconnect valid screens or expose data to unpaired clients", async (t) => {
  const base = await serve(t);
  const reg = await (
    await fetch(
      base + "/api/displays/register",
      post({}, { "Content-Type": "application/json" }),
    )
  ).json();
  const controller = new AbortController();
  const response = await fetch(base + "/api/displays/events", {
    ...post(
      { identities: [reg, { id: "missing", token: "invalid" }] },
      { "Content-Type": "application/json" },
    ),
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const chunk = new TextDecoder().decode((await reader.read()).value);
  const first = JSON.parse(
    chunk
      .split("\n")
      .find((l) => l.startsWith("data: "))
      .slice(6),
  );
  assert.equal(first.data, null);
  assert.equal(first.devices[0].id, reg.id);
  assert.match(first.devices[1].error, /身份已失效/);
  controller.abort();
});

test("raw NDJSON workspace upload uses the feed limit rather than the smaller JSON limit", async (t) => {
  const base = await serve(t);
  const feed =
    " ".repeat(17 * 1024 * 1024) +
    JSON.stringify({ type: "contests", data: { name: "Raw upload" } }) +
    "\n" +
    JSON.stringify({
      type: "teams",
      data: { id: "upload-team", name: "Upload team" },
    });
  const response = await fetch(
    base + "/api/workspaces?name=" + encodeURIComponent("大文件验收"),
    {
      method: "POST",
      headers: {
        "X-Resolver-Admin": "platform-test-key",
        "Content-Type": "application/x-ndjson",
      },
      body: feed,
    },
  );
  assert.equal(response.status, 201);
  const w = await response.json();
  assert.equal(w.name, "大文件验收");
  assert.equal(w.contest.teams[0].id, "upload-team");
});
