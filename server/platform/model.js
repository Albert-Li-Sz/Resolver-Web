import { createHash, randomBytes, randomInt } from "node:crypto";
import { inputError } from "../lib/limits.js";
import { normalizeContest, computeCells } from "../lib/engine.js";
export const clone = (x) => structuredClone(x);
export const id = () => randomBytes(16).toString("hex");
export const secret = () => randomBytes(32).toString("hex");
export const hash = (s) => createHash("sha256").update(String(s)).digest("hex");
export const code = () => String(randomInt(0, 100000000)).padStart(8, "0");
export const templates = [
  "scoreboard",
  "leaders",
  "clock",
  "countdown",
  "queue",
  "first-solves",
  "team",
  "logo",
  "photos",
  "message",
  "calibration",
  "resolver",
  "live",
];
export const sceneDefault = () => ({
  layout: "single",
  teamIds: [],
  mediaIds: [],
  title: "",
  ticker: "",
  image: "",
  volume: 0,
  widgets: {
    scoreboard: false,
    clock: true,
    queue: true,
    firstSolves: false,
    team: true,
    title: false,
    ticker: false,
    image: false,
  },
  positions: {},
});
export function text(value, max = 200) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}
export function scene(raw = {}) {
  const s = sceneDefault();
  s.layout = ["single", "dual", "quad"].includes(raw.layout)
    ? raw.layout
    : "single";
  s.teamIds = (Array.isArray(raw.teamIds) ? raw.teamIds : [])
    .slice(0, 4)
    .map((v) => text(v, 100));
  s.mediaIds = (Array.isArray(raw.mediaIds) ? raw.mediaIds : [])
    .slice(0, 4)
    .map((v) => text(v, 100));
  for (const k of ["title", "ticker", "image"])
    s[k] = text(raw[k], k === "image" ? 4096 : 1000);
  s.audioMediaId = text(raw.audioMediaId, 100);
  s.volume = Math.max(0, Math.min(1, Number(raw.volume) || 0));
  for (const k of Object.keys(s.widgets))
    if (typeof raw.widgets?.[k] === "boolean") s.widgets[k] = raw.widgets[k];
  for (const [k, p] of Object.entries(raw.positions || {}))
    if (
      Object.hasOwn(s.widgets, k) &&
      p &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y)
    )
      s.positions[k] = {
        x: Math.max(0, Math.min(90, p.x)),
        y: Math.max(0, Math.min(90, p.y)),
      };
  return s;
}
export function program(raw = {}) {
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .slice(0, 100)
    .map((item) => {
      if (!templates.includes(item.type)) throw inputError("未知展示模板");
      return {
        type: item.type,
        duration: Math.max(2, Math.min(3600, Number(item.duration) || 15)),
        text: text(item.text, 2000),
        teamId: text(item.teamId, 100),
        images: (Array.isArray(item.images) ? item.images : [])
          .slice(0, 100)
          .map((v) => text(v, 4096)),
        targetTime: Number(item.targetTime) || 0,
      };
    });
  if (!items.length) throw inputError("节目单至少需要一个节目");
  if (Buffer.byteLength(JSON.stringify(items)) > 256 * 1024)
    throw inputError("节目单超过 256 KB，请减少图片链接或节目数量", 413);
  return {
    items,
    loop: raw.loop !== false,
    transition: raw.transition === "fade" ? "fade" : "cut",
  };
}
export function publicContest(input, unlocked = false) {
  const c = normalizeContest(input);
  const cutoff = c.durationMs - c.freezeDurationMs;
  const frozen = c.freezeDurationMs > 0 && !unlocked;
  c.submissions = c.submissions.map((s) =>
    frozen && s.contestTime >= cutoff
      ? {
          id: s.id,
          teamId: s.teamId,
          problemId: s.problemId,
          contestTime: s.contestTime,
          status: "pending",
          penalty: false,
        }
      : s,
  );
  c.awards = [];
  const result = computeCells(c, { frozen });
  // Internal cell fields can contain exact judgement details; use an explicit public projection.
  const results = Object.fromEntries(
    Object.entries(result.results).map(([k, rows]) => [
      k,
      rows.map((r) => ({
        status: r.status,
        attempts: r.attempts,
        time: r.time,
        timeSeconds: r.timeSeconds,
        penaltyCount: r.penaltyCount ?? r._penaltyCount,
        pending: r.pending,
        firstToSolve: r.firstToSolve,
      })),
    ]),
  );
  const firstSolves = [];
  const solved = new Set();
  for (const submission of [...c.submissions].sort(
    (a, b) => a.contestTime - b.contestTime,
  )) {
    if (submission.status === "solved" && !solved.has(submission.problemId)) {
      solved.add(submission.problemId);
      firstSolves.push(submission);
    }
  }
  c.submissions = c.submissions.slice(-100);
  return {
    contest: c,
    results,
    standings: result.standings,
    firstSolves,
    frozen,
  };
}

export function sceneMediaIds(scene, media) {
  const count = scene.layout === "quad" ? 4 : scene.layout === "dual" ? 2 : 1;
  return Array.from(
    { length: count },
    (_, i) =>
      scene.mediaIds[i] ||
      media.find((m) => m.teamId === scene.teamIds[i] && m.role === "camera")
        ?.id,
  )
    .concat(scene.audioMediaId || [])
    .filter(Boolean);
}

// Newer Contest API feeds express deletion with data:null, older feeds use op:delete.
export const normalizeEvent = (event) =>
  event?.data === null ? { ...event, op: "delete" } : event;
export function clockMetadata(events = []) {
  let contest = {},
    state = {};
  for (const event of events) {
    if (["contest", "contests"].includes(event.type))
      contest = event.op === "delete" ? {} : { ...contest, ...event.data };
    if (["state", "states"].includes(event.type))
      state = event.op === "delete" ? {} : { ...state, ...event.data };
  }
  return {
    startTime: state.started || contest.start_time || contest.startTime || null,
    ended: state.ended || null,
    multiplier:
      Number.isFinite(Number(contest.time_multiplier)) &&
      Number(contest.time_multiplier) > 0
        ? Number(contest.time_multiplier)
        : 1,
    countdownPauseTime: contest.countdown_pause_time || null,
  };
}
