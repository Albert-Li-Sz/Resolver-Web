// Output preferences belong to this browser, not to the contest or presenter.
export const DISPLAY_STORAGE_KEY = 'resolver.display.v1';
export const RESOLUTIONS = Object.freeze({ '1080p': 1080, '1440p': 1440, '2160p': 2160 });
export const DISPLAY_DEFAULTS = Object.freeze({ region: 'full', x: 0, y: 0, width: 100, height: 100, margin: 0, aspect: '16:9', resolution: '1440p' });
export const REGIONS = { full: [0, 0, 100, 100], top: [0, 0, 100, 50], bottom: [0, 50, 100, 50],
  left: [0, 0, 50, 100], right: [50, 0, 50, 100], tl: [0, 0, 50, 50], tr: [50, 0, 50, 50],
  bl: [0, 50, 50, 50], br: [50, 50, 50, 50] };
const clamp = (n, min, max, fallback) => Math.max(min, Math.min(max, Number.isFinite(Number(n)) ? Number(n) : fallback));
export function normalizeDisplay(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const region = Object.hasOwn(REGIONS, value.region) || value.region === 'custom' ? value.region : 'full';
  const x = clamp(value.x, 0, 90, 0), y = clamp(value.y, 0, 90, 0);
  return { region, x, y, width: clamp(value.width, 10, 100 - x, 100 - x), height: clamp(value.height, 10, 100 - y, 100 - y),
    margin: clamp(value.margin, 0, 15, 0), aspect: ['16:9', '4:3', '1:1', '21:9', '32:9', 'auto'].includes(value.aspect) ? value.aspect : '16:9',
    resolution: Object.hasOwn(RESOLUTIONS, value.resolution) ? value.resolution : DISPLAY_DEFAULTS.resolution };
}
export function displayGeometry(value, viewportWidth, viewportHeight) {
  const s = normalizeDisplay(value);
  const [x, y, w, h] = REGIONS[s.region] || [s.x, s.y, s.width, s.height];
  const left = viewportWidth * (x + w * s.margin / 100) / 100;
  const top = viewportHeight * (y + h * s.margin / 100) / 100;
  const width = viewportWidth * w / 100 * (1 - s.margin / 50);
  const height = viewportHeight * h / 100 * (1 - s.margin / 50);
  const [a, b] = s.aspect.split(':').map(Number);
  const ratio = s.aspect === 'auto' ? width / Math.max(1, height) : a / b;
  return { left, top, width, height, logicalWidth: Math.round(clamp(ratio * 1080, 1080, 5760, 1920)), logicalHeight: 1080 };
}
export function renderDimensions(logicalWidth = 1920, resolution = DISPLAY_DEFAULTS.resolution) {
  const width = clamp(logicalWidth, 1080, 5760, 1920);
  const height = Object.hasOwn(RESOLUTIONS, resolution) ? RESOLUTIONS[resolution] : RESOLUTIONS[DISPLAY_DEFAULTS.resolution];
  // Bound allocation on extreme LED aspect ratios, including the calibration canvas.
  const scale = Math.min(height / 1080, 8192 / width);
  return { width: Math.round(width * scale), height: Math.round(1080 * scale) };
}
export function readDisplaySettings() {
  try { return normalizeDisplay(JSON.parse(localStorage.getItem(DISPLAY_STORAGE_KEY))); }
  catch { return { ...DISPLAY_DEFAULTS }; }
}
export function saveDisplaySettings(value) {
  const settings = normalizeDisplay(value);
  try {
    localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent('resolver-display-preferences'));
    return true;
  } catch { return false; }
}
export function onDisplaySettingsChange(callback) {
  window.addEventListener('storage', (event) => { if (event.key === DISPLAY_STORAGE_KEY || event.key === null) callback(); });
  window.addEventListener('resolver-display-preferences', callback);
}
