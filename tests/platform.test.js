import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, rename, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { PlatformStore } from "../server/platform/store.js";
import {
  publicContest,
  program,
  scene,
  clockMetadata,
} from "../server/platform/model.js";
import { FeedManager, checkedURL } from "../server/platform/feed.js";
async function storeFor(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "icpc-platform-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const s = new PlatformStore({ directory, ...options });
  await s.restore();
  return s;
}
const contest = {
  name: "Private finals",
  durationMs: 18000000,
  freezeDurationMs: 3600000,
  teams: [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ],
  problems: [{ id: "p", label: "A" }],
  submissions: [
    {
      id: "s1",
      teamId: "a",
      problemId: "p",
      contestTime: 1000,
      status: "solved",
      penalty: true,
    },
    {
      id: "s2",
      teamId: "b",
      problemId: "p",
      contestTime: 14500000,
      status: "solved",
      penalty: true,
    },
  ],
};
test("public contest removes frozen verdicts before computing standings and first-solve inputs", () => {
  const frozen = publicContest(contest);
  assert.equal(frozen.frozen, true);
  assert.equal(frozen.contest.submissions[1].status, "pending");
  assert.equal(frozen.standings.find((s) => s.teamId === "b").solved, 0);
  assert.equal(frozen.results.b[0].status, "pending");
  assert.doesNotMatch(
    JSON.stringify(frozen),
    /_solvedTimeMs|_lastSubmissionMs|"awards":\[\{/,
  );
  assert.equal(
    publicContest(contest, true).standings.find((s) => s.teamId === "b").solved,
    1,
  );
});
test("workspace snapshots, source secrets and broadcast preview stay independent across restarts", async (t) => {
  const s = await storeFor(t);
  const w = await s.createWorkspace({ contest });
  const snapshot = structuredClone(s.workspace(w.id).contest);
  await s.updateWorkspace(w.id, {
    revision: 0,
    source: {
      url: "http://192.168.1.3/api/",
      mode: "api",
      contestId: "1",
      username: "admin",
      password: "PRIVATE-PASS",
      bearer: "PRIVATE-TOKEN",
      allowPrivate: true,
    },
  });
  assert.equal(s.admin().activeWorkspace.source.hasPassword, true);
  assert.doesNotMatch(JSON.stringify(s.admin()), /PRIVATE-PASS|PRIVATE-TOKEN/);
  assert.doesNotMatch(
    JSON.stringify(s.publicState()),
    /source|password|bearer/,
  );
  await s.change(() => {
    s.state.broadcast.preview = scene({ title: "PREVIEW-ONLY" });
  });
  assert.notEqual(s.state.broadcast.program.title, "PREVIEW-ONLY");
  await s.updateWorkspace(w.id, {
    revision: 1,
    contest: { ...contest, name: "Updated" },
  });
  assert.equal(snapshot.name, "Private finals");
  const restored = new PlatformStore({ directory: s.directory });
  await restored.restore();
  assert.equal(restored.workspace().contest.name, "Updated");
  assert.equal(restored.workspace().source.password, "PRIVATE-PASS");
  assert.equal(restored.state.broadcast.preview.title, "PREVIEW-ONLY");
  await assert.rejects(
    s.updateWorkspace(w.id, { revision: 0, name: "Stale" }),
    (e) => e.status === 409,
  );
  assert.equal(s.workspace().name, "Private finals");
});
test("display pairing is expiring, single-use, durable and capability-scoped", async (t) => {
  let now = 1000000;
  const s = await storeFor(t, { now: () => now });
  const first = await s.register();
  assert.match(first.code, /^\d{8}$/);
  assert.throws(
    () => s.device(first.id, "bad"),
    (e) => e.status === 403,
  );
  const paired = await s.pair({ code: first.code, name: "Main stage" });
  assert.equal(paired.name, "Main stage");
  assert.equal(s.deviceState(s.device(first.id, first.token)).paired, true);
  await assert.rejects(s.pair({ code: first.code, name: "Steal" }));
  assert.doesNotMatch(JSON.stringify(s.admin()), new RegExp(first.token));
  const other = await s.register();
  now += 600001;
  await assert.rejects(s.pair({ code: other.code, name: "Expired" }));
  const restored = new PlatformStore({
    directory: s.directory,
    now: () => now,
  });
  await restored.restore();
  assert.equal(restored.device(first.id, first.token).name, "Main stage");
});
test("multi-display commands share exact start time and reject conflicting partial writes", async (t) => {
  let now = 1000000;
  const s = await storeFor(t, { now: () => now });
  const identities = await Promise.all([s.register(), s.register()]);
  for (const i of identities) await s.pair({ code: i.code, name: i.id });
  const ids = identities.map((d) => d.id);
  const revisions = Object.fromEntries(
    s.state.displays.map((d) => [d.id, d.revision]),
  );
  const plan = {
    items: [
      { type: "message", text: "Welcome", duration: 5 },
      { type: "clock", duration: 5 },
    ],
    transition: "fade",
  };
  await s.command({ ids, revisions, action: "apply", program: plan });
  const [a, b] = s.state.displays;
  assert.equal(a.startedAt, b.startedAt);
  assert.equal(a.startedAt, now + 750);
  assert.equal(a.effectiveAt, b.effectiveAt);
  await assert.rejects(
    s.command({
      ids,
      revisions: { [a.id]: a.revision, [b.id]: 0 },
      action: "hide",
    }),
    (e) => e.status === 409,
  );
  assert.ok(s.state.displays.every((d) => !d.hidden));
  const current = () =>
    Object.fromEntries(s.state.displays.map((d) => [d.id, d.revision]));
  now += 4000;
  await s.command({ ids, revisions: current(), action: "pause" });
  const offset = s.state.displays[0].offset;
  now += 5000;
  await s.command({ ids, revisions: current(), action: "resume" });
  assert.equal(s.state.displays[0].startedAt, now + 750 - offset);
  await s.command({ ids, revisions: current(), action: "next" });
  assert.equal(s.state.displays[0].offset, 5000);
  await s.command({ ids, revisions: current(), action: "revoke" });
  assert.ok(s.state.displays.every((d) => !d.paired));
});
test("incremental events handle duplicates, rejudging and deletions with persisted cursor", async (t) => {
  const s = await storeFor(t);
  const w = await s.createWorkspace({ name: "Feed" });
  const events = [
    {
      type: "contest",
      id: "c",
      token: "1",
      data: {
        id: "c",
        name: "Feed",
        duration: "5:00:00",
        scoreboard_freeze_duration: "1:00:00",
      },
    },
    { type: "teams", id: "a", token: "2", data: { id: "a", name: "A" } },
    { type: "problems", id: "p", token: "3", data: { id: "p", label: "A" } },
    {
      type: "judgement-types",
      id: "AC",
      token: "4",
      data: { id: "AC", solved: true, penalty: false },
    },
    {
      type: "submissions",
      id: "s",
      token: "5",
      data: { id: "s", team_id: "a", problem_id: "p", contest_time: "0:01:00" },
    },
    {
      type: "judgements",
      id: "j",
      token: "6",
      data: { id: "j", submission_id: "s", judgement_type_id: "AC" },
    },
  ];
  await s.ingest(w.id, events);
  assert.equal(s.workspace().contest.submissions[0].status, "solved");
  await s.ingest(w.id, events);
  assert.equal(s.workspace().events.length, 6);
  await s.ingest(w.id, [
    { type: "judgements", id: "j", token: "7", op: "delete", data: null },
  ]);
  assert.equal(s.workspace().contest.submissions[0].status, "pending");
  assert.equal(s.workspace().cursor, "7");
  const restored = new PlatformStore({ directory: s.directory });
  await restored.restore();
  assert.equal(restored.workspace().cursor, "7");
  assert.match(
    await readFile(path.join(s.directory, `${w.id}.ndjson`), "utf8"),
    /"token":"7"/,
  );
});
test("stream manager processes split lines and stops the previous source on workspace changes", async (t) => {
  const s = await storeFor(t);
  const w = await s.createWorkspace({ name: "Streaming" });
  await s.updateWorkspace(w.id, {
    revision: 0,
    source: { url: "http://example.com/events", mode: "feed" },
  });
  const manager = new FeedManager(s, {
    open: async () =>
      Readable.from([
        '{"type":"teams","token":"1","data":{"id":"a",',
        '"name":"Alpha"}}\n',
      ]),
  });
  manager.reconcile();
  t.after(() => manager.close());
  for (let i = 0; i < 100 && !s.workspace().contest.teams.length; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(s.workspace().contest.teams[0].name, "Alpha");
  await s.updateWorkspace(w.id, {
    revision: s.workspace().revision,
    source: null,
  });
  assert.equal(manager.status.state, "stopped");
});
test("remote inputs enforce explicit private LAN access and deny metadata/loopback even when enabled", async () => {
  for (const url of [
    "http://127.0.0.1/",
    "http://169.254.169.254/",
    "http://[::1]/",
    "http://224.0.0.1/",
  ])
    await assert.rejects(checkedURL(url, true));
  await assert.rejects(checkedURL("http://192.168.1.3/"));
  assert.equal(
    (await checkedURL("http://192.168.1.3/", true)).address.address,
    "192.168.1.3",
  );
  await assert.rejects(checkedURL("http://user:pass@192.168.1.3/", true));
});
test("playlist and scene validation rejects unknown templates and clamps output bounds", () => {
  assert.throws(() => program({ items: [{ type: "script" }] }));
  assert.throws(() => program({ items: [] }));
  assert.equal(
    program({ items: [{ type: "clock", duration: -5 }] }).items[0].duration,
    2,
  );
  assert.equal(
    scene({ layout: "unknown", volume: 500, mediaIds: Array(20).fill("id") })
      .mediaIds.length,
    4,
  );
  assert.equal(scene({ volume: -5 }).volume, 0);
});

test("changing a source rejects buffered events from the previous connection", async (t) => {
  const s = await storeFor(t);
  const w = await s.createWorkspace({ name: "Source race" });
  await s.updateWorkspace(w.id, {
    revision: 0,
    source: { url: "http://example.com/old", mode: "feed" },
  });
  const fingerprint = JSON.stringify(s.workspace().source);
  await s.updateWorkspace(w.id, {
    revision: 1,
    source: { url: "http://example.com/new", mode: "feed" },
  });
  await s.ingest(
    w.id,
    [{ type: "teams", token: "old-1", data: { id: "old", name: "Stale" } }],
    { sourceFingerprint: fingerprint },
  );
  assert.equal(s.workspace().contest.teams.length, 0);
});

test("failed platform commit keeps the previous complete workspace checkpoint across restart", async (t) => {
  const s = await storeFor(t);
  const w = await s.createWorkspace({ contest });
  const file = path.join(s.directory, "state.json");
  await rename(file, file + ".saved");
  await mkdir(file);
  await assert.rejects(
    s.updateWorkspace(w.id, {
      revision: 0,
      name: "Should roll back",
      contest: { ...contest, name: "Should roll back" },
    }),
  );
  assert.equal(s.workspace(w.id).name, "Private finals");
  assert.equal(s.workspace(w.id).revision, 0);
  await rm(file, { recursive: true });
  await rename(file + ".saved", file);
  const restored = new PlatformStore({ directory: s.directory });
  await restored.restore();
  assert.equal(restored.workspace(w.id).contest.name, "Private finals");
  assert.equal(restored.workspace(w.id).revision, 0);
});

test("modern null-data deletions remove records and contest clock metadata survives normalization", async (t) => {
  const s = await storeFor(t);
  const events = [
    {
      type: "contests",
      token: "1",
      data: {
        id: "c",
        name: "Clock",
        start_time: "2026-10-30T01:00:00Z",
        time_multiplier: 2,
      },
    },
    { type: "teams", token: "2", data: { id: "a", name: "A" } },
    { type: "teams", token: "3", data: { id: "b", name: "B" } },
    { type: "state", token: "4", data: { started: "2026-10-30T02:00:00Z" } },
  ];
  const w = await s.createWorkspace({
    feed: "null\n" + events.map((e) => JSON.stringify(e)).join("\n"),
  });
  await s.ingest(w.id, [{ type: "teams", id: "b", token: "5", data: null }]);
  assert.deepEqual(
    s.workspace().contest.teams.map((t) => t.id),
    ["a"],
  );
  assert.equal(s.publicState().data.clock.startTime, "2026-10-30T02:00:00Z");
  assert.equal(s.publicState().data.clock.multiplier, 2);
  assert.equal(clockMetadata([]).multiplier, 1);
});

test("workspace assets survive incoming events and enter isolated Resolver snapshots", async (t) => {
  const s = await storeFor(t);
  const w = await s.createWorkspace({
    feed:
      JSON.stringify({ type: "contests", data: { name: "Assets" } }) +
      "\n" +
      JSON.stringify({ type: "teams", data: { id: "a", name: "A" } }),
  });
  await s.updateWorkspace(w.id, {
    revision: 0,
    assets: {
      teamId: "a",
      logo: "/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
      photo:
        "/media/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
    },
  });
  const snapshot = s.workspaceContest(s.workspace());
  await s.ingest(w.id, [
    { type: "teams", token: "new-name", data: { id: "a", name: "New A" } },
  ]);
  assert.equal(
    s.publicState().data.contest.teams[0].photo,
    "/media/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
  );
  assert.equal(snapshot.teams[0].name, "A");
  assert.equal(
    s.workspaceAdmin(s.workspace()).contest.teams[0].logo,
    "/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
  );
});

test("repeated pause and resume preserve playback phase", async (t) => {
  let now = 10000;
  const s = await storeFor(t, { now: () => now });
  const r = await s.register();
  await s.pair({ code: r.code, name: "Idempotent" });
  const command = (action) =>
    s.command({
      ids: [r.id],
      revisions: { [r.id]: s.state.displays[0].revision },
      action,
    });
  now += 3000;
  await command("pause");
  const offset = s.state.displays[0].offset;
  now += 5000;
  await command("pause");
  assert.equal(s.state.displays[0].offset, offset);
  await command("resume");
  const start = s.state.displays[0].startedAt;
  now += 5000;
  await command("resume");
  assert.equal(s.state.displays[0].startedAt, start);
});

test("malformed event batches fail without changing the persisted cursor or revision", async (t) => {
  const s = await storeFor(t);
  const w = await s.createWorkspace({ contest });
  for (const events of [{}, [null], ["invalid"]])
    await assert.rejects(s.ingest(w.id, events), (e) => e.status === 400);
  assert.equal(s.workspace(w.id).revision, 0);
  assert.equal(s.workspace(w.id).cursor, null);
});
