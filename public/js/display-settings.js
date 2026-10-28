const KEY = 'resolver.display.v1';
export const DISPLAY_DEFAULTS = { region: 'full', x: 0, y: 0, width: 100, height: 100, margin: 0, aspect: '16:9' };
export const REGIONS = { full: [0, 0, 100, 100], top: [0, 0, 100, 50], bottom: [0, 50, 100, 50],
  left: [0, 0, 50, 100], right: [50, 0, 50, 100], tl: [0, 0, 50, 50], tr: [50, 0, 50, 50],
  bl: [0, 50, 50, 50], br: [50, 50, 50, 50] };
const clamp = (n, min, max, fallback) => Math.max(min, Math.min(max, Number.isFinite(Number(n)) ? Number(n) : fallback));
export function normalizeDisplay(value = {}) {
  const region = Object.hasOwn(REGIONS, value.region) || value.region === 'custom' ? value.region : 'full';
  const x = clamp(value.x, 0, 90, 0), y = clamp(value.y, 0, 90, 0);
  return { region, x, y, width: clamp(value.width, 10, 100 - x, 100 - x), height: clamp(value.height, 10, 100 - y, 100 - y),
    margin: clamp(value.margin, 0, 15, 0), aspect: ['16:9', '4:3', '21:9', '32:9', 'auto'].includes(value.aspect) ? value.aspect : '16:9' };
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
  return { left, top, width, height, logicalWidth: Math.round(clamp(ratio * 1080, 1440, 5760, 1920)), logicalHeight: 1080 };
}

export function setupDisplay() {
  if (new URLSearchParams(location.search).get('preview') === '1') return;
  const stage = document.getElementById('stage'), screen = document.getElementById('screen');
  const button = document.getElementById('btn-display');
  if (!stage || !screen || !button) return;
  let settings;
  try { settings = normalizeDisplay(JSON.parse(localStorage.getItem(KEY)) || DISPLAY_DEFAULTS); }
  catch { settings = { ...DISPLAY_DEFAULTS }; }
  const panel = document.createElement('dialog');
  panel.className = 'display-dialog'; panel.setAttribute('aria-labelledby', 'display-title');
  panel.innerHTML = `<form method="dialog">
    <div class="help-head"><h2 id="display-title">大屏校准</h2><button class="pill-btn" value="close" aria-label="关闭校准设置">关闭</button></div>
    <p class="help-note">仅保存到本浏览器，不改变主持进度或其他观众画面。请在连接 LED 的电脑上设置。</p>
    <label>输出区域<select name="region"><option value="full">整个屏幕</option><option value="top">上半屏</option><option value="bottom">下半屏</option><option value="left">左半屏</option><option value="right">右半屏</option><option value="tl">左上四分之一</option><option value="tr">右上四分之一</option><option value="bl">左下四分之一</option><option value="br">右下四分之一</option><option value="custom">自定义区域</option></select></label>
    <fieldset id="display-custom"><legend>区域百分比</legend><div class="display-grid"><label>左边距 %<input name="x" type="number" min="0" max="90" step="0.1"></label><label>上边距 %<input name="y" type="number" min="0" max="90" step="0.1"></label><label>宽度 %<input name="width" type="number" min="10" max="100" step="0.1"></label><label>高度 %<input name="height" type="number" min="10" max="100" step="0.1"></label></div></fieldset>
    <div class="display-grid"><label>画面比例<select name="aspect"><option value="16:9">16:9（标准）</option><option value="4:3">4:3</option><option value="21:9">21:9</option><option value="32:9">32:9（超宽屏）</option><option value="auto">适应输出区域</option></select></label><label>安全边距 %<input name="margin" type="number" min="0" max="15" step="0.5"></label></div>
    <p id="display-size" class="help-note" role="status"></p><p id="display-storage" class="help-note" role="status"></p>
    <p class="help-note">LED 只接收电脑上半屏时，选择「上半屏」与「32:9」。比例调整会重新排版，校徽与文字保持等比。建议超宽屏减少显示行数。</p>
    <div class="share-actions"><button type="button" class="pill-btn" id="display-test">显示校准图</button><button type="button" class="pill-btn" id="display-reset">恢复默认</button></div>
  </form>`;
  document.body.append(panel);
  const test = document.createElement('canvas'); test.id = 'calibration'; test.hidden = true;
  test.setAttribute('aria-label', 'LED 四角、网格、中文与长队名校准图'); stage.append(test);
  let current;
  function drawTest() {
    test.width = current.logicalWidth; test.height = current.logicalHeight;
    const ctx = test.getContext('2d'), w = test.width, h = test.height;
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
    ctx.fillText(`${w} × ${h} · 四角与绿色边框应完整可见`, w / 2, h / 2 + 80);
    ctx.fillText('C 返回设置 · Esc 退出校准 · F 全屏', w / 2, h / 2 + 150);
  }
  function apply() {
    current = displayGeometry(settings, window.innerWidth, window.innerHeight);
    Object.assign(stage.style, { inset: 'auto', left: `${current.left}px`, top: `${current.top}px`, width: `${current.width}px`, height: `${current.height}px` });
    screen.dataset.logicalWidth = String(current.logicalWidth);
    window.dispatchEvent(new CustomEvent('resolver-display'));
    panel.querySelector('#display-custom').hidden = settings.region !== 'custom';
    panel.querySelector('#display-size').textContent = `输出区域 ${Math.round(current.width)} × ${Math.round(current.height)} px · 排版 ${current.logicalWidth} × 1080`;
    drawTest();
  }
  function fill() { for (const [key, value] of Object.entries(settings)) panel.querySelector(`[name="${key}"]`).value = value; }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); panel.querySelector('#display-storage').textContent = ''; }
    catch { panel.querySelector('#display-storage').textContent = '浏览器无法保存设置，本次仍生效，重开后需重新校准。'; }
  }
  function open() {
    window.dispatchEvent(new CustomEvent('resolver-calibrating'));
    fill(); panel.showModal(); document.body.classList.add('display-open');
  }
  function close() { panel.close(); test.hidden = true; document.body.classList.remove('display-open'); button.focus(); }
  panel.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); close(); });
  panel.addEventListener('close', () => { document.body.classList.toggle('display-open', !test.hidden); });
  panel.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  panel.addEventListener('change', () => {
    settings = normalizeDisplay(Object.fromEntries(new FormData(panel.querySelector('form')))); fill(); save(); apply();
  });
  panel.querySelector('#display-test').addEventListener('click', () => { test.hidden = false; panel.close(); document.body.classList.add('display-open'); });
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
  fill(); apply();
}

if (typeof document !== 'undefined') setupDisplay();
