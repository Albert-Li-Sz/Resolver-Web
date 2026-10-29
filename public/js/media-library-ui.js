import { MEDIA_KINDS } from './media-library.js';
import { readJSONResponse } from './http.js';

const $ = (id) => document.getElementById(id);
export class MediaLibraryUI {
  constructor({ upload, apply, toast }) {
    this.items = []; this.page = 0; this.upload = upload; this.apply = apply; this.toast = toast;
    $('libraryUploadBtn')?.addEventListener('click', () => { $('libraryFiles').value = ''; $('libraryFiles').click(); });
    $('libraryFiles')?.addEventListener('change', (event) => this.saveFiles([...event.target.files]));
    $('librarySearch')?.addEventListener('input', () => { this.page = 0; this.render(); });
    $('libraryPrev')?.addEventListener('click', () => { this.page--; this.render(); });
    $('libraryNext')?.addEventListener('click', () => { this.page++; this.render(); });
    $('libraryApplyBtn')?.addEventListener('click', () => {
      const report = this.apply(this.items);
      if (report) this.showReport(report);
    });
    $('libraryList')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-library-delete]');
      if (!button) return;
      try {
        await this.request(`/api/media-library/${encodeURIComponent(button.dataset.libraryDelete)}`, { method: 'DELETE' });
        await this.load(); this.toast('匹配规则已删除，下次导入不再自动应用该规则。', 'info');
      } catch (err) { this.toast(err.message, 'error'); }
    });
  }

  async request(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000), ...options });
    return readJSONResponse(response, '素材库请求失败，请稍后重试');
  }

  async load() {
    const data = await this.request('/api/media-library');
    this.items = Array.isArray(data.items) ? data.items : []; this.render();
  }

  async saveFiles(files) {
    if (!files.length || this.busy) return;
    this.busy = true;
    const button = $('libraryUploadBtn'); button.disabled = true;
    const kind = $('libraryKind').value, matchBy = $('libraryMatch').value, key = $('libraryKey').value.trim();
    const status = $('libraryStatus'); status.hidden = false;
    const failed = []; let saved = 0;
    for (const file of files) {
      status.textContent = `正在保存 ${saved + failed.length + 1} / ${files.length}：${file.name}`;
      try {
        const matchKey = files.length === 1 && key ? key : file.name.replace(/\.[^.]+$/, '');
        const url = await this.upload(file, kind === 'team-photo' ? 1280 : 256);
        await this.request('/api/media-library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, matchBy, key: matchKey, url }) });
        saved++;
      } catch (err) { failed.push(`${file.name}：${err.message}`); }
    }
    try { await this.load(); }
    catch (err) { failed.push(`刷新列表失败：${err.message}`); }
    status.textContent = `已保存 ${saved} 项素材。${failed.length ? `失败：${failed.join('；')}` : '导入事件流后将自动精确匹配，也可应用到当前赛事。'}`;
    button.disabled = false; this.busy = false;
  }

  render() {
    const list = $('libraryList'); if (!list) return;
    list.setAttribute('role', 'list');
    const query = $('librarySearch').value.trim().toLowerCase();
    const rows = this.items.filter((record) => `${record.key} ${MEDIA_KINDS[record.kind]?.label}`.toLowerCase().includes(query)).slice().reverse();
    const pages = Math.max(1, Math.ceil(rows.length / 30)); this.page = Math.max(0, Math.min(this.page, pages - 1));
    $('libraryPage').textContent = `${this.page + 1} / ${pages} · ${rows.length} 项`;
    $('libraryPrev').disabled = this.page === 0; $('libraryNext').disabled = this.page >= pages - 1;
    list.textContent = '';
    for (const record of rows.slice(this.page * 30, (this.page + 1) * 30)) {
      const row = document.createElement('div'); row.className = 'library-row';
      row.setAttribute('role', 'listitem');
      const img = document.createElement('img'); img.src = record.url; img.alt = record.key; img.loading = 'lazy';
      const info = document.createElement('div'); const name = document.createElement('strong'); name.textContent = record.key;
      const detail = document.createElement('p'); detail.textContent = `${MEDIA_KINDS[record.kind]?.label || record.kind} · 按${record.matchBy === 'id' ? ' ID' : '名称'}匹配`; info.append(name, detail);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn btn-sm btn-secondary'; remove.textContent = '删除规则'; remove.dataset.libraryDelete = record.id; remove.setAttribute('aria-label', `删除规则：${record.key}`);
      row.append(img, info, remove); list.append(row);
    }
    if (!rows.length) list.textContent = this.items.length ? '没有匹配的素材。' : '暂无素材';
  }

  showReport(report) {
    for (const id of ['libraryReport', 'mediaImportReport']) {
      const target = $(id); if (!target) continue;
      target.hidden = !report.matched && !report.unmatched.length && !report.preserved;
      target.textContent = `素材匹配 ${report.matched} 项，未应用 ${report.unmatched.length} 项。${report.preserved ? `保留手动设置 ${report.preserved} 项。` : ''}`;
      if (report.unmatched.length) {
        const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '查看未匹配/重名条目'; details.append(summary);
        const list = document.createElement('ul');
        for (const item of report.unmatched) { const li = document.createElement('li'); li.textContent = `${MEDIA_KINDS[item.kind]?.label} · ${item.key}：${item.reason}`; list.append(li); }
        details.append(list); target.append(details);
      }
    }
  }

  clearReport() {
    for (const id of ['libraryReport', 'mediaImportReport']) {
      const target = $(id);
      if (target) { target.hidden = true; target.textContent = ''; }
    }
  }
}
