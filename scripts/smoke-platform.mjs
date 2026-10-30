import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const base = (process.argv[2] || "http://127.0.0.1:4173").replace(/\/$/, "");
const saved =
  process.env.PLATFORM_SMOKE_STATE || "/tmp/icpc-platform-smoke.json";
const headers = {
  "Content-Type": "application/json",
  "X-Resolver-Admin": process.env.RESOLVER_ADMIN_KEY || "",
};
async function request(route, body, method, extra = {}) {
  const r = await fetch(base + "/api" + route, {
    headers: { ...headers, ...extra },
    method: method || (body ? "POST" : "GET"),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const v = await r.json();
  assert.equal(r.ok, true, JSON.stringify(v));
  return v;
}
if (process.argv[3] === "verify-restart") {
  const v = JSON.parse(await readFile(saved));
  const state = await request("/platform");
  assert.equal(state.activeWorkspaceId, v.workspaceId);
  const display = state.displays.find((d) => d.id === v.id);
  assert.equal(display.name, "Smoke screen");
  assert.equal(display.hidden, true);
  const device = await request(
    `/displays/${v.id}/state`,
    undefined,
    undefined,
    { "X-Display-Token": v.token },
  );
  assert.equal(device.paired, true);
  assert.equal(device.program.items[0].text, "Smoke message");
  assert.equal(state.broadcast.program.title, "Smoke program");
  console.log("Platform restart state and display identity verified");
} else {
  const w = await request("/workspaces", {
    name: "Platform smoke",
    feed: await readFile(
      new URL("../examples/02-finals-18-teams.ndjson", import.meta.url),
      "utf8",
    ),
  });
  assert.equal(w.contest.teams.length, 18);
  const identity = await request("/displays/register", {});
  const paired = await request("/displays/pair", {
    code: identity.code,
    name: "Smoke screen",
  });
  const program = await request("/displays/command", {
    ids: [identity.id],
    revisions: { [identity.id]: paired.revision },
    action: "apply",
    program: {
      items: [{ type: "message", text: "Smoke message", duration: 15 }],
    },
  });
  await request("/displays/command", {
    ids: [identity.id],
    revisions: { [identity.id]: program[0].revision },
    action: "hide",
  });
  let state = await request("/platform");
  const preview = await request(
    "/broadcast/preview",
    { revision: state.broadcast.revision, scene: { title: "Smoke program" } },
    "PUT",
  );
  assert.notEqual(
    (
      await request("/broadcast/output", undefined, undefined, {
        "X-Output-Token": state.broadcast.token,
      })
    ).broadcast.program.title,
    "Smoke program",
  );
  await request("/broadcast/take", { revision: preview.revision });
  assert.equal(
    (
      await request("/broadcast/output", undefined, undefined, {
        "X-Output-Token": state.broadcast.token,
      })
    ).broadcast.program.title,
    "Smoke program",
  );
  await writeFile(saved, JSON.stringify({ ...identity, workspaceId: w.id }), {
    mode: 0o600,
  });
  console.log(
    "Platform workspace, preview/program separation, pairing and playlist verified",
  );
}
