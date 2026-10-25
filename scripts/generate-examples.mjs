import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createDemo } from '../server/lib/demo.js';
import { hydroFeed } from '../tests/fixtures/hydro.js';
import { parseEventFeed, buildGame } from '../server/lib/engine.js';

const directory = new URL('../examples/', import.meta.url);
const minute = 60_000;
const colors = ['#4585d3', '#2eaa85', '#e0ac39', '#a572cb', '#dd6868'];
const duration = (ms) => `${Math.floor(ms / 3_600_000)}:${String(Math.floor(ms / minute) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.000`;

function trainingContest(name, count, problemCount) {
  const organizations = Array.from({ length: Math.ceil(count / 2) }, (_, i) => ({ id: `org-${i + 1}`, name: `示例学院 ${String(i + 1).padStart(2, '0')}` }));
  const teams = Array.from({ length: count }, (_, i) => ({ id: `team-${i + 1}`, name: `追光 ${String(i + 1).padStart(2, '0')} 队`, organizationId: organizations[Math.floor(i / 2)].id }));
  const problems = Array.from({ length: problemCount }, (_, i) => ({ id: `p-${i}`, label: String.fromCharCode(65 + i), name: `练习题 ${String.fromCharCode(65 + i)}`, rgb: colors[i % colors.length] }));
  const submissions = [];
  const add = (team, p, time, status) => submissions.push({ id: `s-${submissions.length + 1}`, teamId: team.id, problemId: problems[p].id, contestTime: time * minute, status, penalty: status === 'failed' });
  teams.forEach((team, i) => {
    const solved = 1 + (count - i - 1) % (problemCount - 2);
    for (let p = 0; p < solved; p++) {
      const time = 18 + p * 20 + (i * 7) % 60;
      if ((i + p) % 3 === 0) add(team, p, time - 3, 'failed');
      add(team, p, time, 'solved');
    }
    add(team, solved, 244 + i % 35, 'failed');
    if (i % 3 !== 1) add(team, solved, 284 + i % 15, 'solved');
  });
  return { name, durationMs: 300 * minute, freezeDurationMs: 60 * minute, startTime: '2026-01-01T09:00:00+08:00', penaltyMinutes: 20, organizations, teams, problems, submissions, awards: [] };
}

function toFeed(contest, id) {
  const events = [];
  const add = (type, data) => events.push({ type, id: data.id, data });
  add('contests', { id, name: contest.name, duration: duration(contest.durationMs), start_time: contest.startTime, scoreboard_freeze_duration: duration(contest.freezeDurationMs), penalty_time: 20, scoreboard_type: 'pass-fail' });
  for (const [id, solved, penalty] of [['AC', true, false], ['WA', false, true], ['CE', false, false]]) add('judgement-types', { id, name: id, solved, penalty });
  for (const org of contest.organizations) add('organizations', { id: org.id, name: org.name, formal_name: org.formalName || org.name, country: org.country, ...(org.logo ? { logo: [{ href: org.logo }] } : {}) });
  for (const team of contest.teams) add('teams', { id: team.id, name: team.name, display_name: team.displayName || team.name, organization_id: team.organizationId, ...(team.logo ? { logo: [{ href: team.logo }] } : {}) });
  contest.problems.forEach((p, ordinal) => add('problems', { ...p, ordinal }));
  for (const s of contest.submissions) {
    add('submissions', { id: s.id, team_id: s.teamId, problem_id: s.problemId, contest_time: duration(s.contestTime) });
    if (s.status !== 'pending') add('judgements', { id: `j-${s.id}`, submission_id: s.id, judgement_type_id: s.status === 'solved' ? 'AC' : s.penalty ? 'WA' : 'CE' });
  }
  for (const award of contest.awards) add('awards', { id: award.id, citation: award.citation, team_ids: award.teamIds, display_mode: award.displayMode, award_type: award.awardType });
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

const finals = createDemo().contest;
finals.name = '决赛滚榜练习 · 18 队';
const tied = trainingContest('并列与奖线练习 · 8 队', 8, 5);
tied.submissions = tied.submissions.filter((s) => !['team-1', 'team-2'].includes(s.teamId));
for (const teamId of ['team-1', 'team-2']) {
  tied.submissions.push({ id: `${teamId}-pre`, teamId, problemId: 'p-0', contestTime: 30 * minute, status: 'solved', penalty: false });
  tied.submissions.push({ id: `${teamId}-post`, teamId, problemId: 'p-1', contestTime: 260 * minute, status: 'solved', penalty: false });
}
let hydro = hydroFeed().split('\n').map(JSON.parse);
for (const event of hydro) {
  if (event.type === 'contest') event.data.name = 'Hydro 风格练习 · 打星与秒级罚时';
  // Samples are self-contained: no placeholder network images or missing files.
  delete event.data.logo; delete event.data.photo;
}
const cases = [
  { file: '01-quickstart-8-teams.ndjson', title: '快速上手', note: '8 队 / 5 题，封榜、通过与失败揭晓', text: toFeed(trainingContest('快速上手练习 · 8 队', 8, 5), 'quickstart') },
  { file: '02-finals-18-teams.ndjson', title: '决赛与颁奖', note: '18 队 / 13 题，金银铜、首解和组织徽标；合成练习数据，非官方赛果', text: toFeed(finals, 'finals-practice') },
  { file: '03-regional-48-teams.ndjson', title: '多页榜单', note: '48 队 / 10 题，适合检查滚动、每屏行数与投影布局', text: toFeed(trainingContest('区域赛滚动练习 · 48 队', 48, 10), 'regional') },
  { file: '04-ties-and-medals.ndjson', title: '并列与奖线', note: '8 队 / 5 题；team-1 与 team-2 同题数同罚时，可检查并列同奖', text: toFeed(tied, 'ties') },
  { file: '05-hydro-starred.ndjson', title: 'Hydro 风格', note: '4 队 / 2 题，打星、CE/FE/IGN 与秒级罚时；合成导出样例', text: `${hydro.map(JSON.stringify).join('\n')}\n` },
];

// Dependency-free ZIP (stored entries, fixed timestamps), reproducible on Node 20+.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const chunks = [], central = []; let offset = 0;
  for (const [filename, content] of files) {
    const name = Buffer.from(filename), data = Buffer.from(content), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(33, 14);
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
    central.push(record, name); offset += local.length + name.length + data.length;
  }
  const table = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(table.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, table, end]);
}

await mkdir(directory, { recursive: true });
const manifest = [];
for (const entry of cases) {
  const contest = parseEventFeed(entry.text), game = buildGame(contest, { showAwards: true });
  const result = { file: entry.file, title: entry.title, note: entry.note, teams: contest.teams.length, problems: contest.problems.length, submissions: contest.submissions.length, reveals: game.steps.filter((s) => s.type === 'resolve').length, sha256: createHash('sha256').update(entry.text).digest('hex') };
  manifest.push(result); await writeFile(new URL(entry.file, directory), entry.text);
}
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(new URL('manifest.json', directory), manifestText);
await writeFile(new URL('scoreboards.zip', directory), zip([...cases.map((e) => [e.file, e.text]), ['manifest.json', manifestText]]));
console.log(manifest.map((e) => `${e.file}: ${e.teams} teams, ${e.problems} problems, ${e.reveals} reveals`).join('\n'));
