export const FREEZE_DEFAULTS = Object.freeze({ freezeMode: 'feed', freezeMinutes: 60 });

export function normalizeFreezeOptions(raw = {}) {
  const n = Number(raw.freezeMinutes);
  return { freezeMode: raw.freezeMode === 'custom' ? 'custom' : 'feed',
    freezeMinutes: raw.freezeMinutes != null && raw.freezeMinutes !== '' && Number.isFinite(n) ? Math.max(0, n) : 60 };
}

export function withFreezeOptions(contest, options) {
  if (contest.missingSubmissionTimes > 0) {
    throw Object.assign(new Error(`有 ${contest.missingSubmissionTimes} 条提交缺少时间或含无效时间，无法可靠计算排名，请重新导出完整事件流`), { status: 400, expose: true });
  }
  if (options.freezeMode !== 'custom') {
    return contest;
  }
  const freezeDurationMs = Math.round(options.freezeMinutes * 60000);
  if (freezeDurationMs <= 0 || freezeDurationMs > contest.durationMs) {
    throw Object.assign(new Error('封榜时长须大于 0 且不超过比赛时长'), { status: 400, expose: true });
  }
  return { ...contest, freezeDurationMs, freezeSource: 'custom' };
}
