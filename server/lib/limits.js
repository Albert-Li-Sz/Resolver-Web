export const LIMITS = Object.freeze({
  feedBytes: 38 * 1024 * 1024, jsonBytes: 16 * 1024 * 1024,
  events: 300_000, teams: 3000, problems: 30, submissions: 150_000,
  cells: 90_000, organizations: 5000, awards: 5000, steps: 200_000,
  gameBytes: 32 * 1024 * 1024, sessionBytes: 256 * 1024 * 1024,
});
export const inputError = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });

export function jsonBytes(value, max, label) {
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes > max) throw inputError(`${label}过大（上限 ${Math.round(max / 1024 / 1024)} MB）`, 413);
  return bytes;
}

export function validateContestInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw inputError('比赛数据格式无效');
  for (const key of ['teams', 'problems', 'submissions', 'organizations', 'awards']) {
    if (input[key] == null) continue;
    const values = input[key];
    if (!Array.isArray(values)) throw inputError(`${key} 必须是数组`);
    if (values.length > LIMITS[key]) throw inputError(`${key} 数量超出上限 ${LIMITS[key]}`, 413);
    const ids = new Set();
    for (const value of values) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw inputError(`${key} 中存在无效记录`);
      if (value.id != null) {
        const id = String(value.id);
        if (!id || id.length > 200 || ids.has(id)) throw inputError(`${key} 中存在无效或重复 ID`);
        ids.add(id);
      }
      for (const field of ['name', 'displayName', 'display_name', 'formalName', 'formal_name', 'citation', 'label']) {
        if (value[field] != null && (typeof value[field] !== 'string' || value[field].length > 1000)) throw inputError(`${field} 长度或类型无效`);
      }
      for (const field of ['teamIds', 'team_ids', 'group_ids']) {
        if (value[field] != null && (!Array.isArray(value[field]) || value[field].length > LIMITS.teams)) throw inputError(`${field} 格式或数量无效`);
      }
    }
  }
  if ((input.teams?.length || 0) * (input.problems?.length || 0) > LIMITS.cells) throw inputError('队伍与题目总单元格数超出上限', 413);
  for (const field of ['name', 'formalName']) {
    if (input[field] != null && (typeof input[field] !== 'string' || input[field].length > 1000)) throw inputError('赛事名称长度或类型无效');
  }
}
