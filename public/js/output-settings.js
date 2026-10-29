import { displayGeometry, renderDimensions, readDisplaySettings, saveDisplaySettings, onDisplaySettingsChange } from './display-preferences.js';

const select = document.getElementById('renderResolution');
if (select) {
  const info = document.getElementById('renderResolutionInfo');
  const error = document.getElementById('renderResolutionError');
  function sync() {
    const settings = readDisplaySettings();
    select.value = settings.resolution;
    const geometry = displayGeometry(settings, window.innerWidth, window.innerHeight);
    const pixels = renderDimensions(geometry.logicalWidth, settings.resolution);
    info.textContent = `${pixels.width} × ${pixels.height} px`;
  }
  select.addEventListener('change', () => {
    const settings = { ...readDisplaySettings(), resolution: select.value };
    error.hidden = saveDisplaySettings(settings);
    if (!error.hidden) error.textContent = '浏览器无法保存设置。请在滚榜页面的「画面设置」中选择分辨率。';
    sync();
  });
  onDisplaySettingsChange(sync);
  window.addEventListener('resize', sync);
  sync();
}
