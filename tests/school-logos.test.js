import test from 'node:test';
import assert from 'node:assert/strict';
import { applySchoolLogos, createSchoolLogoMatcher, matchSchoolLogo } from '../public/js/school-logos.js';
import { DEFAULT_SCHOOL_LOGO, setLogoImage, teamLogoUrl } from '../public/js/logos.js';
import { normalizeContest, parseEventFeed, buildGame } from '../server/lib/engine.js';
import { applyMediaLibrary, preserveContestMedia } from '../public/js/media-library.js';
import { ResolverView } from '../public/js/render/resolver-view.js';
import { parseSchoolLogoRegistry } from '../scripts/sync-school-logos.mjs';

const hydro = (name) => `https://avatar.hydrooj.com${matchSchoolLogo(name).src}`;
const input = () => ({ name: 'School logos', contestId: 'schools', problems: [{ id: 'p' }],
  organizations: [{ id: 'pku', name: '北京大学' }, { id: 'nx', name: 'Nanjing Xiaozhuang University' },
    { id: 'unknown', name: '未知大学' }],
  teams: [{ id: 'a', organizationId: 'pku' }, { id: 'b', organizationId: 'nx' }, { id: 'c', organizationId: 'unknown' }],
});

test('the Hydro catalog resolves Chinese, English, case, punctuation and bilingual school names', () => {
  for (const name of ['北京大学', 'Peking University', '  PEKING　UNIVERSITY  ', '北京大学（Peking University）']) {
    assert.equal(matchSchoolLogo(name)?.name, '北京大学', name);
  }
  assert.equal(matchSchoolLogo('Nanjing Xiaozhuang University')?.name, '南京晓庄学院');
  assert.equal(matchSchoolLogo('Nanjing-Xiaozhuang University')?.name, '南京晓庄学院');
  assert.equal(matchSchoolLogo('Zhejiang University')?.name, '浙江大学');
  for (const name of ['1438', '未知大学', '北京大学医学部某某学院', '南京大学金陵学院外校队']) {
    assert.equal(matchSchoolLogo(name), null, name);
  }
});

test('shared aliases need an unambiguous formal name and conflicting school names never guess', () => {
  const schools = [{ name: 'Alpha University', aliases: ['AU'], src: '/org/alpha.webp' },
    { name: 'Another University', aliases: ['AU'], src: '/org/another.webp' }];
  const match = createSchoolLogoMatcher(schools);
  assert.equal(match('AU'), null);
  assert.equal(match('AU', 'Alpha University'), schools[0]);
  assert.equal(match('Alpha University', 'Another University'), null);
});

test('imports assign school logos and a local ICPC fallback through games and repeated normalization', () => {
  const c = normalizeContest(input());
  assert.equal(c.organizations[0].logo, hydro('北京大学'));
  assert.equal(c.organizations[1].logo, hydro('南京晓庄学院'));
  assert.equal(c.organizations[2].logo, DEFAULT_SCHOOL_LOGO);
  assert.deepEqual(c.teams.map((team) => team.logo), c.organizations.map((org) => org.logo));
  assert.deepEqual(normalizeContest(c), c);
  const game = buildGame(c, {});
  assert.deepEqual(game.contest.teams.map((team) => team.logo), c.teams.map((team) => team.logo));
  assert.equal(game.contest.organizations[0].logoSource, 'hydro');
  assert.equal(game.contest.organizations[2].logoSource, 'default');
  assert.equal(normalizeContest({ ...input(), organizations: [{ id: '1438' }],
    teams: [{ id: 'a', organizationId: '1438' }] }).teams[0].logo, DEFAULT_SCHOOL_LOGO);
});

test('CCS organization aliases, missing organizations and teams without a school import correctly', () => {
  const c = parseEventFeed(JSON.stringify([
    { type: 'organizations', data: { id: 'pku', name: 'PKU', formal_name: 'Peking University', logo: [{ href: 'logo.png' }] } },
    { type: 'teams', data: { id: 'a', organization_id: 'pku' } },
    { type: 'teams', data: { id: 'b', name: '清华大学' } },
    { type: 'teams', data: { id: 'c', name: 'Unknown Team' } },
    { type: 'problems', data: { id: 'p' } },
  ]));
  assert.equal(c.teams[0].logo, hydro('北京大学'));
  assert.equal(c.teams[1].logo, hydro('清华大学'));
  assert.equal(c.teams[2].logo, DEFAULT_SCHOOL_LOGO);
  const missing = normalizeContest({ problems: [], teams: [{ id: 'a', organizationId: 'missing', organizationName: '北京大学' }] });
  assert.equal(missing.organizations[0].logo, hydro('北京大学'));
  assert.equal(missing.teams[0].logo, hydro('北京大学'));
});

test('feed images, explicit team/organization uploads and pre-contest media take priority', () => {
  const source = input();
  source.organizations[0].logo = 'https://example.com/official-pku.png';
  source.teams[1].logo = 'data:image/png;base64,AAAA';
  const automatic = applySchoolLogos(source);
  assert.equal(source.organizations[1].logo, undefined, 'the source contest is not mutated');
  assert.equal(automatic.organizations[0].logo, source.organizations[0].logo);
  assert.equal(automatic.teams[1].logo, source.teams[1].logo);
  const url = `/media/${'a'.repeat(64)}.png`;
  const library = applyMediaLibrary(applySchoolLogos(input()), [
    { id: 'rule', kind: 'organization-logo', matchBy: 'id', key: 'pku', url },
  ]).contest;
  const game = buildGame(library, {});
  assert.equal(teamLogoUrl(game.contest.teams[0], game.contest.organizations[0]), url);
  const previous = applySchoolLogos(input());
  previous.teams[0] = { ...previous.teams[0], logo: url, logoOverride: true, logoSource: 'manual' };
  const kept = preserveContestMedia(previous, applySchoolLogos(input())).contest;
  assert.equal(buildGame(kept, {}).contest.teams[0].logo, url);
});

test('restored contests can upgrade missing logos while keeping manual overrides', () => {
  const source = input();
  source.organizations[0] = { ...source.organizations[0], logo: DEFAULT_SCHOOL_LOGO, logoSource: 'default' };
  source.teams[0] = { ...source.teams[0], logo: DEFAULT_SCHOOL_LOGO, logoSource: 'organization' };
  const result = applySchoolLogos(source);
  assert.equal(result.teams[0].logo, hydro('北京大学'));
  const custom = 'data:image/png;base64,AAAA';
  result.organizations[0] = { ...result.organizations[0], logo: custom, logoOverride: true, logoSource: 'manual' };
  assert.equal(applySchoolLogos(result).teams[0].logo, custom);
  assert.equal(teamLogoUrl({ logo: DEFAULT_SCHOOL_LOGO }, { logo: custom }), custom);
});

test('configuration images fall back locally once after a network or decoding error', () => {
  const image = {};
  setLogoImage(image, hydro('北京大学'));
  assert.match(image.src, /^https:\/\/avatar\.hydrooj\.com\/org\//);
  image.onerror();
  assert.equal(image.src, DEFAULT_SCHOOL_LOGO);
  assert.equal(image.onerror, null, 'a failed fallback cannot start an error loop');
  setLogoImage(image, null);
  assert.equal(image.src, DEFAULT_SCHOOL_LOGO);
});

test('scoreboard and award Canvas images use ICPC when custom and remote logos are unavailable', () => {
  const fallback = { naturalWidth: 2401, naturalHeight: 2209 };
  const view = { orgsById: new Map([['o', { logo: 'https://unavailable/logo.png' }]]),
    _image: (src) => src === DEFAULT_SCHOOL_LOGO ? fallback : null };
  const team = { organizationId: 'o', logo: 'https://unavailable/team.png' };
  assert.equal(ResolverView.prototype._teamLogo.call(view, team), fallback);
  assert.equal(ResolverView.prototype._orgLogo.call(view, team), fallback);
  const custom = {};
  view._image = (src) => src === 'data:custom' ? custom : src === DEFAULT_SCHOOL_LOGO ? fallback : null;
  assert.equal(ResolverView.prototype._teamLogo.call(view, { ...team, logo: 'data:custom', logoOverride: true }), custom);
});

test('catalog refresh reads data without executing HTML and rejects a changed or invalid source', () => {
  const school = { name: [0, '学校 & University'], aliases: [1, [[0, '学校'], [0, 'University']]], src: [0, '/org/test.webp?build=abc123'] };
  const props = JSON.stringify({ logos: [1, [[0, school]]] }).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const html = `<script>throw new Error('not executable')</script><astro-island component-url="/_astro/LogoRegistry.test.js" props="${props}">`;
  assert.deepEqual(parseSchoolLogoRegistry(html), [{ name: '学校 & University', aliases: ['学校', 'University'], src: '/org/test.webp?build=abc123' }]);
  assert.throws(() => parseSchoolLogoRegistry('<html>Service unavailable</html>'), /格式/);
  assert.throws(() => parseSchoolLogoRegistry(html.replace('/org/test.webp?build=abc123', 'https://untrusted/logo.webp')), /无效/);
});
