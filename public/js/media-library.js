export const MEDIA_KINDS = {
  'organization-logo': { list: 'organizations', field: 'logo', label: '组织 Logo' },
  'team-logo': { list: 'teams', field: 'logo', label: '队伍 Logo' },
  'team-photo': { list: 'teams', field: 'photo', label: '队伍照片' },
};
const key = (value) => String(value ?? '').trim();
const names = (item, list) => new Set([item.name, item.displayName, ...(list === 'organizations' ? [item.formalName] : [])].filter(Boolean).map(key));

export function applyMediaLibrary(contest, records = []) {
  const copy = { ...contest, teams: (contest.teams || []).map((item) => ({ ...item })), organizations: (contest.organizations || []).map((item) => ({ ...item })) };
  const indexes = new Map();
  for (const list of ['teams', 'organizations']) {
    const ids = new Map(); const aliases = new Map();
    for (const item of copy[list]) {
      const id = key(item.id);
      if (!ids.has(id)) ids.set(id, []);
      ids.get(id).push(item);
      for (const name of names(item, list)) {
        if (!aliases.has(name)) aliases.set(name, []);
        aliases.get(name).push(item);
      }
    }
    indexes.set(list, { id: ids, name: aliases });
  }
  const candidates = new Map();
  const winners = new Map(Object.keys(MEDIA_KINDS).map((kind) => [kind, new Map()]));
  const priority = (record, item) => record.matchBy === 'id' ? 0 : key(item.name) === key(record.key) ? 1 : key(item.displayName) === key(record.key) ? 2 : 3;
  for (const record of records) {
    if (!Object.hasOwn(MEDIA_KINDS, record.kind)) continue;
    const config = MEDIA_KINDS[record.kind];
    const matches = indexes.get(config.list)[record.matchBy]?.get(key(record.key)) || [];
    candidates.set(record.id, matches);
    if (matches.length !== 1) continue;
    const item = matches[0]; const selected = winners.get(record.kind);
    const before = selected.get(item);
    const rank = priority(record, item);
    if (!before || rank < before.rank || (rank === before.rank &&
      (String(record.updatedAt || '') > String(before.record.updatedAt || '') ||
        (String(record.updatedAt || '') === String(before.record.updatedAt || '') && String(record.id) < String(before.record.id))))) selected.set(item, { record, rank });
  }
  const used = new Set();
  for (const [kind, config] of Object.entries(MEDIA_KINDS)) {
    for (const item of copy[config.list]) {
      const chosen = winners.get(kind).get(item)?.record;
      if (!chosen) continue;
      const field = config.field;
      if (field === 'logo' && !item.logoOverride) item.originalLogo = item.logo || null;
      item[field] = chosen.url;
      item[`${field}Override`] = true;
      item[`${field}Source`] = 'library';
      used.add(chosen.id);
    }
  }
  return {
    contest: copy, matched: used.size,
    unmatched: records.filter((record) => !used.has(record.id)).map((record) => ({ ...record,
      reason: !candidates.get(record.id)?.length ? '未找到对应对象' : candidates.get(record.id).length > 1 ? '存在重名，建议改用 ID' :
        winners.get(record.kind)?.get(candidates.get(record.id)[0])?.record.matchBy === 'id' ? '已使用更优先的 ID 规则' : '已使用更优先的名称或别名规则（同级取较新规则）' })),
  };
}

export function preserveContestMedia(previous, incoming) {
  if (!previous) return { contest: incoming, preserved: 0 };
  const same = previous.contestId && incoming.contestId ? previous.contestId === incoming.contestId :
    previous.name === incoming.name && previous.startTime === incoming.startTime;
  if (!same) return { contest: incoming, preserved: 0 };
  let preserved = 0;
  const result = { ...incoming };
  for (const list of ['organizations', 'teams']) {
    const old = new Map((previous[list] || []).map((item) => [String(item.id), item]));
    result[list] = (incoming[list] || []).map((item) => {
      const before = old.get(String(item.id));
      if (!before) return item;
      const next = { ...item };
      for (const field of list === 'teams' ? ['logo', 'photo'] : ['logo']) {
        const manuallySet = before[`${field}Source`] === 'manual' ||
          (!before[`${field}Source`] && (before[`${field}Override`] || /^\/media\//.test(before[field] || '')));
        if (!manuallySet) continue;
        if (field === 'logo') next.originalLogo = item.logo || null;
        next[field] = before[field]; next[`${field}Override`] = before[`${field}Override`] ?? true; next[`${field}Source`] = 'manual'; preserved++;
      }
      return next;
    });
  }
  return { contest: result, preserved };
}
