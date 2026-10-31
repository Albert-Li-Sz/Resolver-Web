const select = document.getElementById('workspaceSelect');
const button = document.getElementById('workspaceImportBtn');
const cancel = document.getElementById('workspaceCancelBtn');
const download = document.getElementById('workspaceDownload');
const status = document.getElementById('workspaceImportStatus');
let job = null, running = false, timer;
async function request(path, options) {
  const r = await fetch(`/api${path}`, { ...options, signal: AbortSignal.timeout(15000) });
  const result = await r.json();
  if (!r.ok) throw Error(result.error || `HTTP ${r.status}`);
  return result;
}
async function load() {
  try {
    const state = await request('/platform');
    select.replaceChildren(...state.workspaces.map(w => {
      const option = document.createElement('option'); option.value = w.id; option.textContent = w.name; return option;
    }));
    if (state.activeWorkspaceId) select.value = state.activeWorkspaceId;
    button.disabled = !select.value;
    if (!select.value) status.textContent = '请先在赛事中心配置 CCS 连接，也可直接上传 NDJSON。';
  } catch { status.textContent = '赛事中心暂不可用，可手动上传 NDJSON。'; }
}
function finish() { running = false; button.disabled = !select.value; select.disabled = false; cancel.hidden = true; }
async function poll() {
  if (!running || !job) return;
  try {
    const v = await request(`/workspaces/${job.workspaceId}/resolver-exports/${job.id}`);
    if (!running) return;
    status.textContent = `已获取 ${v.events} 条事件 · ${(v.bytes / 1024).toFixed(0)} KB`;
    if (v.state === 'complete') {
      finish();
      download.href = `/api/workspaces/${job.workspaceId}/resolver-exports/${v.archiveId}/feed`;
      download.hidden = false;
      status.textContent = '完整 NDJSON 已获取，等待载入。';
      document.dispatchEvent(new CustomEvent('resolver:workspace-import', { detail: { contest: v.contest, sourceName: 'CCS 赛后 NDJSON', done: accepted => { status.textContent = accepted ? '已载入独立滚榜快照。' : 'NDJSON 已保留，可下载；当前滚榜数据未变。'; } } }));
    } else if (v.state === 'error' || v.state === 'cancelled') {
      finish(); status.textContent = v.error || '获取已取消，原滚榜数据未变。';
    } else timer = setTimeout(poll, 500);
  } catch (e) { finish(); status.textContent = `获取状态失败：${e.message}。原滚榜数据未变。`; }
}
button.addEventListener('click', async () => {
  if (running || !select.value) return;
  running = true; button.disabled = true; select.disabled = true; download.hidden = true; status.textContent = '正在从 CCS 获取完整赛后事件流…';
  try {
    job = await request(`/workspaces/${select.value}/resolver-exports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    cancel.hidden = false; void poll();
  } catch (e) { finish(); status.textContent = e.message; }
});
cancel.addEventListener('click', async () => {
  if (!job) return;
  try {
    await request(`/workspaces/${job.workspaceId}/resolver-exports/${job.id}`, { method: 'DELETE' });
    clearTimeout(timer); finish(); status.textContent = '获取已取消，原滚榜数据未变。';
  } catch (e) { status.textContent = `取消失败：${e.message}`; }
});
select.addEventListener('change', () => { button.disabled = !select.value; download.hidden = true; });
window.addEventListener('pagehide', () => clearTimeout(timer));
void load();
