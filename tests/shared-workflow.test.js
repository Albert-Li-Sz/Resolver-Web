import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, PassThrough } from "node:stream";
import { PlatformStore, validateSource } from "../server/platform/store.js";
import { FeedManager } from "../server/platform/feed.js";
import { ResolverExports } from "../server/platform/resolver-export.js";
import { outputProfile } from "../public/js/output-profile.js";
import { publicContest, normalizeEvent } from "../server/platform/model.js";
const source = {
  url: "https://ccs.example/api/",
  mode: "feed",
  contestId: "finals",
  username: "admin",
  password: "secret",
  auth: "basic",
};
const contest = {
  name: "A",
  durationMs: 18000000,
  freezeDurationMs: 3600000,
  teams: [{ id: "t", name: "Team" }],
  problems: [{ id: "p", label: "A" }],
  submissions: [],
};
async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "resolver-shared-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const s = new PlatformStore({ directory });
  await s.restore();
  return s;
}
async function jobDone(exports, j) {
  for (let n = 0; n < 500; n++) {
    const v = exports.status(j.id, j.workspaceId);
    if (v.state !== "running") return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail("export did not finish");
}
const events = [
  {
    type: "contests",
    id: "c",
    data: {
      id: "c",
      name: "Finals",
      duration: "5:00:00",
      scoreboard_freeze_duration: "1:00:00",
    },
  },
  { type: "teams", id: "t", data: { id: "t", name: "Team" } },
  { type: "problems", id: "p", data: { id: "p", label: "A" } },
  {
    type: "judgement-types",
    id: "AC",
    data: { id: "AC", solved: true, penalty: false },
  },
  {
    type: "submissions",
    id: "s",
    data: { id: "s", team_id: "t", problem_id: "p", contest_time: "4:30:00" },
  },
  {
    type: "judgements",
    id: "j",
    data: { id: "j", submission_id: "s", judgement_type_id: "AC" },
  },
  {
    type: "state",
    id: "state",
    data: {
      ended: "2026-10-30T05:00:00Z",
      end_of_updates: "2026-10-30T05:05:00Z",
    },
  },
];
const ndjson = (xs) => xs.map(JSON.stringify).join("\n") + "\n";
test("creating and editing workspaces never switches the current contest", async (t) => {
  const s = await setup(t);
  const a = await s.createWorkspace({ contest });
  assert.equal(s.state.activeWorkspaceId, null);
  await s.activate(a.id);
  const b = await s.createWorkspace({ contest: { ...contest, name: "B" } });
  assert.equal(s.state.activeWorkspaceId, a.id);
  await s.updateWorkspace(b.id, { configRevision: 0, name: "B edited" });
  assert.equal(s.state.activeWorkspaceId, a.id);
  await assert.rejects(s.activate(b.id, undefined, "wrong"), { status: 409 });
  assert.equal(s.state.activeWorkspaceId, a.id);
});
test("explicit switching clears cross-contest references while retaining layouts and programs", async (t) => {
  const s = await setup(t);
  const a = await s.createWorkspace({ contest });
  await s.activate(a.id);
  s.state.broadcast.program = {
    ...s.state.broadcast.program,
    layout: "quad",
    teamIds: ["t"],
    mediaIds: ["m"],
    audioMediaId: "a",
    title: "Old contest",
  };
  const d = await s.register();
  await s.pair({ code: d.code, name: "Screen" });
  await s.command({
    ids: [d.id],
    revisions: { [d.id]: 1 },
    action: "apply",
    program: { items: [{ type: "team", teamId: "t", duration: 12 }] },
  });
  const b = await s.createWorkspace({ contest });
  await s.activate(b.id);
  assert.equal(s.state.broadcast.program.layout, "quad");
  assert.deepEqual(s.state.broadcast.program.teamIds, []);
  assert.equal(s.state.broadcast.program.audioMediaId, "");
  assert.equal(s.state.displays[0].program.items[0].type, "team");
  assert.equal(s.state.displays[0].program.items[0].teamId, "");
});
test("real-time events do not invalidate a configuration draft, competing configuration writes do", async (t) => {
  const s = await setup(t);
  const w = await s.createWorkspace({ contest });
  await s.ingest(w.id, [
    {
      type: "teams",
      id: "other",
      token: "1",
      data: { id: "other", name: "Other" },
    },
  ]);
  await s.updateWorkspace(w.id, { configRevision: 0, source });
  assert.equal(s.workspace(w.id).configRevision, 1);
  await assert.rejects(
    s.updateWorkspace(w.id, { configRevision: 0, name: "stale" }),
    { status: 409 },
  );
});
test("replacing an active CCS source resets public unlock and transient contest references", async (t) => {
  const s = await setup(t);
  const w = await s.createWorkspace({ contest });
  await s.updateWorkspace(w.id, { configRevision: 0, source });
  await s.activate(w.id);
  await s.ingest(w.id, events);
  await s.updateWorkspace(w.id, { configRevision: 1, unlocked: true });
  const before = s.publicState().contextId;
  assert.equal(s.publicState().data.contest.submissions.length, 1);
  s.state.broadcast.program.teamIds = ["t"];
  s.state.broadcast.program.mediaIds = ["old-camera"];
  s.state.broadcast.program.ticker = "Old notice";
  s.state.broadcast.program.layout = "quad";
  const replacement = { ...source, contestId: "next-finals" };
  await assert.rejects(
    s.updateWorkspace(w.id, {
      configRevision: 2,
      source: replacement,
      unlocked: true,
    }),
    { status: 400 },
  );
  assert.equal(s.publicState().contextId, before);
  await s.updateWorkspace(w.id, { configRevision: 2, source: replacement });
  assert.notEqual(s.publicState().contextId, before);
  assert.equal(s.workspace(w.id).unlocked, false);
  assert.equal(s.workspace(w.id).cursor, null);
  assert.deepEqual(s.state.broadcast.program.teamIds, []);
  assert.deepEqual(s.state.broadcast.program.mediaIds, []);
  assert.equal(s.state.broadcast.program.ticker, "");
  assert.equal(s.state.broadcast.program.layout, "quad");
  await s.ingest(w.id, events);
  assert.equal(s.publicState().data.contest.submissions[0].status, "pending");
  assert.deepEqual(s.publicState().data.firstSolves, []);
  const restored = new PlatformStore({ directory: s.directory });
  await restored.restore();
  assert.equal(restored.publicState().contextId, s.publicState().contextId);
  assert.equal(restored.workspace(w.id).unlocked, false);
});
test("credential changes and reconnects keep contest context and on-air references", async (t) => {
  const s = await setup(t);
  const w = await s.createWorkspace({ contest });
  await s.updateWorkspace(w.id, { configRevision: 0, source });
  await s.activate(w.id);
  await s.ingest(w.id, events);
  s.state.broadcast.program.teamIds = ["t"];
  await s.updateWorkspace(w.id, { configRevision: 1, unlocked: true });
  const context = s.publicState().contextId;
  for (const [index, patch] of [
    { password: "rotated" },
    { enabled: false },
    { enabled: true },
  ].entries()) {
    await s.updateWorkspace(w.id, {
      configRevision: index + 2,
      source: { ...s.workspace(w.id).source, ...patch },
    });
    assert.equal(s.publicState().contextId, context);
    assert.equal(s.workspace(w.id).unlocked, true);
    assert.equal(s.workspace(w.id).events.length, events.length);
    assert.deepEqual(s.state.broadcast.program.teamIds, ["t"]);
  }
});
test("editing an inactive source does not change the active contest output", async (t) => {
  const s = await setup(t);
  const a = await s.createWorkspace({ contest });
  const b = await s.createWorkspace({ contest });
  await s.activate(a.id);
  s.state.broadcast.program.teamIds = ["t"];
  const context = s.publicState().contextId;
  const revision = s.state.broadcast.revision;
  await s.updateWorkspace(b.id, { configRevision: 0, source });
  assert.equal(s.publicState().contextId, context);
  assert.equal(s.state.broadcast.revision, revision);
  assert.deepEqual(s.state.broadcast.program.teamIds, ["t"]);
});
test("one feed is shared across subscribers; pause preserves credentials and resume cursor", async (t) => {
  const s = await setup(t);
  const w = await s.createWorkspace({ contest });
  await s.updateWorkspace(w.id, { configRevision: 0, source });
  let opens = 0,
    closes = 0;
  const cursors = [];
  const feeds = new FeedManager(s, {
    open: async (_, { signal, cursor }) => {
      opens++;
      cursors.push(cursor);
      const r = new PassThrough();
      r.setEncoding("utf8");
      signal.addEventListener(
        "abort",
        () => {
          closes++;
          r.destroy();
        },
        { once: true },
      );
      return r;
    },
  });
  t.after(() => feeds.close());
  await s.activate(w.id);
  s.subscribe(() => {});
  s.subscribe(() => {});
  s.emit();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(opens, 1);
  await s.updateWorkspace(w.id, {
    configRevision: 1,
    source: { ...source, enabled: false },
  });
  assert.equal(closes, 1);
  assert.equal(s.workspace(w.id).source.password, "secret");
  s.workspace(w.id).cursor = "resume-token";
  await s.updateWorkspace(w.id, {
    configRevision: 2,
    source: { ...source, enabled: true },
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(opens, 2);
  assert.equal(cursors.at(-1), "resume-token");
});
test("authentication selection removes credentials from other modes and supports legacy sources", () => {
  assert.equal(validateSource(source).password, "secret");
  assert.equal(
    validateSource({ ...source, auth: "none", bearer: "old" }).bearer,
    "",
  );
  assert.equal(
    validateSource({ ...source, auth: "bearer", bearer: "token" }).password,
    "",
  );
  assert.throws(() => validateSource({ ...source, auth: "invalid" }));
  assert.equal(validateSource({ ...source, auth: undefined }).auth, "basic");
});
test("output profiles migrate numeric resolutions and square screens without changing other screens", async (t) => {
  assert.equal(outputProfile({ resolution: 2160, ratio: 1 }).aspect, "1:1");
  assert.equal(outputProfile({ resolution: 2160 }).resolution, "2160p");
  const s = await setup(t);
  const a = await s.register(),
    b = await s.register();
  await s.pair({ code: a.code, name: "A" });
  await s.pair({ code: b.code, name: "B" });
  await s.command({
    ids: [a.id],
    revisions: { [a.id]: 1 },
    action: "configure",
    outputProfile: {
      resolution: "2160p",
      aspect: "32:9",
      margin: 5,
      region: "left",
    },
  });
  assert.equal(
    s.deviceState(s.device(a.id, a.token)).outputProfile.aspect,
    "32:9",
  );
  assert.equal(s.deviceState(s.device(b.id, b.token)).outputProfile, undefined);
  const restored = new PlatformStore({ directory: s.directory });
  await restored.restore();
  assert.equal(restored.state.displays[0].outputProfile.margin, 5);
});
test("school and team asset overrides are copied into isolated snapshots", async (t) => {
  const s = await setup(t);
  const w = await s.createWorkspace({
    contest: {
      ...contest,
      organizations: [{ id: "o", name: "School" }],
      teams: [{ id: "t", name: "Team", organizationId: "o" }],
    },
  });
  await s.updateWorkspace(w.id, {
    configRevision: 0,
    assets: {
      organizationId: "o",
      organizationLogo: "https://assets.example/school.png",
    },
  });
  await s.updateWorkspace(w.id, {
    configRevision: 1,
    assets: { teamId: "t", logo: "https://assets.example/team.png" },
  });
  const snapshot = s.workspaceContest(s.workspace(w.id));
  assert.equal(snapshot.organizations[0].logoOverride, true);
  assert.equal(snapshot.teams[0].logoOverride, true);
  const projected = publicContest(snapshot);
  assert.equal(
    projected.contest.teams[0].logo,
    "https://assets.example/team.png",
  );
  await s.updateWorkspace(w.id, {
    configRevision: 2,
    assets: { teamId: "t", logo: "" },
  });
  assert.equal(
    publicContest(s.workspaceContest(s.workspace(w.id))).contest.teams[0].logo,
    "https://assets.example/school.png",
  );
  snapshot.teams[0].logo = "local";
  assert.notEqual(s.workspaceContest(s.workspace(w.id)).teams[0].logo, "local");
});
test("CCS export finishes at end_of_updates while the upstream socket remains open", async (t) => {
  const s = await setup(t);
  const w = await s.createWorkspace({ contest });
  await s.updateWorkspace(w.id, { configRevision: 0, source });
  await s.activate(w.id);
  let ended = false;
  const exports = new ResolverExports(s, {
    open: async () => {
      const r = new PassThrough();
      r.setEncoding("utf8");
      r.on("close", () => (ended = true));
      r.write(ndjson(events));
      return r;
    },
  });
  t.after(() => exports.close());
  const j = exports.start(w.id);
  const result = await jobDone(exports, j);
  assert.equal(result.state, "complete", result.error);
  assert.equal(result.contest.submissions[0].status, "solved");
  assert.equal(result.contest.freezeDurationMs, 3600000);
  assert.equal(s.workspace(w.id).unlocked, false);
  assert.equal(s.publicState().data.contest.submissions.length, 0);
  const { file } = await exports.archive(w.id, result.archiveId);
  assert.match(await readFile(file, "utf8"), /judgements/);
  assert.equal(ended, true);
});
test("EOF alone does not make a partial or public feed suitable for rolling", async (t) => {
  for (const data of [
    events.slice(0, -1),
    events.filter((e) => e.type !== "judgements"),
  ]) {
    const s = await setup(t);
    const w = await s.createWorkspace({ contest });
    await s.updateWorkspace(w.id, { configRevision: 0, source });
    const exports = new ResolverExports(s, {
      open: async () => Readable.from([ndjson(data)]),
    });
    const r = await jobDone(exports, exports.start(w.id));
    assert.equal(r.state, "error");
    assert.equal(s.workspace(w.id).contest.name, "A");
  }
});
test("export retains rejudging and modern null-data deletion semantics", async (t) => {
  const s = await setup(t);
  const w = await s.createWorkspace({ contest });
  await s.updateWorkspace(w.id, { configRevision: 0, source });
  const data = [
    ...events.slice(0, -1),
    { type: "judgements", id: "j", data: null },
    {
      type: "judgements",
      id: "j2",
      data: { id: "j2", submission_id: "s", judgement_type_id: "AC" },
    },
    events.at(-1),
  ];
  const exports = new ResolverExports(s, {
    open: async () => Readable.from([ndjson(data)]),
  });
  const r = await jobDone(exports, exports.start(w.id));
  assert.equal(r.state, "complete", r.error);
  assert.equal(r.contest.submissions.length, 1);
  assert.equal(r.contest.submissions[0].status, "solved");
  assert.equal(normalizeEvent(data.at(-3)).op, "delete");
  assert.equal(
    publicContest(r.contest).contest.submissions[0].status,
    "pending",
  );
});
test("cancelled exports preserve current data and incomplete archives cannot be downloaded", async (t) => {
  const s = await setup(t);
  const w = await s.createWorkspace({ contest });
  await s.updateWorkspace(w.id, { configRevision: 0, source });
  const exports = new ResolverExports(s, {
    open: async (_, { signal }) => {
      const r = new PassThrough();
      signal.addEventListener("abort", () => r.destroy(), { once: true });
      return r;
    },
  });
  t.after(() => exports.close());
  const j = exports.start(w.id);
  await new Promise((r) => setTimeout(r, 10));
  exports.cancel(j.id, w.id);
  assert.equal(exports.status(j.id, w.id).state, "cancelled");
  await assert.rejects(exports.archive(w.id, j.id), { status: 404 });
  assert.equal(s.workspace(w.id).contest.name, "A");
});
test("completed export archives survive application restart and remain workspace-bound", async (t) => {
  const s = await setup(t);
  const w = await s.createWorkspace({ contest });
  await s.updateWorkspace(w.id, { configRevision: 0, source });
  const a = new ResolverExports(s, {
    open: async () => Readable.from([ndjson(events)]),
  });
  const result = await jobDone(a, a.start(w.id));
  assert.equal(result.state, "complete", result.error);
  const b = new ResolverExports(s);
  assert.equal(
    (await b.archive(w.id, result.archiveId)).meta.contest.name,
    "Finals",
  );
  await assert.rejects(b.archive("another-workspace", result.archiveId), {
    status: 404,
  });
  await assert.rejects(b.archive(w.id, "../../state"), { status: 404 });
});

test("finite CCS API snapshot works before thaw/end_of_updates and rejects an active rejudge", async () => {
  const { ccsSnapshot } = await import("../server/platform/ccs-snapshot.js");
  const data = {
    "": events[0].data,
    state: {
      ended: "2026-10-30T05:00:00Z",
      finalized: "2026-10-30T05:05:00Z",
      thawed: null,
      end_of_updates: null,
    },
    teams: [events[1].data],
    organizations: [],
    problems: [events[2].data],
    "judgement-types": [events[3].data],
    submissions: [events[4].data],
    judgements: [events[5].data],
    groups: [],
    awards: [],
  };
  const result = await ccsSnapshot(
    { ...source, mode: "api" },
    { read: async (_, type) => structuredClone(data[type]) },
  );
  assert.equal(result.find((e) => e.type === "state").data.thawed, null);
  assert.equal(result.filter((e) => e.type === "judgements").length, 1);
  let requests = 0;
  await assert.rejects(
    ccsSnapshot(
      { ...source, mode: "api" },
      {
        read: async (_, type) =>
          type === "judgements" && ++requests === 2
            ? []
            : structuredClone(data[type]),
      },
    ),
    { status: 409 },
  );
});
test("connection probe rejects HTTP success pages that are not NDJSON", async () => {
  const { probeFeed } = await import("../server/platform/feed.js");
  await assert.rejects(
    probeFeed(source, {
      open: async () => Readable.from(["<html>login</html>\n"]),
    }),
    /NDJSON/,
  );
  assert.equal(
    (
      await probeFeed(source, {
        open: async () =>
          Readable.from(["\nnull\n", JSON.stringify(events[0]) + "\n"]),
      })
    ).ok,
    true,
  );
});

test("legacy bound scene presets and playlists migrate without losing their content", async (t) => {
  const s = await setup(t);
  const w = await s.createWorkspace({ contest });
  await s.activate(w.id);
  await s.change(() => {
    s.state.broadcast.presets = [
      {
        id: "legacy",
        name: "Layout",
        scene: { layout: "dual", teamIds: ["t"] },
      },
    ];
    s.state.plans = [
      {
        id: "legacy-plan",
        name: "Team",
        items: [{ type: "team", teamId: "t", duration: 15 }],
      },
    ];
  });
  const restored = new PlatformStore({ directory: s.directory });
  await restored.restore();
  assert.equal(restored.state.broadcast.presets[0].workspaceId, w.id);
  assert.equal(restored.state.broadcast.presets[0].scene.layout, "dual");
  assert.equal(restored.state.plans[0].workspaceId, w.id);
  assert.equal(restored.state.plans[0].items[0].teamId, "t");
});

test("CCS secrets retain significant whitespace and overlong URLs are rejected", () => {
  assert.equal(
    validateSource({ ...source, password: " secret " }).password,
    " secret ",
  );
  assert.throws(
    () =>
      validateSource({
        ...source,
        url: "https://ccs.example/" + "x".repeat(4096),
      }),
    { status: 400 },
  );
});
test("oversized playlists fail instead of silently dropping their final items", async () => {
  const { program } = await import("../server/platform/model.js");
  assert.throws(
    () =>
      program({
        items: Array.from({ length: 101 }, () => ({
          type: "clock",
          duration: 15,
        })),
      }),
    { status: 400 },
  );
  assert.throws(() => program({ items: [null] }), { status: 400 });
});

test("a revoked screen becomes visible again after successful re-pairing", async (t) => {
  const s = await setup(t);
  const d = await s.register();
  await s.pair({ code: d.code, name: "Stage" });
  await s.command({ ids: [d.id], revisions: { [d.id]: 1 }, action: "revoke" });
  const unpaired = s.deviceState(s.device(d.id, d.token));
  assert.equal(unpaired.paired, false);
  await s.pair({ code: unpaired.code, name: "Stage restored" });
  assert.equal(s.deviceState(s.device(d.id, d.token)).hidden, false);
});
