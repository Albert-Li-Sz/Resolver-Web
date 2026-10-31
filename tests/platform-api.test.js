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
    "/contest/",
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

test("workspace creation and source editing do not implicitly replace the live contest", async (t) => {
  const base = await serve(t);
  const before = platform.store.state.activeWorkspaceId;
  const r = await fetch(
    base + "/api/workspaces",
    post({ name: "Explicit switching" }),
  );
  const w = await r.json();
  assert.equal(r.status, 201);
  assert.equal(platform.store.state.activeWorkspaceId, before);
  const detail = await fetch(base + `/api/workspaces/${w.id}`, {
    headers: manage,
  });
  assert.equal(detail.status, 200);
  const activate = await fetch(
    base + `/api/workspaces/${w.id}/activate`,
    post({ currentWorkspaceId: before }),
  );
  assert.equal(activate.status, 200);
  assert.equal(platform.store.state.activeWorkspaceId, w.id);
  const stale = await fetch(
    base + `/api/workspaces/${w.id}/activate`,
    post({ currentWorkspaceId: "stale" }),
  );
  assert.equal(stale.status, 409);
});
test("saved plans and scene presets update in place with revision conflicts", async (t) => {
  const base = await serve(t);
  for (const [route, body] of [
    [
      "/presentations/plans",
      { name: "Plan", items: [{ type: "clock", duration: 15 }] },
    ],
    ["/broadcast/presets", { name: "Preset", scene: { layout: "dual" } }],
  ]) {
    const created = await (
      await fetch(base + "/api" + route, post(body))
    ).json();
    const updated = await fetch(base + "/api" + route + "/" + created.id, {
      method: "PUT",
      headers: manage,
      body: JSON.stringify({ ...body, name: "Updated", revision: 0 }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).id, created.id);
    const stale = await fetch(base + "/api" + route + "/" + created.id, {
      method: "PUT",
      headers: manage,
      body: JSON.stringify({ ...body, revision: 0 }),
    });
    assert.equal(stale.status, 409);
  }
});
test("screen identities can update only their own persistent output profile", async (t) => {
  const base = await serve(t);
  const d = await (
    await fetch(base + "/api/displays/register", post({}))
  ).json();
  const paired = await (
    await fetch(
      base + "/api/displays/pair",
      post({ code: d.code, name: "Profile screen" }),
    )
  ).json();
  const request = {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Display-Token": d.token },
    body: JSON.stringify({
      revision: paired.revision,
      outputProfile: {
        resolution: "2160p",
        aspect: "32:9",
        margin: 4,
        region: "right",
      },
    }),
  };
  const r = await fetch(base + `/api/displays/${d.id}/settings`, request);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).outputProfile.margin, 4);
  assert.equal(
    (await fetch(base + `/api/displays/${d.id}/settings`, request)).status,
    409,
  );
  assert.equal(
    (await fetch(base + `/api/displays/${"a".repeat(32)}/settings`, request))
      .status,
    403,
  );
});
test("OBS output profiles are independent, public and do not commit the preview", async (t) => {
  const base = await serve(t);
  const before = structuredClone(platform.store.state.broadcast);
  const r = await fetch(base + "/api/broadcast/output-settings", {
    method: "PUT",
    headers: manage,
    body: JSON.stringify({
      revision: before.outputRevision || 0,
      type: "program",
      outputProfile: { resolution: "2160p", aspect: "21:9" },
    }),
  });
  assert.equal(r.status, 200);
  assert.equal(platform.store.state.broadcast.revision, before.revision);
  assert.deepEqual(platform.store.state.broadcast.program, before.program);
  const output = await (
    await fetch(base + "/api/broadcast/output", {
      headers: { "X-Output-Token": before.token },
    })
  ).json();
  assert.equal(output.broadcast.outputProfiles.program.resolution, "2160p");
  assert.equal(output.broadcast.outputProfiles.overlay, undefined);
});
test("CCS archives require administrator access and reject invalid paths", async (t) => {
  const base = await serve(t);
  const route =
    "/api/workspaces/" + "a".repeat(32) + "/resolver-exports/" + "b".repeat(32);
  assert.equal((await fetch(base + route)).status, 401);
  assert.equal((await fetch(base + route + "/feed")).status, 401);
  assert.equal(
    (await fetch(base + route + "/feed", { headers: manage })).status,
    404,
  );
});

test("team-bound presets and playlists are workspace-scoped and reject stale workspace saves", async (t) => {
  const base = await serve(t);
  const make = async (name) =>
    await (await fetch(base + "/api/workspaces", post({ name }))).json();
  const a = await make("Scoped A");
  await fetch(base + `/api/workspaces/${a.id}/activate`, post({}));
  const preset = await (
    await fetch(
      base + "/api/broadcast/presets",
      post({
        name: "Bound preset",
        workspaceId: a.id,
        scene: { teamIds: ["same-id"] },
      }),
    )
  ).json();
  assert.equal(preset.workspaceId, a.id);
  const plan = await (
    await fetch(
      base + "/api/presentations/plans",
      post({
        name: "Bound plan",
        workspaceId: a.id,
        items: [{ type: "team", teamId: "same-id", duration: 10 }],
      }),
    )
  ).json();
  assert.equal(plan.workspaceId, a.id);
  const b = await make("Scoped B");
  await fetch(base + `/api/workspaces/${b.id}/activate`, post({}));
  for (const [route, body] of [
    ["/broadcast/presets", { scene: { teamIds: ["same-id"] } }],
    [
      "/presentations/plans",
      { items: [{ type: "team", teamId: "same-id", duration: 10 }] },
    ],
  ]) {
    const stale = await fetch(
      base + "/api" + route,
      post({ name: "Stale save", workspaceId: a.id, ...body }),
    );
    assert.equal(stale.status, 409);
  }
  const generic = await (
    await fetch(
      base + "/api/presentations/plans",
      post({
        name: "Clock",
        workspaceId: b.id,
        items: [{ type: "clock", duration: 10 }],
      }),
    )
  ).json();
  assert.equal(generic.workspaceId, "");
});
