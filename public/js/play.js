import { actionIndicesFor, startIndexFor } from './playback-model.js';
import { ResolverView } from './render/resolver-view.js';
import { readJSONResponse } from './http.js';

const params = new URLSearchParams(location.search);
const gameId = params.get('id');
const isPreview = params.get('preview') === '1';
const tokenKey = `resolver.control.${gameId}`;
let controlToken = new URLSearchParams(location.hash.slice(1)).get('control');
try {
  if (controlToken) sessionStorage.setItem(tokenKey, controlToken);
  else controlToken = sessionStorage.getItem(tokenKey);
} catch { /* the original presenter URL still works when storage is unavailable */ }
// Keep the capability out of copied spectator URLs and browser referrers.
try {
  if (controlToken && location.hash && sessionStorage.getItem(tokenKey) === controlToken) {
    history.replaceState(null, '', location.pathname + location.search);
  }
} catch { /* preserve the URL token as a refresh fallback */ }
let revision = 0;
let transitioning = false;
let ended = false;
let pollTimer;
const canvas = document.getElementById('screen');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const errorMessageEl = document.getElementById('error-message');
const hudEl = document.getElementById('hud');
const controlsWrap = document.getElementById('controls-wrap');
const controlsEl = document.getElementById('controls');
const helpEl = document.getElementById('help');
const toastEl = document.getElementById('toast');
const progressBar = document.getElementById('progress-bar');
const hudContest = document.getElementById('hud-contest');
const hudStep = document.getElementById('hud-step');
const hudStepCount = document.getElementById('hud-step-count');
const hudSpeed = document.getElementById('hud-speed');
const hudPreview = document.getElementById('hud-preview');
const btnNext = document.getElementById('btn-next');
const btnPrev = document.getElementById('btn-prev');
const btnRestart = document.getElementById('btn-restart');
const btnHelp = document.getElementById('btn-help');
const btnFull = document.getElementById('btn-full');

let game = null;
let view = null;
let steps = [];
let actionIndices = [];
let actionPos = -1;
let index = -1;
let mode = 'idle'; // idle | paused | end
let lastFrame = performance.now();
let hideTimer = 0;
let toastTimer = 0;
let lastAppliedStep = null;
let fsBarTimer = 0;
let lastPointerY = null;

const FS_HOT_ZONE_PX = 150; // distance from the bottom edge that reveals the bar
const FS_HIDE_DELAY_MS = 450;

const teamById = new Map();

function showError(message) {
  ended = true;
  clearTimeout(pollTimer);
  loadingEl.hidden = true;
  errorEl.hidden = false;
  errorMessageEl.textContent = message || '未知错误';
  document.body.classList.remove('is-loading');
}

function toast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('is-showing');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-showing'), 1900);
}

function formatStep(step) {
  if (!step) return '准备中';
  const team = step.teamId ? teamById.get(step.teamId) : null;
  const problem = Number.isInteger(step.problemIndex) ? game?.contest?.problems?.[step.problemIndex] : null;
  switch (step.type) {
    case 'presentation':
      if (step.screen === 'splash') return '开场';
      if (step.screen === 'scoreboard') return '冻结榜单';
      if (step.screen === 'teamAward') return '奖项展示';
      if (step.screen === 'teamList') return '获奖名单';
      return '切换画面';
    case 'delay':
      return '…';
    case 'pause':
      return '等待继续';
    case 'selectTeam':
      if (!step.teamIds || step.teamIds.length === 0) return '取消聚焦';
      if (step.teamIds.length > 1) return `聚焦 ${step.teamIds.length} 支队伍`;
      return `聚焦 ${teamById.get(step.teamIds[0])?.displayName || step.teamIds[0]}`;
    case 'selectSubmission':
      return `待解析 ${team?.displayName || ''}${problem ? ` · ${problem.label}` : ''}`;
    case 'scroll':
      return `滚动至第 ${Math.max(1, step.row + 1)} 行`;
    case 'resolve': {
      const result = step.status === 'solved' ? '通过' : '失败';
      return `解析 ${team?.displayName || ''}${problem ? ` · ${problem.label}` : ''} → ${result}`;
    }
    case 'award':
      return `奖项：${team?.displayName || ''}`;
    case 'message':
      return step.text || '提示';
    default:
      return step.type;
  }
}

function updateHud() {
  if (!game || isPreview) return;
  const total = actionIndices.length;
  const current = actionPos + 1;
  progressBar.style.width = `${total ? Math.min(100, (Math.max(0, current) / total) * 100) : 0}%`;
  hudStepCount.textContent = `${Math.max(0, current)} / ${total}`;
  hudStep.textContent = mode === 'end' ? '滚榜结束（可回看）' : formatStep(lastAppliedStep);
  if (hudSpeed) hudSpeed.textContent = transitioning ? '同步中…' : '主持端';
  btnPrev.disabled = transitioning || actionPos <= 0;
  btnNext.disabled = transitioning || actionPos >= total - 1;
  btnRestart.disabled = transitioning;
  document.body.classList.toggle('is-paused', mode === 'paused' || mode === 'end');
}

function applyStep(step, { instant = false } = {}) {
  if (!step) return;
  lastAppliedStep = step;
  view.applyStep(step, { instant });
  updateHud();
}

function lastActionAtOrBefore(rawIndex) {
  let pos = -1;
  for (let i = 0; i < actionIndices.length && actionIndices[i] <= rawIndex; i += 1) pos = i;
  return pos;
}

function rebuildTo(targetIndex, { instant = true } = {}) {
  if (!view) view = new ResolverView(canvas, game);
  index = -1;
  actionPos = -1;
  lastAppliedStep = null;
  for (let i = 0; i <= targetIndex && i < steps.length; i += 1) {
    const step = steps[i];
    index = i;
    if (step.type === 'delay' || step.type === 'pause') continue;
    lastAppliedStep = step;
  }
  view.seek(steps, targetIndex);
  actionPos = lastActionAtOrBefore(index);
  mode = actionPos === actionIndices.length - 1 ? 'end' : 'paused';
  updateHud();
}

function startTarget() {
  return game ? startIndexFor(game) : -1;
}

function goToStart() {
  return moveTo(startTarget(), { instant: true });
}

async function moveTo(targetIndex, { instant = false } = {}) {
  if (!game || ended || transitioning || !actionIndices.includes(targetIndex)) return;
  if (isPreview) {
    if (instant) rebuildTo(targetIndex);
    else applyActionAt(actionIndices.indexOf(targetIndex));
    return;
  }
  transitioning = true;
  const delta = actionIndices.indexOf(targetIndex) - actionPos;
  updateHud();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(`/api/game/${encodeURIComponent(gameId)}/playback`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Resolver-Control': controlToken || '' },
      body: JSON.stringify({ index: targetIndex, revision }),
      signal: AbortSignal.timeout(8000),
    });
      const data = await response.json().catch(() => ({}));
      if (response.status === 403 || response.status === 404) {
        showError(data.error || '主持会话已结束，请返回配置中心重新开始');
        return;
      }
    if (response.status === 409) {
      revision = data.playback.revision;
      rebuildTo(data.playback.index);
      if (!instant && delta === 1) targetIndex = actionIndices[Math.min(actionIndices.length - 1, actionPos + 1)];
      else if (instant && delta === -1) targetIndex = actionIndices[Math.max(0, actionPos - 1)];
      if (attempt === 2) toast('主持进度更新频繁，已同步，请再次操作');
      continue;
    }
    if (!response.ok) throw new Error(data.error || '同步失败');
    revision = data.playback.revision;
    if (instant || actionIndices.indexOf(targetIndex) !== actionPos + 1) rebuildTo(targetIndex);
    else applyActionAt(actionIndices.indexOf(targetIndex));
      break;
    }
  } catch (err) {
    toast(`${err.name === 'TimeoutError' ? '连接超时' : err.message}，请重试`);
  } finally {
    transitioning = false;
    updateHud();
  }
}

async function syncPlayback() {
  if (ended || isPreview || !game) return;
  if (!transitioning) {
    const before = revision;
    try {
      const response = await fetch(`/api/game/${encodeURIComponent(gameId)}/playback`, {
        cache: 'no-store', headers: { 'X-Resolver-Control': controlToken || '' }, signal: AbortSignal.timeout(8000),
      });
      if ([403, 404].includes(response.status)) { showError('主持会话已结束或控制权限失效，请返回配置中心重新开始'); return; }
      const data = await readJSONResponse(response);
      if (!transitioning && revision === before && data.playback.revision > revision) {
        revision = data.playback.revision;
        rebuildTo(data.playback.index);
      }
    } catch { /* Poll again after a transient transport failure. */ }
  }
  if (!ended) pollTimer = setTimeout(syncPlayback, 2000);
}

function applyActionAt(pos) {
  if (!game || pos < 0 || pos >= actionIndices.length) return;
  const target = actionIndices[pos];
  index = target;
  applyStep(steps[target], { instant: false });
  actionPos = pos;
  mode = pos >= actionIndices.length - 1 ? 'end' : 'paused';
  updateHud();
}

function goNext() {
  if (!game) return;
  if (actionPos + 1 >= actionIndices.length) {
    mode = 'end';
    updateHud();
    return;
  }
  return moveTo(actionIndices[actionPos + 1]);
}

function goPrevious() {
  if (!game || actionPos <= 0) return;
  return moveTo(actionIndices[actionPos - 1], { instant: true });
}

function restart() {
  if (!game) return;
  return goToStart();
}

function jumpTo(targetIndex) {
  if (!game) return;
  return moveTo(targetIndex, { instant: true });
}

function toggleHelp(force) {
  const open = typeof force === 'boolean' ? force : helpEl.hidden;
  helpEl.hidden = !open;
  document.body.classList.toggle('help-open', open);
  if (open) {
    document.body.classList.remove('idle');
    clearTimeout(hideTimer);
  } else {
    scheduleIdle();
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
  } else {
    document.documentElement.requestFullscreen?.().catch(() => toast('浏览器阻止了全屏'));
  }
}

function scheduleIdle() {
  if (isPreview) return;
  clearTimeout(hideTimer);
  document.body.classList.remove('idle');
  hideTimer = setTimeout(() => {
    if (!document.body.classList.contains('help-open')) {
      document.body.classList.add('idle');
    }
  }, 2800);
}

function fullscreenBarVisible() {
  return document.body.classList.contains('fs-bar-visible');
}

function setFullscreenBarVisible(visible) {
  clearTimeout(fsBarTimer);
  fsBarTimer = 0;
  document.body.classList.toggle(
    'fs-bar-visible',
    Boolean(visible) && Boolean(document.fullscreenElement),
  );
}

function scheduleFullscreenBarHide() {
  if (!document.fullscreenElement) return;
  clearTimeout(fsBarTimer);
  fsBarTimer = setTimeout(() => {
    fsBarTimer = 0;
    if (!document.fullscreenElement) return;
    if (controlsEl?.matches(':hover') || controlsEl?.querySelector(':focus-visible')) return;
    setFullscreenBarVisible(false);
  }, FS_HIDE_DELAY_MS);
}

/*
 * Fullscreen chrome: the control bar stays out of the way and only slides back
 * in when the pointer reaches the bottom edge (or is over the bar itself).
 */
function handleFullscreenPointer() {
  if (!document.fullscreenElement) return;
  const nearBottom = lastPointerY != null && lastPointerY >= window.innerHeight - FS_HOT_ZONE_PX;
  if (nearBottom || controlsEl?.matches(':hover')) {
    setFullscreenBarVisible(true);
  } else if (fullscreenBarVisible()) {
    scheduleFullscreenBarHide();
  }
}

function onPointerActivity(event) {
  if (event && Number.isFinite(event.clientY)) lastPointerY = event.clientY;
  scheduleIdle();
  handleFullscreenPointer();
}

function boot() {
  if (!gameId) {
    showError('地址缺少滚榜会话 ID，请从配置中心重新点击「开始滚榜」。');
    return;
  }
  fetch(`/api/game/${encodeURIComponent(gameId)}`, {
    cache: 'no-store', headers: { 'X-Resolver-Control': controlToken || '' },
  })
    .then(async (res) => {
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `服务器返回 ${res.status}`);
      }
      return res.json();
    })
    .then(async (data) => {
      game = data;
      steps = Array.isArray(data.steps) ? data.steps : [];
      actionIndices = actionIndicesFor(steps);
      revision = data.playback?.revision ?? 0;
      actionPos = -1;
      for (const team of data.contest?.teams || []) teamById.set(team.id, team);
      if (isPreview) document.body.classList.add('preview');
      hudContest.textContent = data.contest?.formalName || data.contest?.name || 'ICPC Resolver';
      hudPreview.hidden = !isPreview;

      try {
        await document.fonts.load('700 40px "Helvetica Plain"');
        await document.fonts.ready;
      } catch {
        /* fall back to system fonts */
      }

      window.ICPCResolver = {
        get game() {
          return game;
        },
        get steps() {
          return steps;
        },
        get index() {
          return index;
        },
        get view() {
          return view;
        },
        next: goNext,
        prev: goPrevious,
        reset: restart,
        jumpTo(i) {
          return jumpTo(i);
        },
      };
      document.body.classList.remove('is-loading');
      loadingEl.hidden = true;
      hudEl.hidden = isPreview;
      controlsWrap.hidden = isPreview;
      if (!isPreview) {
        controlsEl.hidden = false;
        scheduleIdle();
      }

      if (isPreview) {
        // Frozen scoreboard, no auto-advance: the host page drives next/prev.
        const target = steps.findIndex((s) => s.type === 'presentation' && s.screen === 'scoreboard');
        rebuildTo(target >= 0 ? target : 0);
      } else {
        rebuildTo(data.playback?.index ?? startTarget());
        toast('手动模式：右键 / → 下一步，左键 / ← 上一步');
        syncPlayback();
      }
      view?.resize?.();
    })
    .catch((err) => {
      console.error(err);
      showError(err.message || '加载滚榜会话失败');
    });
}

function frame(now) {
  const dt = Math.min(64, Math.max(0, now - lastFrame));
  lastFrame = now;
  if (view) {
    view.update(dt);
    view.render(now);
  }
  requestAnimationFrame(frame);
}

// Wiring ---------------------------------------------------------------

btnRestart?.addEventListener('click', restart);
btnPrev?.addEventListener('click', goPrevious);
btnNext?.addEventListener('click', goNext);
btnHelp?.addEventListener('click', () => toggleHelp());
document.getElementById('help-close')?.addEventListener('click', () => toggleHelp(false));
btnFull?.addEventListener('click', toggleFullscreen);

const shareEl = document.getElementById('share');
const shareUrl = document.getElementById('share-url');
const viewerUrl = new URL(`/watch.html?id=${encodeURIComponent(gameId || '')}`, location.origin).href;
shareUrl.value = viewerUrl;
document.getElementById('open-viewer').href = viewerUrl;
document.getElementById('share-hint').textContent = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  ? '其他电脑观看：以 HOST=0.0.0.0 启动服务，将链接中的本机地址替换为服务器的局域网 IP 或域名。'
  : '将此链接发给选手，打开后即可跟随主持端观看；支持刷新与断线重连。';
document.getElementById('btn-share').addEventListener('click', () => {
  shareEl.hidden = false;
  shareUrl.focus();
  shareUrl.select();
});
document.getElementById('share-close').addEventListener('click', () => {
  shareEl.hidden = true;
  document.getElementById('btn-share').focus();
});
shareEl.addEventListener('click', (event) => { if (event.target === shareEl) shareEl.hidden = true; });
document.getElementById('copy-viewer').addEventListener('click', async () => {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(shareUrl.value);
    else {
      shareUrl.focus(); shareUrl.select();
      if (!document.execCommand('copy')) throw new Error('copy unavailable');
    }
    toast('观众链接已复制');
  } catch { shareUrl.focus(); shareUrl.select(); toast('请复制已选中的观众链接'); }
});

// Presentation controls on the stage: right click = next, left click = previous.
const stageEl = document.getElementById('stage');
stageEl?.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
  if (event.pointerType === 'mouse') goPrevious();
  else goNext();
});
window.addEventListener('pagehide', () => clearTimeout(pollTimer));
window.addEventListener('pageshow', (event) => { if (event.persisted && game && !ended) syncPlayback(); });
stageEl?.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  goNext();
});

// Keep the fullscreen control bar up while it is hovered or focused.
controlsEl?.addEventListener('pointerenter', () => {
  if (document.fullscreenElement) setFullscreenBarVisible(true);
});
controlsEl?.addEventListener('pointerleave', () => {
  if (document.fullscreenElement) scheduleFullscreenBarHide();
});
controlsEl?.addEventListener('focusin', () => {
  if (document.fullscreenElement) setFullscreenBarVisible(true);
});
controlsEl?.addEventListener('focusout', () => {
  if (document.fullscreenElement) scheduleFullscreenBarHide();
});

helpEl?.addEventListener('click', (event) => {
  if (event.target === helpEl) toggleHelp(false);
});

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

window.addEventListener('pointermove', onPointerActivity, { passive: true });
window.addEventListener('pointerdown', onPointerActivity, { passive: true });
window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented) return;
  const key = event.key;
  if (!document.getElementById('share').hidden) {
    if (key === 'Escape') document.getElementById('share').hidden = true;
    return;
  }
  if (isTypingTarget(event.target)) return;
  if (key === 'Escape') {
    if (!helpEl.hidden) {
      toggleHelp(false);
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    return;
  }
  if (!helpEl.hidden) return;
  if ([' ', 'Enter'].includes(key) && event.target instanceof Element && event.target.closest('button, a')) return;
  if (key === ' ' || key === 'Spacebar') {
    event.preventDefault();
    if (event.shiftKey) goPrevious();
    else goNext();
    return;
  }
  if (key === 'Backspace') {
    event.preventDefault();
    goPrevious();
    return;
  }
  if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === 'Enter' || key === 'n' || key === 'N') {
    event.preventDefault();
    goNext();
    return;
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') {
    event.preventDefault();
    goPrevious();
    return;
  }
  if (key === 'Home') {
    event.preventDefault();
    goToStart();
    return;
  }
  if (key === 'End') {
    event.preventDefault();
    if (actionIndices.length) jumpTo(actionIndices[actionIndices.length - 1]);
    return;
  }
  if (key === 'r' || key === 'R') {
    restart();
    return;
  }
  if (key === 'f' || key === 'F') {
    toggleFullscreen();
    return;
  }
  if (key === '?' || key === '/' || key === 'h' || key === 'H') {
    toggleHelp();
  }
});

document.addEventListener('fullscreenchange', () => {
  const fullscreen = Boolean(document.fullscreenElement);
  document.body.classList.toggle('is-fullscreen', fullscreen);
  clearTimeout(fsBarTimer);
  fsBarTimer = 0;
  document.body.classList.remove('fs-bar-visible');
  if (fullscreen && lastPointerY != null && lastPointerY >= window.innerHeight - FS_HOT_ZONE_PX) {
    // The pointer is usually still on the fullscreen button: keep the bar up
    // until the pointer leaves the bottom edge.
    setFullscreenBarVisible(true);
  }
  view?.resize?.();
});

document.addEventListener('visibilitychange', () => {
  lastFrame = performance.now();
});

boot();
requestAnimationFrame(frame);
