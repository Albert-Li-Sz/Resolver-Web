import { normalizeDisplay, DISPLAY_DEFAULTS } from './display-preferences.js';

// Accept the numeric screen settings used by earlier platform previews.
export function outputProfile(raw = {}) {
  const legacy = { 1080: '1080p', 1440: '1440p', 2160: '2160p' };
  const ratios = [[1, '1:1'], [4 / 3, '4:3'], [21 / 9, '21:9'], [32 / 9, '32:9']];
  return normalizeDisplay({ ...raw,
    resolution: legacy[raw.resolution] || raw.resolution || DISPLAY_DEFAULTS.resolution,
    aspect: raw.aspect || ratios.find(([n]) => Math.abs(n - raw.ratio) < .001)?.[1] || '16:9',
  });
}
