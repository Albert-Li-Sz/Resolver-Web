import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  presentationLayout,
  formatClock,
  scrollPage,
} from "../public/js/render/presentation-view.js";
import { digitalWidth } from "../public/js/render/digital-font.js";
import {
  JudgeQueueState,
  StandingsMotion,
} from "../public/js/render/presentation-state.js";
import {
  sceneMediaIds,
  sceneMediaSlots,
} from "../public/js/broadcast-media.js";
const reference = JSON.parse(
  await readFile(new URL("./fixtures/icpctools-layout.json", import.meta.url)),
);
test("presentation geometry matches the official Java renderer at HD, 2K, 4K, LED and portrait sizes", () => {
  for (const expected of reference.layouts) {
    const actual = presentationLayout(
      expected.width,
      expected.height,
      expected.problems,
    );
    assert.equal(actual.title, expected.titleHeight);
    assert.equal(actual.header, expected.headerHeight);
    assert.equal(actual.rowHeight, Math.fround(expected.rowHeight));
    assert.equal(actual.cubeWidth, expected.cubeWidth);
    assert.equal(actual.cubeHeight, expected.cubeHeight);
  }
});
test("official digital clock retains signs, rounding and the 48-hour range", () => {
  assert.equal(formatClock(-1001), "-0:00:02");
  assert.equal(formatClock(-1001, false), "-0:00:01");
  assert.equal(formatClock(3600000), "1:00:00");
  assert.equal(formatClock(49 * 3600000), "1:00:00");
  assert.equal(digitalWidth("-0:29:56", 432), 1845);
  assert.equal(scrollPage(3000), 0);
  assert.equal(scrollPage(15000), 0.5);
  assert.equal(scrollPage(15750), 1);
});
test("Judge Queue retains judgement results and animates them away at the official lifetimes", () => {
  const q = new JudgeQueueState(),
    data = {
      contest: {
        submissions: [
          { id: "one", teamId: "a", problemId: "p", status: "pending" },
        ],
      },
    };
  assert.equal(q.update(data, 1000).length, 1);
  data.contest.submissions = [
    { ...data.contest.submissions[0], status: "solved" },
  ];
  assert.equal(q.update(data, 2000)[0].submission.status, "solved");
  assert.equal(q.update(data, 12999).length, 1);
  for (let now = 13001; now < 19000; now += 100) q.update(data, now);
  assert.equal(q.records.length, 0);
  assert.equal(
    q.update(data, 20000).length,
    0,
    "repeated snapshots never replay old results",
  );
});
test("frozen public queue starts without replaying hidden activity", () => {
  const q = new JudgeQueueState();
  assert.equal(
    q.update(
      {
        frozen: true,
        contest: { submissions: [{ id: "hidden", status: "pending" }] },
      },
      1000,
    ).length,
    0,
  );
});
test("team camera and desktop bindings are scoped to their workspace, and quad never opens secondary video", () => {
  const media = [
    { id: "camera-a", teamId: "1", workspaceId: "a", role: "camera" },
    { id: "desktop-a", teamId: "1", workspaceId: "a", role: "desktop" },
    { id: "camera-b", teamId: "1", workspaceId: "b", role: "camera" },
  ];
  const scene = { layout: "single", teamIds: ["1"], mediaIds: [] };
  assert.deepEqual(sceneMediaSlots(scene, media, "a"), [
    { primary: "camera-a", secondary: "desktop-a" },
  ]);
  assert.deepEqual(sceneMediaIds(scene, media, "b"), ["camera-b"]);
  assert.deepEqual(
    sceneMediaIds(
      { ...scene, layout: "quad", teamIds: ["1", "1", "1", "1"] },
      media,
      "a",
    ),
    ["camera-a"],
  );
  assert.deepEqual(
    sceneMediaIds({ ...scene, audioMediaId: "camera-a" }, media, "a"),
    ["camera-a", "desktop-a"],
  );
  assert.deepEqual(
    sceneMediaSlots({ ...scene, mediaIds: ["desktop-a"] }, media, "a"),
    [{ primary: "desktop-a", secondary: "camera-a" }],
  );
});

test("live standings animate rank changes without jumping and discard deleted teams", () => {
  const motion = new StandingsMotion(),
    a = { teamId: "a" },
    b = { teamId: "b" };
  assert.equal(motion.update([a, b], 1000), false);
  assert.equal(motion.update([b, a], 1100), true);
  assert.ok(motion.position("a") > 0 && motion.position("a") < 1);
  assert.equal(motion.update([b, a], 5000), false);
  assert.equal(motion.position("a"), 1);
  motion.update([a], 6000);
  assert.equal(motion.rows.has("b"), false);
});
test("large queue snapshots do not replay historical results and deletion removes pending rows", () => {
  const queue = new JudgeQueueState(),
    data = {
      contest: {
        submissions: Array.from({ length: 2001 }, (_, i) => ({
          id: String(i),
          status: "solved",
        })),
      },
    };
  queue.update(data, 1000);
  assert.equal(queue.update(data, 2000).length, 0);
  data.contest.submissions.push({ id: "pending", status: "pending" });
  assert.equal(queue.update(data, 3000).length, 1);
  data.contest.submissions.pop();
  assert.equal(queue.update(data, 4000).length, 0);
});
