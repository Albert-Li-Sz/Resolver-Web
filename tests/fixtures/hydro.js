// Based on hydro-dev/Hydro packages/onsite-toolkit/index.ts generateCdpZip.
export function hydroFeed({ scoreboardType = 'pass-fail' } = {}) {
  const events = [];
  const add = (type, data) => events.push({ type, id: data.id, data, token: `t${events.length}` });
  add('contest', { id: 'hydro-test', name: 'Hydro 校赛 · 适配验证', start_time: '2026-10-22T01:00:00+08:00', duration: '05:00:00.000', scoreboard_freeze_duration: '01:00:00.000', scoreboard_type: scoreboardType, penalty_time: 20 });
  for (const [id, solved, penalty] of [['AC', true, false], ['WA', false, true], ['CE', false, false], ['FE', false, true], ['IGN', false, true]]) add('judgement-types', { id, name: id, solved, penalty });
  add('groups', { id: 'group-1', name: 'participants' });
  add('groups', { id: 'group-2', name: 'observers' });
  add('organizations', { id: 'org-1', name: '测试大学', logo: [{ href: 'contest/hydro-test/organizations/org-1/logo', mime: 'image/png' }] });
  for (const [id, name, star] of [['01', '追光队 Zulu', false], ['02', '晨星队 Alpha', false], ['S01', '⭐打星队', true], ['03', '零提交队', false]]) {
    add('teams', { id, name, display_name: name, organization_id: 'org-1', group_ids: [star ? 'group-2' : 'group-1'], logo: [{ href: `https://hydro.example.test/avatar/${id}.png` }], photo: [{ href: `contest/hydro-test/teams/${id}/photo` }] });
  }
  add('problems', { id: '1001', label: 'A', name: '求和', ordinal: 0 });
  add('problems', { id: '1002', label: 'B', name: '最短路', ordinal: 1 });
  const submit = (id, team, problem, time, verdict) => {
    add('submissions', { id, team_id: team, problem_id: problem, contest_time: time });
    add('judgements', { id: `j-${id}`, submission_id: id, judgement_type_id: verdict, end_contest_time: time });
  };
  submit('s1', '01', '1001', '00:01:01', 'AC');
  submit('s2', '02', '1001', '00:01:10', 'AC');
  submit('s3', 'S01', '1001', '00:00:30', 'AC');
  submit('s4', '01', '1002', '04:02:03', 'WA');
  submit('s5', '01', '1002', '04:03:04', 'CE');
  submit('s6', '01', '1002', '04:04:05', 'FE');
  submit('s7', '01', '1002', '04:05:06', 'IGN');
  submit('s8', '01', '1002', '04:20:05', 'AC');
  submit('s9', '02', '1002', '04:30:04', 'AC');
  add('state', { ended: '2026-10-22T06:00:00+08:00', finalized: '2026-10-22T06:01:00+08:00' });
  return events.map((event) => JSON.stringify(event)).join('\n');
}
