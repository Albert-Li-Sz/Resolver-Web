export const MEDAL_DEFAULTS = Object.freeze({
  medalMode: 'imported', goldCount: 4, silverCount: 4, bronzeCount: 4,
  goldCitation: '金奖', silverCitation: '银奖', bronzeCitation: '铜奖', medalSameScore: true,
  podiumEnabled: false, championCitation: '冠军', runnerUpCitation: '亚军', thirdPlaceCitation: '季军',
  firstSolveMode: 'imported', firstSolveProblemIds: Object.freeze([]), firstSolveIncludeUnrank: false,
});

export function normalizeMedalOptions(raw = {}) {
  const options = { ...MEDAL_DEFAULTS, medalMode: raw.medalMode === 'custom' ? 'custom' : 'imported' };
  for (const tier of ['gold', 'silver', 'bronze']) {
    const count = raw[`${tier}Count`];
    if (count != null && count !== '' && Number.isFinite(Number(count))) options[`${tier}Count`] = Math.max(0, Math.min(10000, Math.trunc(Number(count))));
    if (typeof raw[`${tier}Citation`] === 'string') options[`${tier}Citation`] = raw[`${tier}Citation`].trim().slice(0, 80) || MEDAL_DEFAULTS[`${tier}Citation`];
  }
  if (typeof raw.medalSameScore === 'boolean') options.medalSameScore = raw.medalSameScore;
  if (typeof raw.podiumEnabled === 'boolean') options.podiumEnabled = raw.podiumEnabled;
  for (const field of ['championCitation', 'runnerUpCitation', 'thirdPlaceCitation']) {
    if (typeof raw[field] === 'string') options[field] = raw[field].trim().slice(0, 80) || MEDAL_DEFAULTS[field];
  }
  options.firstSolveMode = ['all', 'selected'].includes(raw.firstSolveMode) ? raw.firstSolveMode : 'imported';
  options.firstSolveProblemIds = Array.isArray(raw.firstSolveProblemIds) ? [...new Set(raw.firstSolveProblemIds
    .filter((id) => typeof id === 'string' && id.trim() && id.length <= 200).map((id) => id.trim()))].slice(0, 30) : [];
  if (typeof raw.firstSolveIncludeUnrank === 'boolean') options.firstSolveIncludeUnrank = raw.firstSolveIncludeUnrank;
  return options;
}

/** Cumulative award cutoffs; equal solved/time groups inherit the higher tier. */
function medalAwards(options, standings) {
  const tiers = ['gold', 'silver', 'bronze'];
  const awards = tiers.map((tier) => ({ id: `medal-${tier}`, citation: options[`${tier}Citation`], teamIds: [], displayMode: 'detail', awardType: 'medal' }));
  const limits = [];
  let total = 0;
  for (const tier of tiers) limits.push(total += options[`${tier}Count`]);
  const ranked = standings.filter((row) => !row.unrank);
  const scoreTime = (row) => row.timeSeconds ?? row.time * 60;
  let previous = null;
  let tier = -1;
  ranked.forEach((row, i) => {
    const tied = options.medalSameScore && previous && row.solved === previous.solved && scoreTime(row) === scoreTime(previous);
    if (!tied) tier = limits.findIndex((limit) => i < limit);
    if (tier >= 0) awards[tier].teamIds.push(row.teamId);
    previous = row;
  });
  return awards.filter((award) => award.teamIds.length);
}

function podiumAwards(options, standings) {
  const ranked = standings.filter((row) => !row.unrank).slice(0, 3);
  return ['champion', 'runner-up', 'third-place'].slice(0, ranked.length).map((place, i) => ({
    id: `podium-${place}`, citation: options[['championCitation', 'runnerUpCitation', 'thirdPlaceCitation'][i]],
    teamIds: [ranked[i].teamId], displayMode: 'detail', awardType: i === 0 ? 'winner' : 'rank',
  }));
}

/** Earliest AC per problem, using full submission timestamps rather than penalty or rounded minutes. */
function firstSolveAwards(contest, options, standings) {
  const selected = new Set(options.firstSolveProblemIds);
  const problems = (contest.problems || []).filter((problem) => options.firstSolveMode === 'all' || selected.has(problem.id));
  const teams = new Set(standings.filter((row) => options.firstSolveIncludeUnrank || !row.unrank).map((row) => row.teamId));
  const attempts = new Map(problems.map((problem) => [problem.id, { time: Infinity, pending: Infinity, winners: new Set() }]));
  for (const submission of contest.submissions || []) {
    const attempt = attempts.get(submission.problemId);
    if (!attempt || !teams.has(submission.teamId) || !Number.isFinite(submission.contestTime) || submission.contestTime < 0 ||
        (contest.durationMs > 0 && submission.contestTime >= contest.durationMs)) continue;
    if (submission.status === 'pending') attempt.pending = Math.min(attempt.pending, submission.contestTime);
    if (submission.status !== 'solved' || submission.contestTime > attempt.time) continue;
    if (submission.contestTime < attempt.time) { attempt.time = submission.contestTime; attempt.winners.clear(); }
    attempt.winners.add(submission.teamId);
  }
  return problems.flatMap((problem) => {
    const attempt = attempts.get(problem.id);
    // An unresolved earlier/equal submission could change the winner(s).
    if (!attempt.winners.size || attempt.pending <= attempt.time) return [];
    return [{ id: `first-to-solve-${problem.id}`, citation: `${problem.label || problem.id} 题最快解题奖`,
      teamIds: standings.filter((row) => attempt.winners.has(row.teamId)).map((row) => row.teamId),
      displayMode: 'detail', awardType: 'first-to-solve' }];
  });
}

/** Each award category can be configured independently and shares one preview/game calculation. */
export function configuredAwards(contest, rawOptions, standings) {
  const options = normalizeMedalOptions(rawOptions);
  let awards = [...(contest.awards || [])];
  if (options.medalMode === 'custom') {
    awards = awards.filter((award) => award.awardType !== 'medal' && !/^medal-/.test(award.id))
      .concat(medalAwards(options, standings));
  }
  if (options.podiumEnabled) {
    awards = awards.filter((award) => award.awardType !== 'winner' &&
      !/^podium-(?:champion|runner-up|third-place)$/.test(award.id) && !/^rank-[123]$/.test(award.id))
      .concat(podiumAwards(options, standings));
  }
  if (options.firstSolveMode !== 'imported') {
    awards = awards.filter((award) => award.awardType !== 'first-to-solve' && !/^first-to-solve-/.test(award.id))
      .concat(firstSolveAwards(contest, options, standings));
  }
  return awards;
}
