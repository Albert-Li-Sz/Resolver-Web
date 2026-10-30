import type { AnyRecord } from "./types";
// Convert only the server's public view. Never derive an overlay from raw judgements.
export function liveSnapshot(state: AnyRecord | null) {
  const data = state?.data || {},
    contest = data.contest || {},
    clock = data.clock || {};
  const problems = (contest.problems || []).map((p: any, i: number) => ({
    ...p,
    letter: p.label || String(i + 1),
    ordinal: i,
    isHidden: false,
    color: p.color || "#4C83C3",
    minScore: null,
    maxScore: null,
  }));
  const teams = (contest.teams || []).map((t: any) => ({
    ...t,
    shortName: t.displayName || t.name,
    groups: t.groupIds || [],
    isHidden: false,
    isOutOfContest: !!t.unrank,
    medias: {},
    customFields: {},
  }));
  const start =
    typeof clock.startTime === "number"
      ? clock.startTime
      : Date.parse(clock.startTime || contest.startTime);
  const ended = Date.parse(clock.ended);
  const status = Number.isFinite(start)
    ? {
        type: Number.isFinite(ended) ? "over" : "running",
        startedAtUnixMs: start,
        finishAtUnixMs: Number.isFinite(ended) ? ended : undefined,
      }
    : {
        type: "before",
        holdTimeMs: clock.countdownPauseTime ?? null,
        scheduledStartAtUnixMs: null,
      };
  const info = {
    ...contest,
    status,
    contestLengthMs: contest.durationMs || 18000000,
    resultType: contest.scoringMode === "score" ? "IOI" : "ICPC",
    penaltyRoundingMode: "each_submission_down_to_minute",
    emulationSpeed: clock.multiplier || 1,
    problems,
    teams,
    teamsId: Object.fromEntries(teams.map((t: any) => [t.id, t])),
    problemsId: Object.fromEntries(problems.map((p: any) => [p.id, p])),
  };
  const standings = data.standings || [];
  const ids = Object.fromEntries(
    standings.map((row: any) => [
      row.teamId,
      {
        totalScore: row.solved,
        penalty: row.time * 60,
        lastAcceptedMs: row.lastSolutionTime * 60000,
        problemResults: (data.results?.[row.teamId] || []).map((r: any) => ({
          type: "ICPC",
          wrongAttempts: r.penaltyCount || 0,
          pendingAttempts: r.pending || 0,
          isSolved: r.status === "solved",
          isFirstToSolve: !!r.firstToSolve,
          lastSubmitTimeMs: r.attempts ? r.time * 60000 : undefined,
        })),
      },
    ]),
  );
  const board = {
    ids,
    idAwards: {},
    order: standings.map((r: any) => r.teamId),
    ranks: standings.map((r: any) => r.rank || 0),
    orderById: Object.fromEntries(
      standings.map((r: any, i: number) => [r.teamId, i]),
    ),
    rankById: Object.fromEntries(
      standings.map((r: any) => [r.teamId, r.rank || 0]),
    ),
    awards: [],
  };
  const firsts = new Set((data.firstSolves || []).map((s: any) => s.id));
  const toQueue = (s: any) => ({
    id: s.id,
    teamId: s.teamId,
    problemId: s.problemId,
    featuredRunMedia: [],
    reactionVideos: [],
    result:
      s.status === "pending"
        ? { type: "IN_PROGRESS", testedPart: 0, isAfterFirstOk: false }
        : {
            type: "ICPC",
            verdict: {
              shortName: s.status === "solved" ? "AC" : "WA",
              isAccepted: s.status === "solved",
              isAddingPenalty: s.penalty !== false,
            },
            isFirstToSolveRun: firsts.has(s.id),
            isAfterFirstOk: false,
          },
  });
  const queue = (contest.submissions || []).slice(-20).reverse().map(toQueue),
    firstSolves = (data.firstSolves || []).slice(-20).reverse().map(toQueue);
  return {
    firstSolves,
    contestInfo: { info },
    scoreboard: { normal: board, optimistic: board, pessimistic: board },
    queue: { queue, totalQueueItems: queue.length },
  };
}
