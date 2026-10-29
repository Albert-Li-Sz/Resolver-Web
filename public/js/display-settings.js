import { DISPLAY_DEFAULTS, displayGeometry, normalizeDisplay, readDisplaySettings, saveDisplaySettings, onDisplaySettingsChange, renderDimensions } from './display-preferences.js';
export { DISPLAY_DEFAULTS, REGIONS, displayGeometry, normalizeDisplay } from './display-preferences.js';

export function setupDisplay() {
  if (new URLSearchParams(location.search).get('preview') === '1') return;
  const stage = document.getElementById('stage'), screen = document.getElementById('screen');
  const button = document.getElementById('btn-display');
  if (!stage || !screen || !button) return;
  let settings = readDisplaySettings();
  const panel = document.createElement('dialog');
  panel.className = 'display-dialog'; panel.setAttribute('aria-labelledby', 'display-title');
  panel.innerHTML = `<form method="dialog">
    <div class="help-head"><h2 id="display-title">画面设置</h2><button class="pill-btn" value="close" aria-label="关闭校准设置">关闭</button></div>
    <p class="help-note">设置保存在本浏览器；观众屏需单独设置。</p>
    <label>渲染分辨率<select name="resolution"><option value="1080p">1080p · 1920 × 1080</option><option value="1440p">2K · 2560 × 1440（推荐）</option><option value="2160p">4K · 3840 × 2160</option></select></label>
    <label>输出区域<select name="region"><option value="full">整个屏幕</option><option value="top">上半屏</option><option value="bottom">下半屏</option><option value="left">左半屏</option><option value="right">右半屏</option><option value="tl">左上四分之一</option><option value="tr">右上四分之一</option><option value="bl">左下四分之一</option><option value="br">右下四分之一</option><option value="custom">自定义区域</option></select></label>
    <fieldset id="display-custom"><legend>区域百分比</legend><div class="display-grid"><label>左边距 %<input name="x" type="number" min="0" max="90" step="0.1"></label><label>上边距 %<input name="y" type="number" min="0" max="90" step="0.1"></label><label>宽度 %<input name="width" type="number" min="10" max="100" step="0.1"></label><label>高度 %<input name="height" type="number" min="10" max="100" step="0.1"></label></div></fieldset>
    <div class="display-grid"><label>画面比例<select name="aspect"><option value="16:9">16:9（标准）</option><option value="4:3">4:3</option><option value="21:9">21:9</option><option value="32:9">32:9（超宽屏）</option><option value="auto">适应输出区域</option></select></label><label>安全边距 %<input name="margin" type="number" min="0" max="15" step="0.5"></label></div>
    <p id="display-size" class="help-note" role="status"></p><p id="display-storage" class="help-note" role="status"></p>
    <p class="help-note">分辨率按 16:9 标注，实际像素随比例调整。使用校准图检查 LED 边界。</p>
    <div class="share-actions"><button type="button" class="pill-btn" id="display-test">显示校准图</button><button type="button" class="pill-btn" id="display-reset">恢复默认</button></div>
  </form>`;
  document.body.append(panel);
  const test = document.createElement('canvas'); test.id = 'calibration'; test.hidden = true;
  test.setAttribute('aria-label', 'LED 四角、网格、中文与长队名校准图'); stage.append(test);
  let current;
  function drawTest() {
    const pixels = renderDimensions(current.logicalWidth, settings.resolution);
    test.width = pixels.width; test.height = pixels.height;
    const ctx = test.getContext('2d'), w = current.logicalWidth, h = current.logicalHeight;
    ctx.setTransform(pixels.width / w, 0, 0, pixels.height / h, 0, 0);
    ctx.fillStyle = '#091321'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#33485c'; ctx.lineWidth = 2;
    for (let x = 0; x <= w; x += w / 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += h / 9) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = '#68e9bc'; ctx.lineWidth = 12; ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 42px sans-serif';
    ctx.fillText('左上 · 1', 32, 70); ctx.textAlign = 'right'; ctx.fillText('右上 · 2', w - 32, 70);
    ctx.fillText('右下 · 4', w - 32, h - 32); ctx.textAlign = 'left'; ctx.fillText('左下 · 3', 32, h - 32);
    ctx.textAlign = 'center'; ctx.font = 'bold 56px sans-serif'; ctx.fillText('ICPC 大屏校准', w / 2, h / 2 - 100);
    ctx.font = '36px sans-serif'; ctx.fillText('南京晓庄学院 · 一支名字很长的参赛队伍 · Team 0123456789', w / 2, h / 2, w - 100);
    ctx.fillText(`${test.width} × ${test.height} · 四角与绿色边框应完整可见`, w / 2, h / 2 + 80);
    ctx.fillText('C 返回设置 · Esc 退出校准 · F 全屏', w / 2, h / 2 + 150);
  }
  function apply() {
    current = displayGeometry(settings, window.innerWidth, window.innerHeight);
    Object.assign(stage.style, { inset: 'auto', left: `${current.left}px`, top: `${current.top}px`, width: `${current.width}px`, height: `${current.height}px` });
    screen.dataset.logicalWidth = String(current.logicalWidth);
    screen.dataset.resolution = settings.resolution;
    window.dispatchEvent(new CustomEvent('resolver-display'));
    panel.querySelector('#display-custom').hidden = settings.region !== 'custom';
    const pixels = renderDimensions(current.logicalWidth, settings.resolution);
    panel.querySelector('#display-size').textContent = `实际渲染 ${pixels.width} × ${pixels.height} px · 输出区域 ${Math.round(current.width)} × ${Math.round(current.height)} px`;
    if (!test.hidden) drawTest();
  }
  function fill() { for (const [key, value] of Object.entries(settings)) panel.querySelector(`[name="${key}"]`).value = value; }
  function save() {
    panel.querySelector('#display-storage').textContent = saveDisplaySettings(settings) ? '' : '设置暂时无法保存，刷新后需重新设置。';
  }
  function open() {
    window.dispatchEvent(new CustomEvent('resolver-calibrating'));
    fill(); panel.showModal(); document.body.classList.add('display-open');
  }
  function close() { panel.close(); test.hidden = true; test.width = 0; test.height = 0; document.body.classList.remove('display-open'); button.focus(); }
  panel.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); close(); });
  panel.addEventListener('close', () => { document.body.classList.toggle('display-open', !test.hidden); });
  panel.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  panel.addEventListener('change', () => {
    settings = normalizeDisplay(Object.fromEntries(new FormData(panel.querySelector('form')))); fill(); save(); apply();
  });
  panel.querySelector('#display-test').addEventListener('click', () => { test.hidden = false; drawTest(); panel.close(); document.body.classList.add('display-open'); });
  panel.querySelector('#display-reset').addEventListener('click', () => { settings = { ...DISPLAY_DEFAULTS }; fill(); save(); apply(); });
  button.addEventListener('click', open);
  window.addEventListener('resize', apply);
  window.addEventListener('keydown', (event) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName);
    if (event.key.toLowerCase() === 'c' && !typing) { event.preventDefault(); event.stopImmediatePropagation(); if (panel.open) close(); else open(); }
    else if (panel.open || !test.hidden) {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      // Calibration keys must never advance a presenter behind the dialog.
      if (event.key.toLowerCase() !== 'f' || panel.open) event.stopImmediatePropagation();
    }
  }, true);
  onDisplaySettingsChange(() => { settings = readDisplaySettings(); fill(); apply(); });
  fill(); apply();
}

if (typeof document !== 'undefined') setupDisplay();
