import { SCHOOL_LOGOS } from './school-logo-catalog.js';
import { DEFAULT_SCHOOL_LOGO, logoSource } from './logos.js';

const normalizeName = (value) => String(value ?? '').normalize('NFKC').toLowerCase()
  .replace(/&/g, 'and').replace(/[^\p{L}\p{N}]/gu, '');

export function createSchoolLogoMatcher(catalog) {
  const index = new Map();
  for (const school of catalog) {
    for (const alias of [school.name, ...school.aliases]) {
      const key = normalizeName(alias);
      // CCS organization IDs can be local IDs. Numeric ICPC registry IDs must
      // never accidentally match an unrelated school in an imported contest.
      if (!key || /^(?:g)?\d+$/.test(key)) continue;
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(school);
    }
  }
  return (...names) => {
    const find = (values) => {
      const matches = values.map((value) => index.get(normalizeName(value))).filter(Boolean);
      if (!matches.length) return null;
      // A full formal name can disambiguate a shared short name. Conflicting
      // school names are left unmatched instead of guessing a logo.
      const common = [...matches[0]].filter((school) => matches.every((set) => set.has(school)));
      return common.length === 1 ? common[0] : null;
    };
    const direct = names.filter((name) => typeof name === 'string' && name.trim());
    const exact = direct.some((name) => index.has(normalizeName(name)));
    return find(exact ? direct : direct.flatMap((name) => name.split(/[()（）\[\]【】/|]/)));
  };
}

export const matchSchoolLogo = createSchoolLogoMatcher(SCHOOL_LOGOS);

/** Apply to fresh imports, restored presets and normalized engine contests. */
export function applySchoolLogos(contest) {
  const organizations = (contest.organizations || []).map((org) => {
    if (org.logo && org.logo !== DEFAULT_SCHOOL_LOGO && !['hydro', 'default'].includes(org.logoSource)) return { ...org };
    if (org.logoOverride && org.logo) return { ...org };
    const school = matchSchoolLogo(org.formalName, org.name);
    return { ...org, logo: school ? `https://avatar.hydrooj.com${school.src}` : DEFAULT_SCHOOL_LOGO,
      logoSource: school ? 'hydro' : 'default' };
  });
  const byId = new Map(organizations.map((org) => [String(org.id), org]));
  const teams = (contest.teams || []).map((team) => {
    if (team.logo && team.logo !== DEFAULT_SCHOOL_LOGO &&
        (!['hydro', 'default', 'organization'].includes(team.logoSource) || team.logoOverride)) return { ...team };
    const org = byId.get(String(team.organizationId));
    if (org?.logo) return { ...team, logo: org.logo, logoSource: 'organization' };
    const school = matchSchoolLogo(team.organizationName, team.formalName,
      ...(!team.organizationName && !team.formalName ? [team.name, team.displayName] : []));
    const logo = school ? `https://avatar.hydrooj.com${school.src}` : DEFAULT_SCHOOL_LOGO;
    return { ...team, logo, logoSource: logoSource(logo) };
  });
  return { ...contest, organizations, teams };
}
