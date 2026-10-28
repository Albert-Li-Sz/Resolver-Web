import { readJSONResponse } from './http.js';

const root = document.querySelector('main');
if (root) {
  const panel = document.createElement('section');
  panel.className = 'recovery-banner'; panel.hidden = true;
  panel.innerHTML = '<div><strong>上次直播已保存</strong><p id="live-detail"></p></div><button type="button" class="btn btn-primary" id="resume-live">继续上次滚榜</button>';
  root.prepend(panel);
  const button = panel.querySelector('button');
  const detail = panel.querySelector('p');
  async function refresh() {
    try {
      const { session } = await readJSONResponse(await fetch('/api/live', { cache: 'no-store', signal: AbortSignal.timeout(8000) }));
      panel.hidden = !session;
      if (session) detail.textContent = `${session.name} · ${session.playback.currentAction} / ${session.playback.totalActions} 步 · 恢复后暂停，等待主持操作`;
    } catch { /* The main connection banner handles an unavailable service. */ }
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const data = await readJSONResponse(await fetch('/api/live/resume', { method: 'POST', signal: AbortSignal.timeout(8000) }));
      location.assign(`/play.html?id=${encodeURIComponent(data.id)}#control=${encodeURIComponent(data.controlToken)}`);
    } catch (err) { detail.textContent = `恢复失败：${err.message}，请重试。`; }
    finally { button.disabled = false; }
  });
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  refresh();
}
