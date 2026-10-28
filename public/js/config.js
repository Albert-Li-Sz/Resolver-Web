import { prepareOfflineContest } from './offline-media.js';
import { FREEZE_DEFAULTS, normalizeFreezeOptions, withFreezeOptions } from './freeze.js';
import { applyMediaLibrary, preserveContestMedia } from './media-library.js';
import { MediaLibraryUI } from './media-library-ui.js';
import { MEDAL_DEFAULTS, normalizeMedalOptions } from './medals.js';
import { readJSONResponse } from './http.js';
import { DEFAULT_SCHOOL_LOGO, logoSource, setLogoImage, teamLogoUrl } from './logos.js';
import { applySchoolLogos } from './school-logos.js';
/* ==========================================================================
   ICPC Resolver — 滚榜配置中心
   Vanilla ES module. No frameworks, no build step.
   ========================================================================== */

const STORAGE_KEY = 'resolver.config.v1';

const API = {
  parse: '/api/parse',
  fetch: '/api/fetch',
  game: '/api/game',
  awards: '/api/awards',
  assets: '/api/assets',
  configs: '/api/configs',
};

const DEFAULT_OPTIONS = Object.freeze({
  ...MEDAL_DEFAULTS,
  ...FREEZE_DEFAULTS,
  rowsPerScreen: 12,
  speedFactor: 1,
  rowOffset: 0,
  singleStepStartRow: null,
  autoplay: true,
  pauseMs: 1100,
  showAwards: false,
  showLegend: false,
  title: null,
  startScreen: 'splash',
});

const PREVIEW_DEBOUNCE_MS = 400;
const MAX_FILE_BYTES = 38 * 1024 * 1024;
const LOGO_STRIP_LIMIT = 18;

const state = {
  contest: null,
  contestLoadToken: 0,
  stats: null,
  options: { ...DEFAULT_OPTIONS },
  optionsRestored: false,
  source: null,
  sourceName: '',
  apiOnline: null,
  configs: [],
  game: null,
  gameId: null,
  previewState: 'idle',
  previewDisabled: false,
  previewTimer: null,
  previewToken: 0,
  persistTimer: null,
  deleteTarget: null,
  quotaWarned: false,
  unpersistableContest: null,
  undo: null,
  lastPresetName: '',
  logoOriginals: new Map(),
  mediaMatchReport: null,
  busy: {
    parse: false,
    remote: false,
    preview: false,
    start: false,
    save: false,
    remove: false,
    retry: false,
  },
};

const $ = (id) => document.getElementById(id);

// Organization currently targeted by the shared logo file input.
let logoUploadOrgId = null;
let photoTeamId = null;
let teamMediaField = 'photo';
let photoPage = 0;
const photoUploads = new Map();

/* ==========================================================================
   Boot
   ========================================================================== */

const libraryUI = new MediaLibraryUI({
  upload: async (file, size) => uploadImage(await prepareLogoFile(file, size)),
  toast: showToast,
  apply: (items) => {
    if (!state.contest) { showToast('请先导入比赛或赛前名单。', 'info'); return null; }
    const report = applyMediaLibrary(state.contest, items);
    state.contest = report.contest; state.mediaMatchReport = { matched: report.matched, unmatched: report.unmatched }; renderSummary(); schedulePersist(); schedulePreview(0); return report;
  },
});
init();

function init() {
  bindEvents();

  const saved = readSavedState();
  if (saved && saved.options) {
    state.options = saved.options;
    state.optionsRestored = true;
  }
  state.lastPresetName = saved && saved.lastPresetName ? saved.lastPresetName : '';
  state.mediaMatchReport = saved?.mediaMatchReport || null;
  syncOptionControls();
  updateOptionOutputs();
  renderConfigs({ loading: true });
  boot(saved);
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    clearTimeout(state.persistTimer); state.persistTimer = null;
    const current = readSavedState();
    if (!current) return;
    state.contestLoadToken++;
    rememberState();
    if (current.options) state.options = current.options;
    state.lastPresetName = current.lastPresetName;
    if (current.contest) applyContest(current.contest, { stats: current.stats, source: 'saved', sourceName: '其他标签页同步' });
    state.mediaMatchReport = current.mediaMatchReport;
    syncOptionControls(); renderSummary();
    // Applying remote state must not create a storage-event feedback loop.
    clearTimeout(state.persistTimer); state.persistTimer = null;
    showToast('已同步其他标签页的配置，可撤销恢复同步前的内容。', 'info');
  });
}

function rememberState() {
  if (!state.contest || state.source === 'offline') return;
  state.undo = { contest: structuredClone(state.contest), options: { ...state.options }, stats: state.stats,
    source: state.source, sourceName: state.sourceName, mediaMatchReport: state.mediaMatchReport, lastPresetName: state.lastPresetName };
  let button = $('undoContestBtn');
  if (!button) {
    button = document.createElement('button'); button.id = 'undoContestBtn'; button.type = 'button';
    button.className = 'btn btn-secondary'; button.textContent = '撤销载入';
    $('startBtn').before(button);
    button.addEventListener('click', () => {
      const backup = state.undo;
      if (!backup) return;
      state.undo = null;
      state.options = backup.options;
      state.lastPresetName = backup.lastPresetName;
      applyContest(backup.contest, backup);
      state.mediaMatchReport = backup.mediaMatchReport;
      renderSummary(); schedulePersist(); button.hidden = true;
      showToast('已恢复载入前的赛事、选项与手动素材。', 'success');
    });
  }
  button.hidden = false;
}

function confirmReplacement(label) {
  if (!state.contest || state.source === 'offline') return true;
  if (!window.confirm(`${label}将替换当前赛事或选项。当前内容将保留一份可撤销备份，是否继续？`)) return false;
  rememberState();
  return true;
}

function usableContest() {
  return state.contest && state.source !== 'offline' && !state.previewDisabled;
}

async function boot(saved) {
  const token = state.contestLoadToken;
  await loadConfigs({ silent: true, keepLoading: true });
  if (state.apiOnline) {
    try { await libraryUI.load(); }
    catch (err) { showToast(`赛前素材库加载失败：${err.message}`, 'error'); }
  }
  if (token !== state.contestLoadToken) return;

  if (state.apiOnline) {
    if (saved && saved.contest) {
      applyContest(saved.contest, {
        stats: saved.stats,
        source: 'saved',
        sourceName: '本地恢复',
        mediaMatchReport: saved.mediaMatchReport,
      });
    } else {
      renderSummary();
      setPreviewState('empty');
    }
  } else {
    if (saved && saved.contest) {
      applyContest(saved.contest, {
        stats: saved.stats,
        source: 'saved',
        sourceName: '本地恢复',
        mediaMatchReport: saved.mediaMatchReport,
      });
    } else {
      renderSummary();
      setPreviewState('empty');
    }
    if (!state.contest) {
      setPreviewState('empty');
    }
  }
}

/* ==========================================================================
   Persistence
   ========================================================================== */

function readSavedState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    // v1 stored the single-step row as a 1-based UI value; v2 stores the
    // zero-based engine value. Migrate old local state so the displayed
    // 名次 does not shift by one after this update.
    const savedOptions =
      parsed.options && typeof parsed.options === 'object' ? { ...parsed.options } : null;
    if (savedOptions && Number(parsed.version || 1) < 2) {
      const legacyStep = Number(savedOptions.singleStepStartRow);
      if (Number.isFinite(legacyStep) && legacyStep > 0) {
        savedOptions.singleStepStartRow = legacyStep - 1;
      }
    }

    return {
      options: savedOptions
        ? sanitizeOptions(savedOptions, { singleStepIsEngine: true })
        : null,
      contest: isContestLike(parsed.contest) ? parsed.contest : null,
      stats: parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : null,
      mediaMatchReport: parsed.mediaMatchReport || null,
      lastPresetName: typeof parsed.lastPresetName === 'string' ? parsed.lastPresetName : '',
    };
  } catch (err) {
    return null;
  }
}

function schedulePersist() {
  clearTimeout(state.persistTimer);
  state.persistTimer = setTimeout(flushPersist, 180);
}

function flushPersist() {
  clearTimeout(state.persistTimer);
  state.persistTimer = null;

  const payload = {
    version: 2,
    options: state.options,
    lastPresetName: state.lastPresetName,
    savedAt: Date.now(),
    mediaMatchReport: state.mediaMatchReport,
  };

  // Never restore the synthetic offline contest as if it were real data.
  if (state.contest && state.source !== 'offline' && state.unpersistableContest !== state.contest) {
    payload.contest = state.contest;
    if (state.stats) payload.stats = state.stats;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    // Large contests can exceed the quota: keep the options, drop the contest.
    if (payload.contest) state.unpersistableContest = state.contest;
    try {
      delete payload.contest;
      delete payload.stats;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (ignored) {
      // Storage can be unavailable in private modes; the UI still works.
    }
    if (!state.quotaWarned) {
      state.quotaWarned = true;
      showToast('浏览器存储空间不足，本次会话仍可正常使用。', 'info');
    }
  }
}

/* ==========================================================================
   Option normalization / controls
   ========================================================================== */

function sanitizeOptions(raw, { singleStepIsEngine = false } = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const options = { ...DEFAULT_OPTIONS, ...normalizeMedalOptions(source), ...normalizeFreezeOptions(source) };

  const rows = Number(source.rowsPerScreen);
  if (rows === 9 || rows === 12 || rows === 15) options.rowsPerScreen = rows;

  const speed = Number(source.speedFactor);
  if (Number.isFinite(speed)) {
    options.speedFactor = clamp(Math.round(speed * 4) / 4, 0.25, 3);
  }

  const offset = Number(source.rowOffset);
  if (Number.isFinite(offset)) options.rowOffset = clamp(Math.round(offset), 0, 8);

  // The engine consumes a ZERO-BASED row index (currentRow <= value).
  // The dashboard field is 1-based (名次), so UI value n is stored as n - 1.
  // Options coming from the engine (demo/preset/local state) already use the
  // zero-based form and are only clamped.
  const step = source.singleStepStartRow;
  if (step === null || step === undefined || step === '') {
    options.singleStepStartRow = null;
  } else {
    const n = Math.round(Number(step));
    if (!Number.isFinite(n)) {
      options.singleStepStartRow = null;
    } else if (singleStepIsEngine) {
      options.singleStepStartRow = n >= 0 ? clamp(n, 0, 9999) : null;
    } else {
      options.singleStepStartRow = n > 0 ? clamp(n - 1, 0, 9999) : null;
    }
  }

  if (typeof source.autoplay === 'boolean') options.autoplay = source.autoplay;
  if (typeof source.showAwards === 'boolean') options.showAwards = source.showAwards;
  if (typeof source.showLegend === 'boolean') options.showLegend = source.showLegend;

  const pause = Number(source.pauseMs);
  if (Number.isFinite(pause)) {
    options.pauseMs = clamp(Math.round(pause / 100) * 100, 400, 3000);
  }

  if (source.startScreen === 'splash' || source.startScreen === 'scoreboard') {
    options.startScreen = source.startScreen;
  }

  if (typeof source.title === 'string') {
    const title = source.title.trim().slice(0, 80);
    options.title = title || null;
  } else {
    options.title = null;
  }

  return options;
}

function syncOptionControls() {
  const o = state.options;
  const setValue = (id, value) => {
    const el = $(id);
    if (el) el.value = value;
  };
  const setChecked = (id, value) => {
    const el = $(id);
    if (el) el.checked = Boolean(value);
  };
  setValue('rowsPerScreen', String(o.rowsPerScreen));
  setValue('rowOffset', String(o.rowOffset));
  setValue('startScreen', o.startScreen);
  setValue('freezeMode', o.freezeMode);
  setValue('freezeMinutes', o.freezeMinutes);
  if ($('freezeMinutes')) $('freezeMinutes').disabled = o.freezeMode !== 'custom';
  setChecked('showAwards', o.showAwards);
  setChecked('showLegend', o.showLegend);
  for (const id of ['medalMode', 'goldCount', 'silverCount', 'bronzeCount', 'goldCitation', 'silverCitation', 'bronzeCitation']) setValue(id, o[id]);
  setChecked('medalSameScore', o.medalSameScore);
  if ($('medalFields')) $('medalFields').disabled = o.medalMode !== 'custom';
  setChecked('podiumEnabled', o.podiumEnabled);
  for (const id of ['championCitation', 'runnerUpCitation', 'thirdPlaceCitation', 'firstSolveMode']) setValue(id, o[id]);
  if ($('podiumFields')) $('podiumFields').disabled = !o.podiumEnabled;
  setChecked('firstSolveIncludeUnrank', o.firstSolveIncludeUnrank);
  if ($('firstSolveFields')) $('firstSolveFields').disabled = o.firstSolveMode === 'imported';
  if ($('firstSolveProblemPicker')) $('firstSolveProblemPicker').hidden = o.firstSolveMode !== 'selected';
  renderFirstSolveProblems();
  setValue('title', o.title || '');
  updateOptionOutputs();
}

function renderFirstSolveProblems() {
  const list = $('firstSolveProblemList');
  if (!list) return;
  list.textContent = '';
  const problems = state.contest?.problems || [];
  if (!problems.length) {
    const hint = document.createElement('p'); hint.className = 'field-hint'; hint.textContent = '载入赛事后可选择题目。';
    list.append(hint); return;
  }
  const selected = new Set(state.options.firstSolveProblemIds);
  for (const problem of problems) {
    const label = document.createElement('label'); label.className = 'problem-choice';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = problem.id;
    input.dataset.problemId = problem.id; input.checked = selected.has(problem.id);
    const text = document.createElement('span');
    text.textContent = `${problem.label || problem.id} 题${problem.name ? ` · ${problem.name}` : ''}`;
    label.append(input, text); list.append(label);
  }
}

function updateOptionOutputs() {
  const o = state.options;
  const freezeHint = $('freezeHint');
  if (freezeHint) {
    if (!state.contest) freezeHint.textContent = '载入比赛后可设置封榜时间。';
    else {
      if ($('freezeMinutes')) $('freezeMinutes').max = state.contest.durationMs / 60000;
      try {
        const contest = withFreezeOptions(state.contest, o);
        const minutes = contest.freezeDurationMs / 60000;
        freezeHint.textContent = minutes > 0
          ? `${contest.freezeSource === 'history' ? '已找回历史封榜记录。' : ''}按最后 ${minutes} 分钟还原封榜；封榜时点为比赛开始后 ${(contest.durationMs - contest.freezeDurationMs) / 60000} 分钟。`
          : '文件没有可用封榜记录。若已解封，可切换“手动还原封榜”设置封榜时长。';
      } catch (err) { freezeHint.textContent = err.message; }
    }
  }
  const rowOffsetValue = $('rowOffsetValue');
  if (rowOffsetValue) rowOffsetValue.textContent = String(o.rowOffset);
}

function commitOptions() {
  state.game = null; state.gameId = null;
  if ($('awardPreview')) $('awardPreview').hidden = true;
  updateOptionOutputs();
  schedulePersist();
  schedulePreview(PREVIEW_DEBOUNCE_MS);
}


/* ==========================================================================
   Event wiring
   ========================================================================== */

function bindEvents() {
  const on = (id, type, handler, options) => {
    const el = $(id);
    if (el) el.addEventListener(type, handler, options);
  };

  // Tabs ------------------------------------------------------------------
  const tabs = Array.from(document.querySelectorAll('.seg-btn'));
  tabs.forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
    button.addEventListener('keydown', (event) => {
      const index = tabs.indexOf(button);
      let next = null;
      if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
      if (event.key === 'Home') next = tabs[0];
      if (event.key === 'End') next = tabs[tabs.length - 1];
      if (next) {
        event.preventDefault();
        activateTab(next.dataset.tab, true);
      }
    });
  });

  // Data source -----------------------------------------------------------
  on('retryConnBtn', 'click', () => retryConnection());
  on('apiStatus', 'click', () => retryConnection());

  // Upload ----------------------------------------------------------------
  const dropzone = $('dropzone');
  const fileInput = $('fileInput');
  if (dropzone && fileInput) {
    let dragDepth = 0;
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });
    ['dragenter', 'dragover'].forEach((type) => {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (type === 'dragenter') dragDepth += 1;
        dropzone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'dragend'].forEach((type) => {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) dropzone.classList.remove('is-dragover');
      });
    });
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepth = 0;
      dropzone.classList.remove('is-dragover');
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) handleFile(file);
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (file) handleFile(file);
    });
  }
  on('clearFileBtn', 'click', () => {
    if (fileInput) fileInput.value = '';
    resetFileStatus();
  });

  // Remote ----------------------------------------------------------------
  on('remoteForm', 'submit', (event) => {
    event.preventDefault();
    fetchRemote();
  });

  for (const id of ['freezeMode', 'freezeMinutes']) on(id, 'change', (event) => {
    state.options[id] = event.target.value;
    Object.assign(state.options, normalizeFreezeOptions(state.options));
    syncOptionControls(); commitOptions();
  });

  const awardSwitches = new Set(['medalSameScore', 'podiumEnabled', 'firstSolveIncludeUnrank']);
  for (const id of ['medalMode', 'goldCount', 'silverCount', 'bronzeCount', 'goldCitation', 'silverCitation', 'bronzeCitation',
    'medalSameScore', 'podiumEnabled', 'championCitation', 'runnerUpCitation', 'thirdPlaceCitation', 'firstSolveMode', 'firstSolveIncludeUnrank']) {
    on(id, 'change', (event) => {
      state.options[id] = awardSwitches.has(id) ? event.target.checked : event.target.value;
      Object.assign(state.options, normalizeMedalOptions(state.options));
      if ((id === 'medalMode' && state.options.medalMode === 'custom') ||
          (id === 'podiumEnabled' && state.options.podiumEnabled) ||
          (id === 'firstSolveMode' && state.options.firstSolveMode !== 'imported')) state.options.showAwards = true;
      syncOptionControls();
      if ($('awardPreview')) $('awardPreview').hidden = true;
      commitOptions();
    });
  }
  on('firstSolveProblemList', 'change', () => {
    state.options.firstSolveProblemIds = [...$('firstSolveProblemList').querySelectorAll('input[data-problem-id]:checked')].map((input) => input.value);
    if ($('awardPreview')) $('awardPreview').hidden = true;
    commitOptions();
  });
  on('previewAwardsBtn', 'click', previewAwards);

  // Options ---------------------------------------------------------------
  on('rowsPerScreen', 'change', (event) => {
    state.options.rowsPerScreen = Number(event.target.value);
    commitOptions();
  });
  on('rowOffset', 'change', (event) => {
    let value = Math.round(Number(event.target.value));
    if (!Number.isFinite(value)) value = 0;
    value = clamp(value, 0, 8);
    event.target.value = String(value);
    state.options.rowOffset = value;
    commitOptions();
  });
  on('title', 'input', (event) => {
    const value = event.target.value.slice(0, 80);
    state.options.title = value.trim() ? value : null;
    schedulePersist();
    schedulePreview(PREVIEW_DEBOUNCE_MS);
  });
  on('startScreen', 'change', (event) => {
    state.options.startScreen = event.target.value === 'scoreboard' ? 'scoreboard' : 'splash';
    commitOptions();
  });
  ['showAwards', 'showLegend'].forEach((id) => {
    on(id, 'change', (event) => {
      state.options[id] = Boolean(event.target.checked);
      commitOptions();
    });
  });
  on('resetOptionsBtn', 'click', () => {
    state.options = { ...DEFAULT_OPTIONS };
    syncOptionControls();
    schedulePersist();
    schedulePreview(0);
    showToast('已恢复默认显示参数。', 'info');
  });

  // Preview ---------------------------------------------------------------
  on('refreshPreviewBtn', 'click', () => manualPreview());
  on('previewRetryBtn', 'click', () => retryConnection());
  on('previewFrame', 'load', onPreviewFrameLoad);
  on('previewPrevBtn', 'click', () => previewBridge('prev'));
  on('previewNextBtn', 'click', () => previewBridge('next'));
  on('previewResetBtn', 'click', () => previewBridge('reset'));

  // Presets ---------------------------------------------------------------
  on('saveConfigBtn', 'click', openSaveDialog);
  on('refreshConfigsBtn', 'click', () => loadConfigs({ silent: false }));
  on('saveForm', 'submit', saveConfig);
  on('deleteConfirmBtn', 'click', deleteConfig);
  on('configList', 'click', onConfigListClick);

  // Dialogs ---------------------------------------------------------------
  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => closeDialog($(button.dataset.closeDialog)));
  });
  ['saveDialog', 'deleteDialog', 'logoDialog'].forEach((id) => {
    const dialog = $(id);
    if (!dialog) return;
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  });
  on('saveDialog', 'close', () => {
    const error = $('saveError');
    if (error) error.hidden = true;
    setBusy($('saveConfirmBtn'), false);
  });

  on('photoSearch', 'input', () => { photoPage = 0; renderPhotoList(); });
  on('photoPrev', 'click', () => { photoPage--; renderPhotoList(); });
  on('photoNext', 'click', () => { photoPage++; renderPhotoList(); });
  on('photoList', 'click', (event) => {
    const button = event.target.closest('button[data-photo-action]');
    if (!button) return;
    const team = state.contest?.teams.find((item) => String(item.id) === button.dataset.teamId);
    if (!team) return;
    if (button.dataset.photoAction === 'upload' || button.dataset.photoAction === 'upload-logo') {
      teamMediaField = button.dataset.photoAction === 'upload-logo' ? 'logo' : 'photo';
      photoTeamId = String(team.id); $('photoFileInput').value = ''; $('photoFileInput').click();
    } else {
      const field = button.dataset.photoAction === 'remove-logo' ? 'logo' : 'photo';
      photoUploads.delete(`${team.id}:${field}`);
      team[field] = field === 'logo' ? team.originalLogo || null : null;
      team[`${field}Override`] = field !== 'logo'; team[`${field}Source`] = 'manual';
      renderPhotoList(); schedulePersist(); schedulePreview(0);
      showToast(field === 'logo' ? '已恢复默认队伍 Logo。' : '队伍照片已移除。', 'info');
    }
  });
  on('photoFileInput', 'change', (event) => handlePhotoFile(event.target.files?.[0]));

  // Organization logos ----------------------------------------------------
  on('manageLogosBtn', 'click', openLogoManager);
  on('logoSearch', 'input', renderLogoList);
  on('logoOrgList', 'click', (event) => {
    const button = event.target.closest('button[data-logo-action]');
    if (!button) return;
    const orgId = button.getAttribute('data-org-id');
    if (!orgId) return;
    if (button.getAttribute('data-logo-action') === 'upload') selectLogoFile(orgId);
    else if (button.getAttribute('data-logo-action') === 'remove') removeOrganizationLogo(orgId);
  });
  on('logoFileInput', 'change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) handleLogoFile(file);
    else logoUploadOrgId = null;
  });
  on('logoDialog', 'close', () => {
    logoUploadOrgId = null;
  });

  // Start -----------------------------------------------------------------
  on('startBtn', 'click', startResolve);
  on('prepareMediaBtn', 'click', prepareMedia);

  window.addEventListener('pagehide', flushPersist);
  window.addEventListener('beforeunload', flushPersist);
}

function activateTab(name, focus) {
  if (!name) return;
  document.querySelectorAll('.seg-btn').forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus();
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.hidden = panel.id !== `panel-${name}`;
  });
}

/* ==========================================================================
   API helpers
   ========================================================================== */

async function fetchJSON(url, { method = 'GET', body = undefined, timeout = 15000, raw = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': raw ? 'application/x-ndjson' : 'application/json' } : {}),
      },
      body: body !== undefined ? (raw ? body : JSON.stringify(body)) : undefined,
      signal: controller.signal,
    });

    setApiStatus(true);
    return await readJSONResponse(response);
  } catch (err) {
    if (err.name === 'AbortError') {
      const error = new Error('请求超时，请稍后重试');
      error.status = 0;
      error.timeout = true;
      throw error;
    }
    if (err && err.status !== undefined) throw err;
    const error = new Error('无法连接 Node API');
    error.status = 0;
    error.cause = err;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* ==========================================================================
   API status
   ========================================================================== */

function setApiStatus(online) {
  state.apiOnline = Boolean(online);
  const pill = $('apiStatus');
  const text = $('apiStatusText');
  const banner = $('offlineBanner');

  if (online) {
    pill.dataset.state = 'online';
    text.textContent = '服务已连接';
    pill.title = 'Node API 在线，点击重新检测';
    banner.hidden = true;
  } else {
    pill.dataset.state = 'offline';
    text.textContent = '连接已断开';
    pill.title = 'Node API 离线，点击重试连接';
    banner.hidden = false;
  }
}

function extractContest(payload) {
  if (!payload) return null;
  if (isContestLike(payload.contest)) return payload.contest;
  if (isContestLike(payload)) return payload;
  return null;
}

/* ==========================================================================
   Upload
   ========================================================================== */

async function handleFile(file) {
  if (!file || state.busy.parse) return;

  const name = file.name || '未命名文件';
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (!['json', 'jsonl', 'ndjson'].includes(extension)) {
    showToast('仅支持 .json / .jsonl / .ndjson 事件流文件。', 'error');
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showToast('文件过大，请上传不超过 38 MB 的事件流。', 'error');
    return;
  }

  if (!confirmReplacement('导入事件流')) return;
  const token = ++state.contestLoadToken;
  state.busy.parse = true;
  setFileStatus({
    name,
    meta: '正在读取文件…',
    state: 'loading',
  });

  try {
    const text = await file.text();
    if (token !== state.contestLoadToken) return;
    if (!text.trim()) {
      throw apiError('文件内容为空');
    }
    setFileStatus({ name, meta: '正在解析事件流…', state: 'loading' });

    const result = await fetchJSON(API.parse, {
      method: 'POST',
      body: text,
      raw: true,
      timeout: 120000,
    });
    if (token !== state.contestLoadToken) return;
    const contest = extractContest(result);
    if (!isContestLike(contest)) {
      throw apiError('解析结果缺少赛事数据');
    }

    setApiStatus(true);
    applyContest(contest, {
      stats: result && result.stats,
      source: 'upload',
      sourceName: name,
    });
    setFileStatus({
      name,
      meta: `解析完成 · ${contest.scoringMode === 'hydro' ? 'Hydro CDP' : 'CCS Contest API'} · ${getTeamCount()} 支队伍 · ${getProblemCount()} 道题`,
      state: 'success',
    });
    showToast(`事件流解析成功：${contest.name || name}`, 'success');
  } catch (err) {
    if (token !== state.contestLoadToken) return;
    if (err.status === 0) setApiStatus(false);
    setFileStatus({ name, meta: `解析失败：${err.message}`, state: 'error' });
    showToast(`解析失败：${err.message}`, 'error');
  } finally {
    state.busy.parse = false;
  }
}

function setFileStatus({ name, meta, state: status }) {
  const box = $('fileStatus');
  box.hidden = false;
  box.classList.toggle('is-error', status === 'error');
  $('fileName').textContent = name;
  $('fileMeta').textContent = meta;
  const icon = box.querySelector('use');
  if (icon) {
    icon.setAttribute('href', status === 'error' ? '#i-alert' : '#i-file');
  }
}

function resetFileStatus() {
  if (!$('fileStatus')) return;
  $('fileStatus').hidden = true;
  $('fileStatus').classList.remove('is-error');
  $('fileMeta').textContent = '等待解析';
  $('fileName').textContent = '—';
  const icon = $('fileStatus').querySelector('use');
  if (icon) icon.setAttribute('href', '#i-file');
}

/* ==========================================================================
   Remote URL
   ========================================================================== */

async function fetchRemote() {
  if (state.busy.remote) return;

  const note = $('remoteNote');
  const input = $('remoteUrl');
  const url = input.value.trim();

  note.hidden = true;
  note.className = 'inline-note';

  if (!url) {
    input.focus();
    showInlineNote('请输入事件流远程地址。', 'error');
    return;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    showInlineNote('地址格式无效，请输入完整的 http(s) URL。', 'error');
    return;
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    showInlineNote('仅支持 http / https 地址。', 'error');
    return;
  }

  if (!confirmReplacement('载入远程赛事')) return;
  const token = ++state.contestLoadToken;
  state.busy.remote = true;
  setBusy($('fetchRemoteBtn'), true, '获取中…');

  try {
    const result = await fetchJSON(API.fetch, {
      method: 'POST',
      body: { url },
      timeout: 30000,
    });
    if (token !== state.contestLoadToken) return;
    const contest = extractContest(result);
    if (!isContestLike(contest)) {
      throw apiError('远程响应中缺少赛事数据');
    }
    setApiStatus(true);
    applyContest(contest, {
      stats: result && result.stats,
      source: 'remote',
      sourceName: parsed.host,
    });
    showInlineNote(`已从 ${parsed.host} 载入赛事数据。`, 'info');
    showToast(`远程赛事已载入：${contest.name || parsed.host}`, 'success');
  } catch (err) {
    if (token !== state.contestLoadToken) return;
    if (err.status === 404 || err.status === 405 || err.status === 501) {
      showInlineNote('远程抓取暂不支持：请下载事件流文件后使用「上传文件」载入。', 'info');
      showToast('远程抓取暂不支持，请改用上传文件。', 'info');
    } else if (err.status === 0) {
      setApiStatus(false);
      showInlineNote('无法连接 Node API，请确认服务已启动。', 'error');
    } else {
      showInlineNote(`获取失败：${err.message}`, 'error');
      showToast(`远程赛事获取失败：${err.message}`, 'error');
    }
  } finally {
    state.busy.remote = false;
    setBusy($('fetchRemoteBtn'), false);
  }
}

function showInlineNote(message, type) {
  const note = $('remoteNote');
  note.textContent = message;
  note.className = `inline-note${type === 'error' ? ' is-error' : type === 'info' ? ' is-info' : ''}`;
  note.hidden = false;
}

/* ==========================================================================
   Contest state & summary
   ========================================================================== */

function applyContest(contest, { stats = null, source = 'upload', sourceName = '', options = null, mediaMatchReport = null } = {}) {
  if (!isContestLike(contest)) return;
  state.contestLoadToken++;
  if (source !== 'upload') resetFileStatus();
  if ($('awardPreview')) $('awardPreview').hidden = true;
  contest = applySchoolLogos(contest);
  state.mediaMatchReport = mediaMatchReport;
  libraryUI.clearReport();
  state.unpersistableContest = null;

  if (['upload', 'remote'].includes(source)) {
    const report = applyMediaLibrary(contest, libraryUI.items);
    const kept = preserveContestMedia(state.contest, report.contest);
    contest = kept.contest;
    state.mediaMatchReport = { matched: report.matched, unmatched: report.unmatched, preserved: kept.preserved };
    libraryUI.showReport(state.mediaMatchReport);
  }
  state.contest = contest;
  state.stats = stats && typeof stats === 'object' ? stats : null;
  state.source = source;
  state.sourceName = sourceName || '';
  state.game = null;
  state.gameId = null;
  state.previewDisabled = false;
  state.previewState = 'idle';
  resetLogoManager();

  if (options) {
    state.options = sanitizeOptions(
      { ...DEFAULT_OPTIONS, ...options },
      { singleStepIsEngine: true }
    );
    syncOptionControls();
  }

  updateOptionOutputs();
  renderSummary();
  updateSourceBadge();
  schedulePersist();
  schedulePreview(PREVIEW_DEBOUNCE_MS);
}

function renderPageContest() {
  const el = $('pageContest');
  if (!el) return;
  const name = state.contest?.name || state.contest?.formalName;
  el.textContent = name ? `当前赛事：${name}` : '当前赛事：尚未载入';
}

function updateSourceBadge() {
  const badge = $('sourceBadge');
  if (!badge) return;
  if (!state.contest) {
    badge.hidden = true;
    return;
  }
  const map = {
    upload: ['本地上传', 'badge badge-blue'],
    remote: ['远程地址', 'badge badge-blue'],
    saved: ['本地恢复', 'badge'],
    offline: ['离线演示', 'badge badge-amber'],
  };
  const [label, className] = map[state.source] || ['已载入', 'badge'];
  badge.textContent = label;
  badge.className = className;
  badge.hidden = false;
}

function renderSummary() {
  const contest = state.contest;
  renderPageContest();
  renderPhotoList();
  renderFirstSolveProblems();
  if (state.mediaMatchReport) libraryUI.showReport(state.mediaMatchReport);
  const body = $('summaryBody');
  if (!contest) {
    const empty = $('summaryEmpty');
    if (empty) empty.hidden = false;
    if (body) body.hidden = true;
    renderLogoSummary();
    return;
  }
  if (!body) {
    // Sub-pages have no full contest summary; the logo manager still needs
    // its own count/hint updated.
    renderLogoSummary();
    return;
  }
  const empty = $('summaryEmpty');
  if (empty) empty.hidden = true;
  body.hidden = false;

  const name = contest.name || contest.formalName || '未命名赛事';

  // Contest logo ----------------------------------------------------------
  const logoBox = $('contestLogo');
  logoBox.textContent = '';
  logoBox.classList.remove('is-empty');
  if (isSafeLogo(contest.logo)) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = contest.logo;
    img.decoding = 'async';
    img.addEventListener('error', () => {
      logoBox.textContent = '';
      logoBox.classList.add('is-empty');
      logoBox.innerHTML = iconMarkup('i-flag');
    });
    logoBox.appendChild(img);
  } else {
    logoBox.classList.add('is-empty');
    logoBox.innerHTML = iconMarkup('i-flag');
  }

  $('contestName').textContent = name;

  const subParts = [];
  if (state.source === 'upload' && state.sourceName) subParts.push(state.sourceName);
  else if (state.source === 'remote' && state.sourceName) subParts.push(state.sourceName);
  if (contest.scoringMode === 'hydro') subParts.push('Hydro ACM · 分钟:秒 · 打星队伍不占名次');
  if (contest.formalName && contest.formalName !== name) subParts.push(contest.formalName);
  const start = formatDateTime(contest.startTime);
  if (start) subParts.push(start);
  if (Number(contest.durationMs) > 0) subParts.push(`赛时 ${formatDuration(contest.durationMs)}`);
  if (!subParts.length) subParts.push('赛事数据已就绪');
  $('contestSub').textContent = subParts.join(' · ');

  const pill = $('contestStatePill');
  if (state.source === 'offline') {
    pill.className = 'pill pill-warn';
    pill.innerHTML = `${iconMarkup('i-alert')}离线演示`;
  } else {
    pill.className = 'pill pill-ok';
    pill.innerHTML = `${iconMarkup('i-check-circle')}已载入`;
  }

  // Stats -----------------------------------------------------------------
  const teamCount = getTeamCount();
  const problemCount = getProblemCount();
  const pending = getPendingCount();
  const freezeMs = getFreezeMs(contest);

  $('statTeams').textContent = formatCount(teamCount);
  $('statProblems').textContent = formatCount(problemCount);
  $('statFreeze').textContent = freezeMs == null ? '—' : formatDuration(freezeMs);

  const pendingEl = $('statPending');
  pendingEl.textContent = pending == null ? '—' : formatCount(pending);
  const pendingTile = pendingEl.closest('.stat');
  if (pendingTile) {
    pendingTile.title = pending == null ? '暂无法计算待定提交' : '封榜后待定提交数（按事件流/滚榜步骤计算）';
  }

  // Team logos ------------------------------------------------------------
  const teams = Array.isArray(contest.teams) ? contest.teams : [];
  const organizations = new Map(
    (Array.isArray(contest.organizations) ? contest.organizations : []).map((org) => [
      org.id,
      org,
    ])
  );
  const strip = $('logoStrip');
  strip.textContent = '';
  const shown = Math.min(teams.length, LOGO_STRIP_LIMIT);

  for (let index = 0; index < shown; index += 1) {
    const team = teams[index] || {};
    const label = team.displayName || team.name || '队伍';
    const organization = organizations.get(team.organizationId);
    const logo = teamLogoUrl(team, organization);

    const item = document.createElement('div');
    item.className = 'team-logo';
    item.setAttribute('role', 'listitem');
    item.title = label;
    item.setAttribute('aria-label', label);

    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    setLogoImage(img, isSafeLogo(logo) ? logo : DEFAULT_SCHOOL_LOGO);
    item.appendChild(img);

    strip.appendChild(item);
  }

  if (!teams.length) {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = '暂无队伍徽标';
    empty.style.fontSize = '11px';
    strip.appendChild(empty);
  } else if (teams.length > shown) {
    const more = document.createElement('div');
    more.className = 'team-logo-more';
    more.textContent = `+${teams.length - shown}`;
    more.title = `其余 ${teams.length - shown} 支队伍`;
    strip.appendChild(more);
  }

  $('logoCount').textContent = teams.length
    ? `共 ${teams.length} 支${teams.length > shown ? ` · 展示前 ${shown} 支` : ''}`
    : '';

  renderLogoSummary();
}

/* ==========================================================================
   Organization logos
   ========================================================================== */

const LOGO_MAX_BYTES = 6 * 1024 * 1024;
const LOGO_MAX_DIMENSION = 256;

function getOrganizationRows() {
  const contest = state.contest;
  const organizations = contest && Array.isArray(contest.organizations) ? contest.organizations : [];
  const teams = contest && Array.isArray(contest.teams) ? contest.teams : [];
  const teamCounts = new Map();
  const teamLogos = new Map();
  const teamNames = new Map();

  for (const team of teams) {
    const orgId = team && team.organizationId != null ? String(team.organizationId) : '';
    if (!orgId) continue;
    teamCounts.set(orgId, (teamCounts.get(orgId) || 0) + 1);
    const display = team.displayName || team.name || '';
    if (display) {
      if (!teamNames.has(orgId)) teamNames.set(orgId, []);
      teamNames.get(orgId).push(display);
    }
    if (team.logo && !teamLogos.has(orgId)) teamLogos.set(orgId, team.logo);
  }

  return organizations
    .map((org) => {
      const id = String(org.id);
      return {
        id,
        name: org.name || org.formalName || `组织 ${id}`,
        formalName: org.formalName || '',
        country: org.country || '',
        logo: org.logo || null,
        logoOverride: org.logoOverride === true,
        teamCount: teamCounts.get(id) || 0,
        teamLogo: teamLogos.get(id) || null,
        teamNames: teamNames.get(id) || [],
        org,
      };
    })
    .sort((a, b) => {
      const aHasTeams = a.teamCount > 0 ? 1 : 0;
      const bHasTeams = b.teamCount > 0 ? 1 : 0;
      if (aHasTeams !== bHasTeams) return bHasTeams - aHasTeams;
      if (a.teamCount !== b.teamCount) return b.teamCount - a.teamCount;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
}

function orgPreviewLogo(row) {
  return (row.logo !== DEFAULT_SCHOOL_LOGO && row.logo) || row.teamLogo || DEFAULT_SCHOOL_LOGO;
}

function renderLogoSummary() {
  const badge = $('logoSummary');
  const hint = $('logoManagerHint');
  const button = $('manageLogosBtn');
  if (!badge) return;

  const rows = getOrganizationRows();
  if (!state.contest) {
    badge.textContent = '—';
    badge.title = '尚未载入赛事';
    if (button) button.disabled = true;
    if (hint) {
      hint.textContent = '载入赛事后，可为每个组织上传 Logo；上传后该组织的所有队伍统一使用。';
    }
    return;
  }
  if (!rows.length) {
    badge.textContent = '—';
    badge.title = '当前赛事没有组织数据';
    if (button) button.disabled = true;
    if (hint) hint.textContent = '当前赛事没有组织数据，无法按组织管理 Logo。';
    return;
  }

  const overridden = rows.filter((row) => row.logoOverride).length;
  const overriddenTeams = rows.reduce(
    (sum, row) => sum + (row.logoOverride ? row.teamCount : 0),
    0,
  );
  const automatic = rows.filter((row) => !row.logoOverride && logoSource(orgPreviewLogo(row)) === 'hydro').length;
  const defaults = rows.filter((row) => orgPreviewLogo(row) === DEFAULT_SCHOOL_LOGO).length;

  badge.textContent = `自动匹配 ${automatic} / ${rows.length}`;
  badge.title = `Hydro 校徽 ${automatic} 个；ICPC 默认 ${defaults} 个；手工覆盖 ${overridden} 个`;
  if (button) button.disabled = false;
  if (hint) {
    hint.textContent = `已自动匹配 ${automatic} 个学校 Logo，${defaults} 个使用 ICPC 默认 Logo。` +
      (overridden ? `手工覆盖 ${overridden} 个组织、${overriddenTeams} 支队伍，可随时恢复。` : '可为组织上传图片，替换自动匹配结果。');
  }
}

function resetLogoManager() {
  logoUploadOrgId = null;
  state.logoOriginals.clear();
  const input = $('logoFileInput');
  if (input) input.value = '';
  const search = $('logoSearch');
  if (search) search.value = '';
  const dialog = $('logoDialog');
  if (dialog && dialog.open) closeDialog(dialog);
}

function openLogoManager() {
  if (!state.contest) {
    showToast('请先载入赛事数据，再管理组织 Logo。', 'info');
    return;
  }
  if (!getOrganizationRows().length) {
    showToast('当前赛事没有组织数据。', 'info');
    return;
  }
  const search = $('logoSearch');
  if (search) search.value = '';
  renderLogoList();
  openDialog($('logoDialog'));
}

function renderLogoList() {
  const list = $('logoOrgList');
  const count = $('logoDialogCount');
  if (!list) return;

  const rows = getOrganizationRows();
  const query = String($('logoSearch')?.value || '').trim().toLowerCase();
  const filtered = query
    ? rows.filter((row) =>
        `${row.name} ${row.formalName} ${row.country} ${row.teamNames.join(' ')}`
          .toLowerCase()
          .includes(query),
      )
    : rows;
  const overridden = rows.filter((row) => row.logoOverride).length;

  if (count) {
    count.textContent = `${filtered.length} / ${rows.length} 个组织 · 已上传 ${overridden} 个`;
  }
  list.textContent = '';
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'logo-org-empty';
    empty.textContent = rows.length
      ? '没有匹配的组织，试试其他关键词。'
      : '当前赛事没有组织数据。';
    list.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const row of filtered) {
    const item = document.createElement('div');
    item.className = 'logo-org';
    item.setAttribute('role', 'listitem');

    const mark = document.createElement('span');
    mark.className = 'logo-org-mark';
    const preview = orgPreviewLogo(row);
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    setLogoImage(img, isSafeLogo(preview) ? preview : DEFAULT_SCHOOL_LOGO);
    mark.appendChild(img);

    const info = document.createElement('div');
    info.className = 'logo-org-info';
    const nameLine = document.createElement('div');
    nameLine.className = 'logo-org-name';
    const name = document.createElement('strong');
    name.textContent = row.name;
    name.title = row.name;
    nameLine.appendChild(name);
    const badge = document.createElement('span');
    badge.className = 'logo-org-badge';
    badge.textContent = row.logoOverride ? '已覆盖' : logoSource(preview) === 'hydro' ? '自动匹配' :
      preview === DEFAULT_SCHOOL_LOGO ? 'ICPC 默认' : '赛事 Logo';
    nameLine.appendChild(badge);
    info.appendChild(nameLine);

    const meta = document.createElement('span');
    meta.className = 'logo-org-meta';
    const bits = [];
    if (row.formalName && row.formalName !== row.name) bits.push(row.formalName);
    if (row.country) bits.push(row.country);
    bits.push(row.teamCount ? `${row.teamCount} 支队伍` : '暂无队伍');
    meta.textContent = bits.join(' · ');
    meta.title = meta.textContent;
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'logo-org-actions';
    const upload = document.createElement('button');
    upload.type = 'button';
    upload.className = 'btn btn-sm btn-secondary';
    upload.textContent = row.logo ? '替换' : '上传';
    upload.setAttribute('data-logo-action', 'upload');
    upload.setAttribute('data-org-id', row.id);
    upload.setAttribute('aria-label', `${row.logo ? '替换' : '上传'}${row.name}的 Logo`);
    actions.appendChild(upload);
    if (row.logoOverride) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn';
      remove.title = '移除上传的 Logo，回退到队伍自己的 Logo';
      remove.setAttribute('aria-label', `移除${row.name}的组织 Logo`);
      remove.setAttribute('data-logo-action', 'remove');
      remove.setAttribute('data-org-id', row.id);
      remove.innerHTML = iconMarkup('i-trash');
      actions.appendChild(remove);
    }

    item.append(mark, info, actions);
    fragment.appendChild(item);
  }
  list.appendChild(fragment);
}

function selectLogoFile(orgId) {
  const input = $('logoFileInput');
  if (!input) return;
  logoUploadOrgId = orgId;
  input.value = '';
  input.click();
}

async function handleLogoFile(file) {
  const orgId = logoUploadOrgId;
  logoUploadOrgId = null;
  if (!orgId || !file) return;

  const org = (state.contest?.organizations || []).find((item) => String(item.id) === orgId);
  if (!org) {
    showToast('找不到该组织，请刷新后重试。', 'error');
    return;
  }
  const row = getOrganizationRows().find((item) => item.id === orgId);
  showToast(`正在处理「${row?.name || org.name}」的 Logo…`, 'info', 1800);
  const contest = state.contest;

  try {
    const dataUrl = await uploadImage(await prepareLogoFile(file));
    if (state.contest !== contest || !state.contest.organizations.includes(org)) {
      showToast('赛事已切换，已取消本次 Logo 应用。', 'info'); return;
    }
    if (!state.logoOriginals.has(orgId)) state.logoOriginals.set(orgId, org.logo || null);
    if (!org.logoOverride) org.originalLogo = org.logo || null;
    org.logo = dataUrl;
    org.logoOverride = true;
    org.logoSource = 'manual';
    renderLogoList();
    renderSummary();
    schedulePersist();
    schedulePreview(0);
    showToast(`已更新「${row?.name || org.name}」的组织 Logo`, 'success');
  } catch (err) {
    showToast(`Logo 处理失败：${err.message}`, 'error');
  } finally {
    const input = $('logoFileInput');
    if (input) input.value = '';
  }
}

function removeOrganizationLogo(orgId) {
  const org = (state.contest?.organizations || []).find((item) => String(item.id) === orgId);
  if (!org) return;
  const row = getOrganizationRows().find((item) => item.id === orgId);
  const original = org.originalLogo ?? (state.logoOriginals.has(orgId) ? state.logoOriginals.get(orgId) : null);
  state.logoOriginals.delete(orgId);
  org.logo = original;
  org.logoOverride = false;
  org.logoSource = logoSource(original);
  state.contest = applySchoolLogos(state.contest);
  renderLogoList();
  renderSummary();
  schedulePersist();
  schedulePreview(0);
  showToast(
    original
      ? `已恢复「${row?.name || org.name}」导入时的组织 Logo`
      : `已移除「${row?.name || org.name}」的组织 Logo，队伍将使用自己的 Logo`,
    'info',
  );
}

async function uploadImage(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const response = await fetch(API.assets, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob, signal: AbortSignal.timeout(30000) });
  setApiStatus(true);
  const result = await readJSONResponse(response, '图片保存失败，请稍后重试');
  return result.url;
}

function renderPhotoList() {
  const list = $('photoList');
  if (!list) return;
  const all = state.contest?.teams || [];
  const organizations = new Map((state.contest?.organizations || []).map((org) => [String(org.id), org]));
  const query = ($('photoSearch').value || '').trim().toLowerCase();
  const rows = all.filter((team) => `${team.id} ${team.displayName || team.name} ${organizations.get(String(team.organizationId))?.name || ''}`.toLowerCase().includes(query));
  const pages = Math.max(1, Math.ceil(rows.length / 40));
  photoPage = Math.max(0, Math.min(photoPage, pages - 1));
  $('photoCount').textContent = `${rows.length} 支队伍 · 共 ${all.filter((team) => team.photo).length} 张照片`;
  $('photoPage').textContent = `${photoPage + 1} / ${pages}`;
  $('photoPrev').disabled = photoPage === 0; $('photoNext').disabled = photoPage >= pages - 1;
  list.textContent = '';
  for (const team of rows.slice(photoPage * 40, (photoPage + 1) * 40)) {
    const row = document.createElement('div'); row.className = 'photo-row'; row.setAttribute('role', 'listitem');
    const picture = document.createElement('div'); picture.className = 'photo-preview';
    if (team.photo && isSafeLogo(team.photo)) {
      const img = document.createElement('img'); img.src = team.photo; img.alt = `${team.displayName || team.name}的队伍照片`; img.loading = 'lazy';
      img.addEventListener('error', () => { picture.textContent = '照片不可用'; }); picture.append(img);
    } else picture.textContent = '尚未设置照片';
    const logoBox = document.createElement('div'); logoBox.className = 'team-media-logo';
    const logo = teamLogoUrl(team, organizations.get(String(team.organizationId)));
    const logoImage = document.createElement('img');
    logoImage.alt = `${team.displayName || team.name}的队伍 Logo`; logoImage.loading = 'lazy';
    setLogoImage(logoImage, isSafeLogo(logo) ? logo : DEFAULT_SCHOOL_LOGO); logoBox.append(logoImage);
    const info = document.createElement('div'); info.className = 'photo-info';
    const title = document.createElement('strong'); title.textContent = team.displayName || team.name || team.id;
    const detail = document.createElement('p'); detail.textContent = `ID ${team.id} · ${organizations.get(String(team.organizationId))?.name || '未设置组织'}`;
    info.append(title, detail);
    const actions = document.createElement('div'); actions.className = 'photo-actions';
    for (const [action, label] of [['upload-logo', team.logoOverride ? '替换队伍 Logo' : '上传队伍 Logo'], ...(team.logoOverride ? [['remove-logo', '恢复默认 Logo']] : []), ['upload', team.photo ? '替换照片' : '上传照片'], ...(team.photo ? [['remove', '移除照片']] : [])]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-sm btn-secondary'; button.textContent = label;
      button.dataset.photoAction = action; button.dataset.teamId = String(team.id); button.setAttribute('aria-label', `${label}：${team.displayName || team.name || team.id}`); actions.append(button);
    }
    row.append(logoBox, picture, info, actions); list.append(row);
  }
  if (!rows.length) list.textContent = all.length ? '没有匹配的队伍。' : '请先在数据源页载入比赛。';
}

async function handlePhotoFile(file) {
  const id = photoTeamId; photoTeamId = null;
  const field = teamMediaField;
  const label = field === 'logo' ? '队伍 Logo' : '队伍照片';
  const uploadKey = `${id}:${field}`;
  const contest = state.contest;
  const team = contest?.teams.find((item) => String(item.id) === id);
  if (!file || !team) return;
  const token = Symbol(); photoUploads.set(uploadKey, token);
  showToast(`正在压缩并保存${label}…`, 'info');
  try {
    const url = await uploadImage(await prepareLogoFile(file, field === 'logo' ? 256 : 1280));
    if (state.contest !== contest || photoUploads.get(uploadKey) !== token) return;
    if (field === 'logo' && !team.logoOverride) team.originalLogo = team.logo || null;
    team[field] = url; team[`${field}Override`] = true; team[`${field}Source`] = 'manual';
    renderPhotoList(); schedulePersist(); schedulePreview(0);
    showToast(`已保存「${team.displayName || team.name}」的${label}`, 'success');
  } catch (err) { showToast(`${label}保存失败：${err.message}`, 'error'); }
}

function prepareLogoFile(file, maxDimension = LOGO_MAX_DIMENSION) {
  if (!file || !/^image\//i.test(file.type)) {
    return Promise.reject(new Error('请选择 PNG / JPG / WebP / SVG 图片'));
  }
  if (file.size > LOGO_MAX_BYTES) {
    return Promise.reject(new Error('图片不能超过 6 MB'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取图片文件'));
    reader.onload = () => {
      const src = String(reader.result || '');
      if (!src) {
        reject(new Error('图片内容为空'));
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('图片格式无法识别'));
      img.onload = () => {
        try {
          resolve(rasterizeLogo(img, maxDimension));
        } catch (err) {
          reject(err);
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

function rasterizeLogo(img, maxDimension = LOGO_MAX_DIMENSION) {
  const width = img.naturalWidth || img.width || LOGO_MAX_DIMENSION;
  const height = img.naturalHeight || img.height || LOGO_MAX_DIMENSION;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持图片处理');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const webp = canvas.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

function getTeamCount() {
  if (state.game && state.game.meta && Number.isFinite(Number(state.game.meta.teamCount))) {
    return Number(state.game.meta.teamCount);
  }
  const fromStats = statNumber(state.stats, ['teamCount', 'teams', 'team_count']);
  if (fromStats != null) return fromStats;
  return state.contest && Array.isArray(state.contest.teams) ? state.contest.teams.length : 0;
}

function getProblemCount() {
  if (state.game && state.game.meta && Number.isFinite(Number(state.game.meta.problemCount))) {
    return Number(state.game.meta.problemCount);
  }
  const fromStats = statNumber(state.stats, ['problemCount', 'problems', 'problem_count']);
  if (fromStats != null) return fromStats;
  return state.contest && Array.isArray(state.contest.problems)
    ? state.contest.problems.length
    : 0;
}

function getPendingCount() {
  // The resolver's "pending" are the submissions hidden behind the scoreboard
  // freeze, which the engine exposes on the game. `/api/parse` stats count
  // unjudged submissions instead (0 for a complete CCS export), so prefer the
  // game when we have one.
  if (state.game && state.game.meta && state.game.meta.pendingCount != null) {
    return Number(state.game.meta.pendingCount);
  }
  const contest = state.contest;
  if (contest && Array.isArray(contest.submissions) && contest.submissions.length) {
    const freezeMs = getFreezeMs(contest) || 0;
    const durationMs = Number(contest.durationMs) || 0;
    if (durationMs > 0) {
      const freezeStart = durationMs - freezeMs;
      let measured = 0;
      let comparable = 0;
      for (const submission of contest.submissions) {
        const time = Number(submission && submission.contestTime);
        if (!Number.isFinite(time)) continue;
        comparable += 1;
        if ((contest.scoringMode === 'hydro' ? time > freezeStart : time >= freezeStart) && time < durationMs) measured += 1;
      }
      if (comparable > 0) return measured;
    }
  }
  const fromStats = statNumber(state.stats, [
    'pendingCount',
    'pending',
    'pendingSubmissions',
  ]);
  if (fromStats != null) return fromStats;
  if (!contest || !Array.isArray(contest.submissions) || !contest.submissions.length) return null;

  const explicit = contest.submissions.filter((submission) => {
    if (!submission || typeof submission !== 'object') return false;
    return (
      submission.pending === true ||
      submission.frozen === true ||
      submission.status === 'pending' ||
      submission.status === 'PENDING'
    );
  }).length;

  // Contract: derive from the submission count when the feed has no stats.
  return explicit || contest.submissions.length;
}

function statNumber(source, keys) {
  if (!source || typeof source !== 'object') return null;
  for (const key of keys) {
    if (source[key] == null || source[key] === '') continue;
    const value = Number(source[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function getFreezeMs(contest) {
  if (!contest) return null;
  if (state.options.freezeMode === 'custom') return state.options.freezeMinutes * 60000;
  const candidates = [contest.freezeDurationMs, contest.freezeDuration, contest.freezeTimeMs];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const minutes = Number(contest.freezeMinutes);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60000;
  const ms = Number(contest.freezeTime);
  if (Number.isFinite(ms) && ms > 0) return ms;
  return null;
}

/* ==========================================================================
   Preview
   ========================================================================== */

function schedulePreview(delay = PREVIEW_DEBOUNCE_MS) {
  // Only the dedicated preview page (or an embedded preview) has the frame.
  if (!$('previewFrame')) return;
  // Invalidate immediately, not after the debounce: an older response may
  // arrive while the new configuration is waiting to be rendered.
  state.previewToken++;
  state.busy.preview = false;
  state.game = null; state.gameId = null;
  setBusy($('refreshPreviewBtn'), false);
  clearTimeout(state.previewTimer);
  state.previewTimer = null;

  if (state.previewDisabled) {
    const online = state.apiOnline === true;
    setPreviewError(
      online ? '演示数据不可用' : '服务未连接',
      online
        ? '无法从 Node API 获取演示赛事，请上传事件流文件后重试。'
        : '无法连接 Node API。启动服务后将自动恢复预览。'
    );
    return;
  }

  if (!state.contest) {
    setPreviewState('empty');
    return;
  }

  if (state.apiOnline === false) {
    setPreviewError(
      '服务未连接',
      '无法连接 Node API。启动服务后点击「重试」生成预览。'
    );
    return;
  }

  const hint = $('previewHint');
  if (state.previewState === 'ready') hint.textContent = '参数已修改，即将刷新…';

  state.previewTimer = setTimeout(() => {
    state.previewTimer = null;
    buildPreview();
  }, Math.max(0, delay));
}

async function buildPreview({ manual = false } = {}) {
  if (!$('previewFrame')) return;
  clearTimeout(state.previewTimer);
  state.previewTimer = null;

  if (!state.contest) {
    setPreviewState('empty');
    return;
  }
  if (state.previewDisabled) {
    schedulePreview(0);
    return;
  }
  if (state.apiOnline === false && !manual) {
    setPreviewError('服务未连接', '无法连接 Node API。启动服务后点击「重试」生成预览。');
    return;
  }

  const token = ++state.previewToken;
  state.busy.preview = true;
  setBusy($('refreshPreviewBtn'), true, '刷新中…');
  setPreviewState('loading');

  try {
    const result = await fetchJSON(API.game, {
      method: 'POST',
      body: { contest: state.contest, options: state.options },
      timeout: 120000,
    });
    if (token !== state.previewToken) return;

    const id = result && (result.id || (result.game && result.game.id));
    if (!id) throw apiError('服务端未返回游戏 ID');

    state.gameId = id;
    state.game = result.game || null;
    setApiStatus(true);

    const frame = $('previewFrame');
    $('previewWrap').classList.remove('is-ready');
    frame.src = `/play.html?id=${encodeURIComponent(id)}&preview=1#control=${encodeURIComponent(result.controlToken)}`;
    $('previewHint').textContent = '播放页加载中…';

    if (state.game && state.game.meta) renderSummary();
  } catch (err) {
    if (token !== state.previewToken) return;
    if (err.status === 0) setApiStatus(false);
    setPreviewError(
      err.status === 0 ? '服务未连接' : '预览生成失败',
      err.status === 0
        ? '无法连接 Node API。启动服务后点击「重试」生成预览。'
        : err.message || '请检查赛事数据与服务端日志。'
    );
    if (manual) showToast(`预览生成失败：${err.message}`, 'error');
  } finally {
    if (token === state.previewToken) {
      state.busy.preview = false;
      setBusy($('refreshPreviewBtn'), false);
    }
  }
}

function onPreviewFrameLoad() {
  const frame = $('previewFrame');
  if (!frame) return;
  const src = frame.getAttribute('src');
  if (!src || src === 'about:blank') return;
  if (state.previewState !== 'loading') return;
  if (!state.gameId || !src.includes(`id=${encodeURIComponent(state.gameId)}`)) return;
  const currentId = state.gameId;
  const deadline = Date.now() + 10000;
  const check = () => {
    if (currentId !== state.gameId || state.previewState !== 'loading') return;
    try {
      const win = frame.contentWindow;
      if (win.ICPCResolver?.view) { setPreviewState('ready'); return; }
      const error = win.document.getElementById('error');
      if (error && !error.hidden) { setPreviewError('预览加载失败', win.document.getElementById('error-message')?.textContent || '请重试'); return; }
    } catch { setPreviewError('预览加载失败', '无法访问播放页，请检查服务地址'); return; }
    if (Date.now() >= deadline) { setPreviewError('预览加载超时', '播放页未能就绪，请重试'); return; }
    setTimeout(check, 100);
  };
  check();
}

async function manualPreview() {
  if (!$('previewFrame')) return;
  clearTimeout(state.previewTimer);
  state.previewTimer = null;

  if (!state.contest) {
    showToast('请先载入赛事数据，再刷新预览。', 'info');
    return;
  }
  if (state.previewDisabled) {
    showToast('当前没有可用的赛事数据，请先上传事件流文件。', 'info');
    return;
  }
  if (state.apiOnline === false) {
    const ok = await loadConfigs({ silent: true });
    if (!ok && state.apiOnline === false) {
      showToast('Node API 离线，无法生成预览。', 'error');
      setPreviewError('服务未连接', '无法连接 Node API。启动服务后点击「重试」生成预览。');
      return;
    }
  }
  buildPreview({ manual: true });
}

function previewBridge(action) {
  const frame = $('previewFrame');
  const api = frame && frame.contentWindow && frame.contentWindow.ICPCResolver;
  if (!api) {
    showToast('预览尚未就绪，请稍后再试。', 'info');
    return;
  }
  if (action === 'next') api.next?.();
  else if (action === 'prev') api.prev?.();
  else if (action === 'reset') api.reset?.();
}

function setPreviewState(kind, extra = {}) {
  state.previewState = kind;

  const wrap = $('previewWrap');
  if (!wrap) return;
  const status = $('previewStatus');
  const statusText = $('previewStatusText');
  const hint = $('previewHint');

  $('previewEmpty').hidden = true;
  $('previewLoading').hidden = true;
  $('previewError').hidden = true;

  if (kind === 'ready') {
    wrap.classList.add('is-ready');
    status.dataset.state = 'ready';
    statusText.textContent = '预览就绪';
    hint.textContent = '预览就绪 · 右键 / → 下一步，左键 / ← 上一步';
    return;
  }

  wrap.classList.remove('is-ready');

  if (kind === 'loading') {
    $('previewLoading').hidden = false;
    status.dataset.state = 'loading';
    statusText.textContent = extra.label || '生成中…';
    hint.textContent = extra.hint || '正在构建滚榜步骤…';
    return;
  }

  if (kind === 'error') {
    $('previewError').hidden = false;
    status.dataset.state = 'error';
    statusText.textContent = extra.statusText || '预览失败';
    $('previewErrorTitle').textContent = extra.title || '预览生成失败';
    $('previewErrorDetail').textContent =
      extra.detail || '请检查赛事数据、Node 服务或稍后重试。';
    hint.textContent = extra.hint || '启动服务后点击重试';
    return;
  }

  // empty
  $('previewEmpty').hidden = false;
  status.dataset.state = 'idle';
  statusText.textContent = '等待数据';
  hint.textContent = '载入数据后自动生成预览';
}

function setPreviewError(title, detail, statusText) {
  setPreviewState('error', { title, detail, statusText });
}

/* ==========================================================================
   Config presets
   ========================================================================== */

async function loadConfigs({ silent = false, keepLoading = false } = {}) {
  if (!keepLoading) renderConfigs({ loading: true });

  try {
    const data = await fetchJSON(API.configs, { timeout: 12000 });
    const list = Array.isArray(data)
      ? data
      : data && Array.isArray(data.configs)
        ? data.configs
        : [];
    state.configs = list.filter((record) => record && typeof record === 'object');
    setApiStatus(true);
    renderConfigs();
    return true;
  } catch (err) {
    state.configs = [];
    if (err.status == null || err.status === 0) {
      setApiStatus(false);
      renderConfigs({ error: '无法连接 Node API，配置列表不可用。' });
    } else {
      // Reached the server, but the endpoint failed — keep the online status.
      setApiStatus(true);
      renderConfigs({ error: `配置列表加载失败：${err.message}` });
    }
    if (!silent) {
      showToast(`配置列表加载失败：${err.message}`, 'error');
    }
    return false;
  }
}

function renderConfigs({ loading = false, error = null } = {}) {
  const list = $('configList');
  if (!list) return;
  list.textContent = '';

  if (loading) {
    const item = document.createElement('li');
    item.className = 'config-loading';
    item.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>正在载入配置…</span>';
    list.appendChild(item);
    return;
  }

  if (error) {
    const item = document.createElement('li');
    item.className = 'config-empty';
    item.innerHTML = `${iconMarkup('i-alert')}<span></span>`;
    item.querySelector('span').textContent = error;
    list.appendChild(item);
    return;
  }

  if (!state.configs.length) {
    const item = document.createElement('li');
    item.className = 'config-empty';
    item.innerHTML = `${iconMarkup('i-bookmark')}<span>暂无保存的配置</span>`;
    list.appendChild(item);
    return;
  }

  state.configs.forEach((record) => {
    const name = String(record.name || '未命名配置');
    const id = String(record.id != null ? record.id : '');
    const meta = describeConfig(record);

    const item = document.createElement('li');
    item.className = 'config-item';
    item.dataset.id = id;

    const main = document.createElement('div');
    main.className = 'config-item-main';

    const nameEl = document.createElement('span');
    nameEl.className = 'config-name';
    nameEl.textContent = name;
    nameEl.title = name;

    const metaEl = document.createElement('span');
    metaEl.className = 'config-meta';
    metaEl.textContent = meta;

    main.appendChild(nameEl);
    main.appendChild(metaEl);

    const actions = document.createElement('div');
    actions.className = 'config-actions';

    const loadButton = document.createElement('button');
    loadButton.type = 'button';
    loadButton.className = 'icon-btn';
    loadButton.dataset.action = 'load';
    loadButton.title = '载入此配置';
    loadButton.setAttribute('aria-label', `载入配置 ${name}`);
    loadButton.innerHTML = iconMarkup('i-download');

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'icon-btn danger';
    deleteButton.dataset.action = 'delete';
    deleteButton.title = '删除此配置';
    deleteButton.setAttribute('aria-label', `删除配置 ${name}`);
    deleteButton.innerHTML = iconMarkup('i-trash');

    actions.appendChild(loadButton);
    actions.appendChild(deleteButton);
    item.appendChild(main);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

function describeConfig(record) {
  const config = normalizeConfig(record && (record.config ?? record.options));
  const options = sanitizeOptions(config, { singleStepIsEngine: true });
  const parts = [record?.hasContest ? '含赛事数据' : '仅选项', `${options.rowsPerScreen} 行`, formatSpeed(options.speedFactor)];
  const saved = formatSavedAt(record && record.updatedAt);
  if (saved) parts.push(saved);
  return parts.join(' · ');
}

function normalizeConfig(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {};
    }
  }
  return typeof value === 'object' ? value : {};
}

function onConfigListClick(event) {
  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  const item = actionButton.closest('.config-item');
  if (!item) return;
  const record = state.configs.find((entry) => String(entry.id) === item.dataset.id);
  if (!record) return;

  if (actionButton.dataset.action === 'load') {
    applyPreset(record);
  } else if (actionButton.dataset.action === 'delete') {
    openDeleteDialog(record);
  }
}

async function applyPreset(record) {
  if (!confirmReplacement('载入配置预设')) return;
  const token = ++state.contestLoadToken;
  let full = record;
  if (record && record.hasContest && !isContestLike(record.contest)) {
    try {
      full = await fetchJSON(`${API.configs}/${encodeURIComponent(record.id)}`, { timeout: 20000 });
    } catch (err) {
      if (token !== state.contestLoadToken) return;
      showToast(`读取配置「${record.name || '未命名配置'}」失败：${err.message}`, 'error');
      return;
    }
  }

  if (token !== state.contestLoadToken) return;
  const config = normalizeConfig(full.config ?? full.options);
  state.options = sanitizeOptions(config, { singleStepIsEngine: true });
  syncOptionControls();
  state.lastPresetName = full.name || record.name || '';

  if (isContestLike(full.contest)) {
    applyContest(full.contest, {
      stats: full.stats,
      source: 'saved',
      sourceName: full.name || record.name || '配置预设',
    });
    showToast(`已载入配置「${full.name || '未命名配置'}」及其赛事数据。`, 'success');
  } else {
    schedulePersist();
    schedulePreview(PREVIEW_DEBOUNCE_MS);
    showToast(
      state.contest
        ? `已载入配置「${full.name || '未命名配置'}」。`
        : `已载入配置「${full.name || '未命名配置'}」，请先载入赛事数据。`,
      'success'
    );
  }
}

/* ==========================================================================
   Save / delete presets
   ========================================================================== */

function openSaveDialog() {
  $('saveError').hidden = true;
  $('saveError').textContent = '';

  const input = $('configNameInput');
  const fallback = state.lastPresetName || (state.contest && state.contest.name) || '我的滚榜配置';
  input.value = String(fallback).slice(0, 40);

  openDialog($('saveDialog'));
  window.setTimeout(() => {
    input.focus();
    input.select();
  }, 40);
}

async function saveConfig(event) {
  event.preventDefault();
  if (state.busy.save) return;
  if (!usableContest()) { showToast(state.source === 'offline' ? '请先载入有效赛事，离线演示不能保存为预设。' : '请先上传赛事事件流，再保存配置。', 'error'); return; }

  const input = $('configNameInput');
  const name = input.value.trim();
  const error = $('saveError');

  if (!name) {
    error.textContent = '请输入配置名称。';
    error.hidden = false;
    input.focus();
    return;
  }
  if (name.length > 40) {
    error.textContent = '配置名称不能超过 40 个字符。';
    error.hidden = false;
    input.focus();
    return;
  }

  state.busy.save = true;
  error.hidden = true;
  setBusy($('saveConfirmBtn'), true, '保存中…');

  try {
    const body = { name, config: state.options };
    if (state.contest) body.contest = state.contest;
    if (state.stats) body.stats = state.stats;

    await fetchJSON(API.configs, { method: 'POST', body, timeout: 30000 });
    setApiStatus(true);
    state.lastPresetName = name;
    schedulePersist();
    closeDialog($('saveDialog'));
    showToast(`配置「${name}」已保存。`, 'success');
    await loadConfigs({ silent: true });
  } catch (err) {
    if (err.status === 0) setApiStatus(false);
    error.textContent = `保存失败：${err.message}`;
    error.hidden = false;
  } finally {
    state.busy.save = false;
    setBusy($('saveConfirmBtn'), false);
  }
}

function openDeleteDialog(record) {
  state.deleteTarget = record;
  $('deleteConfigName').textContent = String(record.name || '未命名配置');
  openDialog($('deleteDialog'));
}

async function deleteConfig() {
  if (state.busy.remove) return;
  const target = state.deleteTarget;
  if (!target || target.id == null) return;

  state.busy.remove = true;
  setBusy($('deleteConfirmBtn'), true, '删除中…');

  try {
    await fetchJSON(`${API.configs}/${encodeURIComponent(target.id)}`, {
      method: 'DELETE',
      timeout: 15000,
    });
    state.deleteTarget = null;
    closeDialog($('deleteDialog'));
    showToast(`配置「${target.name || '未命名配置'}」已删除。`, 'success');
    await loadConfigs({ silent: true });
  } catch (err) {
    if (err.status === 0) setApiStatus(false);
    showToast(`删除失败：${err.message}`, 'error');
  } finally {
    state.busy.remove = false;
    setBusy($('deleteConfirmBtn'), false);
  }
}

async function previewAwards() {
  if (!state.contest) return showToast('请先载入比赛。', 'info');
  const target = $('awardPreview');
  target.hidden = false;
  target.textContent = '正在计算获奖名单…';
  const contest = state.contest;
  const options = JSON.stringify(state.options);
  setBusy($('previewAwardsBtn'), true, '计算中…');
  try {
    const result = await fetchJSON(API.awards, { method: 'POST', body: { contest, options: state.options } });
    if (contest !== state.contest || options !== JSON.stringify(state.options)) { target.hidden = true; return; }
    target.textContent = '';
    const teams = new Map(contest.teams.map((team) => [team.id, team.displayName || team.name || team.id]));
    for (const award of result.awards) {
      const section = document.createElement('section');
      const title = document.createElement('strong'); title.textContent = `${award.citation} · ${award.teamIds.length} 支队伍`;
      const list = document.createElement('p'); list.textContent = award.teamIds.map((id) => teams.get(id) || id).join('、');
      section.append(title, list); target.append(section);
    }
    if (!result.awards.length) target.textContent = '当前没有获奖记录。可配置金银铜、开启冠亚季军，或选择已有通过记录的题目生成最快解题奖。';
  } catch (err) { target.textContent = `计算失败：${err.message}`; }
  finally { setBusy($('previewAwardsBtn'), false); }
}

/* ==========================================================================
   Start resolving
   ========================================================================== */

async function prepareMedia() {
  if (!usableContest()) return showToast('请先载入赛事。', 'error');
  const button = $('prepareMediaBtn');
  if (button.disabled) return;
  button.disabled = true;
  const token = state.contestLoadToken;
  try {
    const { report } = await prepareOfflineContest(state.contest, {
      onProgress: (done, total) => { $('offlineMediaReport').textContent = `正在准备 ${done} / ${total} 张素材…`; },
    });
    $('offlineMediaReport').textContent = token !== state.contestLoadToken ? '赛事已切换，请重新检查当前赛事素材。' : report.failed
      ? `已缓存 ${report.cached} / ${report.total} 张；${report.failed} 张未就绪。${report.reasons.join('；')}。可检查网络或手动上传后重新检查。直接开场时，失败的校徽使用 ICPC Logo，照片使用赛事 Logo。`
      : `素材已就绪：${report.cached} 张图片已保存在本地。开场不依赖外网；主持与大屏仍需连接 Node 服务。`;
  } catch (err) { $('offlineMediaReport').textContent = `检查失败：${err.message}`; }
  finally { button.disabled = false; }
}

async function startResolve() {
  if (state.busy.start) return;
  if (!usableContest()) { showToast(state.source === 'offline' ? '请重新载入有效赛事，离线演示不能开始滚榜。' : '请先上传赛事事件流，再开始滚榜。', 'error'); return; }

  if (!state.contest) {
    showToast('请先载入赛事数据，再开始滚榜。', 'error');
    return;
  }

  if (state.apiOnline === false) {
    const ok = await loadConfigs({ silent: true });
    if (!ok && state.apiOnline === false) {
      showToast('Node API 离线，无法开始滚榜。', 'error');
      setPreviewError('服务未连接', '无法连接 Node API。启动服务后点击「重试」生成预览。');
      return;
    }
  }

  const opened = window.open('about:blank', '_blank');
  state.busy.start = true;
  setBusy($('startBtn'), true, '构建中…');

  try {
    const launchContest = structuredClone(state.contest);
    const launchOptions = structuredClone(state.options);
    const prepared = await prepareOfflineContest(launchContest, {
      onProgress: (done, total) => setBusy($('startBtn'), true, `准备素材 ${done}/${total}`),
    });
    setBusy($('startBtn'), true, '保存直播…');
    const result = await fetchJSON(API.game, {
      method: 'POST',
      body: { contest: prepared.contest, options: launchOptions, publish: true, mediaReport: prepared.report },
      timeout: 120000,
    });
    const id = result && (result.id || (result.game && result.game.id));
    if (!id) throw apiError('服务端未返回游戏 ID');

    state.gameId = id;
    state.game = result.game || null;
    setApiStatus(true);

    const url = `/play.html?id=${encodeURIComponent(id)}#control=${encodeURIComponent(result.controlToken)}`;
    if (opened && !opened.closed) {
      opened.location.replace(url);
      showToast('已在新标签页打开滚榜播放页。', 'success');
    } else {
      flushPersist();
      location.assign(url);
    }
  } catch (err) {
    if (err.status === 0) setApiStatus(false);
    if (opened && !opened.closed) opened.close();
    showToast(`无法开始滚榜：${err.message}`, 'error');
  } finally {
    state.busy.start = false;
    setBusy($('startBtn'), false);
  }
}

/* ==========================================================================
   Connection retry
   ========================================================================== */

async function retryConnection() {
  if (state.busy.retry) return;
  state.busy.retry = true;

  const pill = $('apiStatus');
  pill.dataset.state = 'checking';
  $('apiStatusText').textContent = '连接中…';
  setBusy($('retryConnBtn'), true, '连接中…');

  try {
    const ok = await loadConfigs({ silent: true });
    if (ok) {
      setApiStatus(true);
      if (usableContest()) {
        schedulePreview(0);
      }
      showToast('已连接 Node API。', 'success');
    } else if (state.apiOnline) {
      showToast('Node API 已连接，但配置列表加载失败。', 'info');
      if (state.contest && !state.previewDisabled) {
        schedulePreview(0);
      }
    } else {
      setApiStatus(false);
      showToast('仍无法连接 Node API，请确认服务已启动。', 'error');
      if (state.contest && !state.previewDisabled) {
        setPreviewError('服务未连接', '无法连接 Node API。启动服务后点击「重试」生成预览。');
      }
    }
  } finally {
    state.busy.retry = false;
    setBusy($('retryConnBtn'), false);
  }
}

/* ==========================================================================
   Toasts
   ========================================================================== */

const TOAST_ICONS = {
  success: 'i-check-circle',
  error: 'i-alert',
  info: 'i-info',
};

function showToast(message, type = 'info', duration = 4200) {
  const region = $('toastRegion');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    ${iconMarkup(TOAST_ICONS[type] || 'i-info')}
    <div class="toast-message"></div>
    <button type="button" class="toast-close" aria-label="关闭提示">${iconMarkup('i-x')}</button>
  `;
  toast.querySelector('.toast-message').textContent = message;

  const remove = () => {
    if (toast.classList.contains('is-leaving')) return;
    toast.classList.add('is-leaving');
    window.setTimeout(() => toast.remove(), 230);
  };

  toast.querySelector('.toast-close').addEventListener('click', remove);
  region.appendChild(toast);

  while (region.children.length > 4) {
    region.firstElementChild.remove();
  }

  if (duration > 0) {
    window.setTimeout(remove, duration);
  }
}

/* ==========================================================================
   Dialogs
   ========================================================================== */

function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

/* ==========================================================================
   Small helpers
   ========================================================================== */

function setBusy(button, busy, busyLabel) {
  if (!button) return;
  const label = button.querySelector('.btn-label');
  if (busy) {
    if (label && busyLabel && !button.dataset.prevLabel) {
      button.dataset.prevLabel = label.textContent;
      label.textContent = busyLabel;
    }
    button.classList.add('is-loading');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    if (label && button.dataset.prevLabel) {
      label.textContent = button.dataset.prevLabel;
      delete button.dataset.prevLabel;
    }
    button.classList.remove('is-loading');
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

function iconMarkup(symbol) {
  return `<svg class="icon" aria-hidden="true"><use href="#${symbol}"></use></svg>`;
}

function isContestLike(contest) {
  if (!contest || typeof contest !== 'object') return false;
  return (
    Array.isArray(contest.teams) ||
    Array.isArray(contest.problems) ||
    typeof contest.name === 'string'
  );
}

function isSafeLogo(url) {
  if (typeof url !== 'string' || !url) return false;
  return (
    /^data:image\//i.test(url) ||
    /^https?:\/\//i.test(url) ||
    /^blob:/i.test(url) ||
    /^\/(?!\/)/.test(url) ||
    /^\.{0,2}\//.test(url)
  );
}

function shortLabel(label) {
  const chars = Array.from(String(label || '队').replace(/\s+/g, ''));
  return chars.slice(0, 2).join('') || '队';
}

function apiError(message) {
  const error = new Error(message);
  error.status = null;
  return error;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatSpeed(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '1.0×';
  return `${Number.isInteger(n) ? n.toFixed(1) : String(n)}×`;
}


function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('zh-CN');
}

function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const minutes = Math.round(n / 60000);
  if (minutes >= 120 && minutes % 60 === 0) return `${minutes / 60} 小时`;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} 小时 ${rest} 分` : `${minutes} 分钟`;
  }
  return `${minutes} 分钟`;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatSavedAt(value) {
  if (value == null) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff >= 0 && diff < 60 * 1000) return '刚刚';
  if (diff >= 0 && diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff >= 0 && diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
