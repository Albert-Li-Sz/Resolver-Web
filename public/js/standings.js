/** Shared by the engine and canvas: one scoring and tie-breaking rule. */
export function scoreTeam(contest, team, cells = []) {
  const hydro = contest.scoringMode === 'hydro';
  const penalty = Number(contest.penaltyMinutes ?? 20);
  let solved = 0;
  let time = 0;
  let timeSeconds = 0;
  let lastSolutionTime = -1;
  for (const cell of cells) {
    if (cell?.status !== 'solved') continue;
    const minutes = Number(cell.time) || 0;
    const penalties = cell.penaltyCount ?? cell._penaltyCount ?? Math.max(0, (Number(cell.attempts) || 0) - 1);
    solved += 1;
    time += minutes + penalties * penalty;
    if (hydro) timeSeconds += (cell.timeSeconds ?? minutes * 60) + penalties * penalty * 60;
    lastSolutionTime = Math.max(lastSolutionTime, minutes);
  }
  return { teamId: team.id, displayName: team.displayName || team.name || team.id, solved,
    time: hydro ? Math.floor(timeSeconds / 60) : time,
    ...(hydro ? { timeSeconds } : {}), ...(team.unrank ? { unrank: true } : {}), lastSolutionTime, rank: 0 };
}

const names = new Intl.Collator('en');
export function compareStandings(contest, a, b) {
  const hydro = contest.scoringMode === 'hydro';
  const scoreTime = (row) => hydro ? row.timeSeconds : row.time;
  return b.solved - a.solved || scoreTime(a) - scoreTime(b) ||
    (hydro ? 0 : a.lastSolutionTime - b.lastSolutionTime) ||
    names.compare(String(a.displayName), String(b.displayName)) ||
    (String(a.teamId) < String(b.teamId) ? -1 : String(a.teamId) > String(b.teamId) ? 1 : 0);
}

function assignRanks(contest, records) {
  const hydro = contest.scoringMode === 'hydro';
  const scoreTime = (row) => hydro ? row.timeSeconds : row.time;
  let previous = null;
  let rankedCount = 0;
  for (const record of records) {
    if (record.unrank) continue;
    rankedCount += 1;
    record.rank = previous && previous.solved === record.solved && scoreTime(previous) === scoreTime(record) &&
      (hydro || previous.lastSolutionTime === record.lastSolutionTime) ? previous.rank : rankedCount;
    previous = record;
  }
  return records;
}

export function scoreStandings(contest, results) {
  return assignRanks(contest, (contest.teams || []).map((team) => scoreTeam(contest, team, results[team.id]))
    .sort((a, b) => compareStandings(contest, a, b)));
}

/** Only one team's score changes at a reveal: reinsert that record. */
export function updateStandings(contest, records, team, cells, { ranks = true } = {}) {
  const oldIndex = records.findIndex((row) => row.teamId === team.id);
  if (oldIndex >= 0) records.splice(oldIndex, 1);
  const row = scoreTeam(contest, team, cells);
  let low = 0; let high = records.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (compareStandings(contest, records[mid], row) <= 0) low = mid + 1;
    else high = mid;
  }
  records.splice(low, 0, row);
  if (ranks) assignRanks(contest, records);
  return { from: oldIndex, to: low };
}

/** Hydro displays exact elapsed/penalty time as minutes:seconds. */
export function formatSeconds(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
