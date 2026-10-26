export const DEFAULT_SCHOOL_LOGO = '/assets/img/icpc-logo.png';

export function logoSource(url) {
  if (!url || url === DEFAULT_SCHOOL_LOGO) return 'default';
  return /^https:\/\/avatar\.hydrooj\.com\/org\//.test(url) ? 'hydro' : 'feed';
}

export function teamLogoUrl(team, organization) {
  if (team?.logoOverride && team.logo) return team.logo;
  if (organization?.logoOverride && organization.logo) return organization.logo;
  return (team?.logo !== DEFAULT_SCHOOL_LOGO && team?.logo) || organization?.logo || DEFAULT_SCHOOL_LOGO;
}

/** All configuration-page logos share the same local, loop-free fallback. */
export function setLogoImage(image, url) {
  image.referrerPolicy = 'no-referrer';
  image.onerror = () => {
    image.onerror = null;
    image.src = DEFAULT_SCHOOL_LOGO;
  };
  image.src = url || DEFAULT_SCHOOL_LOGO;
}
