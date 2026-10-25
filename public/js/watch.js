import { ResolverView } from './render/resolver-view.js';
import { readJSONResponse } from './http.js';

const id = new URLSearchParams(location.search).get('id');
const $ = (name) => document.getElementById(name);
let game = null;
let view = null;
let playback = null;
let source = null;
let idleTimer = 0;
let lastFrame = performance.now();
let booting = false;
let checkingSession = false;
let reconnectTimer;
let reconnectAttempts = 0;
let terminal = false;

function status(text, disconnected = false) {
  $('connection-status').textContent = text;
  document.body.classList.toggle('disconnected', disconnected);
  if (disconnected) document.body.classList.remove('idle');
}

function progress(next) {
  $('error').hidden = true;
  $('loading').hidden = true;
  playback = next;
  $('hud-step-count').textContent = `${next.currentAction} / ${next.totalActions}`;
  $('progress-bar').style.width = `${next.totalActions ? next.currentAction / next.totalActions * 100 : 0}%`;
  status(next.currentAction >= next.totalActions ? '滚榜结束 · 可留屏观看' : '已同步 · 跟随主持端');
}

function snapshot(data) {
  if (playback && data.playback.revision <= playback.revision) { progress(playback); return; }
  game = data.game;
  if (!view) view = new ResolverView($('screen'), game);
  view.seek(game.steps, game.steps.length - 1);
  progress(data.playback);
}

function scheduleReconnect() {
  if (terminal || reconnectTimer || navigator.onLine === false) return;
  const delay = Math.min(15_000, 500 * 2 ** Math.min(reconnectAttempts++, 5));
  if (reconnectAttempts >= 5) showError('连接仍未恢复，正在自动重试；也可点击重试。');
  reconnectTimer = setTimeout(() => { reconnectTimer = null; if (view) connect(); else boot(); }, delay);
}

function connect() {
  if (terminal) return;
  clearTimeout(reconnectTimer); reconnectTimer = null;
  source?.close();
  source = new EventSource(`/api/watch/${encodeURIComponent(id)}/events`);
  const stream = source;
  source.onopen = () => {
    if (source !== stream) return;
    reconnectAttempts = 0;
    clearTimeout(reconnectTimer); reconnectTimer = null;
  };
  source.addEventListener('snapshot', (event) => {
    if (source !== stream) return;
    snapshot(JSON.parse(event.data));
    activity();
  });
  source.addEventListener('advance', (event) => {
    const data = JSON.parse(event.data);
    if (source !== stream || !playback) return;
    if (data.playback.revision <= playback.revision) return;
    if (data.playback.revision !== playback.revision + 1) {
      connect(); // A fresh connection receives a complete authoritative snapshot.
      return;
    }
    for (const step of data.steps) view.applyStep(step);
    progress(data.playback);
  });
  source.addEventListener('expired', () => {
    terminal = true;
    clearTimeout(reconnectTimer);
    source.close();
    showError('滚榜会话已过期，请向组织者获取新的观众链接。');
  });
  source.onerror = async () => {
    if (source !== stream || terminal) return;
    status('连接中断 · 正在重连', true);
    stream.close();
    scheduleReconnect();
    if (checkingSession || navigator.onLine === false) return;
    checkingSession = true;
    try {
      const response = await fetch(`/api/watch/${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (response.status === 404 && source === stream) {
        terminal = true;
        clearTimeout(reconnectTimer);
        stream.close();
        showError('滚榜会话不存在或已过期，请向组织者获取新的观众链接。');
      }
    } catch { /* The bounded timer also recovers CLOSED EventSource instances. */ }
    finally { checkingSession = false; }
  };
}

function showError(message) {
  $('loading').hidden = true;
  $('error').hidden = false;
  $('error-message').textContent = message;
  document.body.classList.remove('is-loading');
}

async function boot() {
  if (booting) return;
  if (!id) return showError('链接中缺少会话 ID，请使用组织者提供的完整观众链接。');
  booting = true;
  terminal = false;
  source?.close();
  $('error').hidden = true;
  $('loading').hidden = false;
  try {
    const response = await fetch(`/api/watch/${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (response.status === 404) terminal = true;
    const data = await readJSONResponse(response);
    await document.fonts.load('700 40px "Helvetica Plain"').catch(() => {});
    playback = null;
    snapshot(data);
    $('hud-contest').textContent = game.contest.formalName || game.contest.name;
    $('loading').hidden = true;
    $('hud').hidden = false;
    document.body.classList.remove('is-loading');
    connect();
    activity();
  } catch (err) {
    showError(err.name === 'TimeoutError' ? '连接超时，请检查网络后重试。' : err.message);
    scheduleReconnect();
  } finally { booting = false; }
}

function activity() {
  clearTimeout(idleTimer);
  document.body.classList.remove('idle');
  idleTimer = setTimeout(() => {
    if (!document.body.classList.contains('disconnected')) document.body.classList.add('idle');
  }, 2800);
}

function fullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => status('浏览器阻止全屏，请使用浏览器菜单'));
}

document.addEventListener('fullscreenchange', () => {
  $('btn-full').textContent = document.fullscreenElement ? '退出全屏 (F)' : '全屏 (F)';
  activity();
});
$('retry').addEventListener('click', boot);
$('btn-full').addEventListener('click', fullscreen);
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'f') fullscreen();
  if (event.key === 'Escape' && document.fullscreenElement) document.exitFullscreen?.();
  // Spectators have no step controls, even via presenter keyboard shortcuts.
});
window.addEventListener('pointermove', activity, { passive: true });
window.addEventListener('pointerdown', activity, { passive: true });
window.addEventListener('offline', () => {
  source?.close();
  status('连接中断 · 正在重连', true);
});
window.addEventListener('online', () => { if (!terminal) { if (view) connect(); else boot(); } });
document.addEventListener('visibilitychange', () => {
  lastFrame = performance.now();
  if (!document.hidden && view && !terminal && (!source || source.readyState === EventSource.CLOSED)) scheduleReconnect();
});
window.addEventListener('pagehide', () => { clearTimeout(reconnectTimer); reconnectTimer = null; source?.close(); });
window.addEventListener('pageshow', (event) => { if (event.persisted && view) connect(); });
// Read-only diagnostics, useful for checking synchronisation during a rehearsal.
window.ICPCSpectator = { get view() { return view; }, get playback() { return playback; } };
function frame(now) {
  const dt = Math.min(64, Math.max(0, now - lastFrame));
  lastFrame = now;
  view?.update(dt);
  view?.render(now);
  requestAnimationFrame(frame);
}
boot();
requestAnimationFrame(frame);
