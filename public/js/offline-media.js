import { applySchoolLogos } from './school-logos.js';
import { DEFAULT_SCHOOL_LOGO } from './logos.js';
import { readJSONResponse } from './http.js';

export function mediaFields(contest) {
  return [contest, ...(contest.organizations || []), ...(contest.teams || [])]
    .flatMap((item) => ['logo', 'photo'].filter((key) => /^(https?:\/\/|\/media\/)/i.test(item[key] || ''))
      .map((key) => ({ item, key, source: item[key] })));
}

// Preserve the editable source URLs. Only the show copy uses guaranteed local
// assets/fallbacks, so a failed download can be retried before the next show.
export async function prepareOfflineContest(contest, { onProgress = () => {}, timeout = 60000,
  request = async (urls, remaining) => readJSONResponse(await fetch('/api/assets/cache', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls }),
    signal: AbortSignal.timeout(Math.max(1, Math.min(25000, remaining))),
  })), now = Date.now } = {}) {
  const copy = applySchoolLogos(structuredClone(contest));
  const fields = mediaFields(copy);
  const urls = [...new Set(fields.map(({ source }) => source))];
  const results = new Map();
  const deadline = now() + timeout;
  for (let i = 0; i < urls.length && now() < deadline; i += 12) {
    onProgress(i, urls.length);
    try {
      const data = await request(urls.slice(i, i + 12), deadline - now());
      for (const item of data.items) results.set(item.source, item);
    } catch { break; }
  }
  const failures = urls.filter((url) => !results.get(url)?.url);
  for (const { item, key, source } of fields) {
    item[key] = results.get(source)?.url || (key === 'logo' ? DEFAULT_SCHOOL_LOGO : '');
    if (key === 'logo') { item.logoOverride = true; item.logoSource = 'offline'; }
  }
  onProgress(urls.length, urls.length);
  return { contest: copy, report: { total: urls.length, cached: urls.length - failures.length, failed: failures.length, reasons: [...new Set(failures.map((url) => results.get(url)?.error || '网络中断或准备超时'))].slice(0, 3) } };
}
