export const MEDAL_DEFAULTS = Object.freeze({
  medalMode: 'imported', goldCount: 4, silverCount: 4, bronzeCount: 4,
  goldCitation: '金奖', silverCitation: '银奖', bronzeCitation: '铜奖', medalSameScore: true,
});

export function normalizeMedalOptions(raw = {}) {
  const options = { ...MEDAL_DEFAULTS, medalMode: raw.medalMode === 'custom' ? 'custom' : 'imported' };
  for (const tier of ['gold', 'silver', 'bronze']) {
    const count = raw[`${tier}Count`];
    if (count != null && count !== '' && Number.isFinite(Number(count))) options[`${tier}Count`] = Math.max(0, Math.min(10000, Math.trunc(Number(count))));
    if (typeof raw[`${tier}Citation`] === 'string') options[`${tier}Citation`] = raw[`${tier}Citation`].trim().slice(0, 80) || MEDAL_DEFAULTS[`${tier}Citation`];
  }
  if (typeof raw.medalSameScore === 'boolean') options.medalSameScore = raw.medalSameScore;
  return options;
}

/** Cumulative award cutoffs; equal solved/time groups inherit the higher tier. */
export function configuredAwards(contest, options, standings) {
  if (options.medalMode !== 'custom') return contest.awards || [];
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
  return (contest.awards || []).filter((award) => award.awardType !== 'medal' && !/^medal-/.test(award.id))
    .concat(awards.filter((award) => award.teamIds.length));
}
