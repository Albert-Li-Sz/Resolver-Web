import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { FREEZE_DEFAULTS, normalizeFreezeOptions } from '../public/js/freeze.js';
import { MEDAL_DEFAULTS, normalizeMedalOptions } from '../public/js/medals.js';
import { applySchoolLogos } from '../public/js/school-logos.js';
import { applyMediaLibrary, preserveContestMedia } from '../public/js/media-library.js';
import { AutomaticAdvance } from '../public/js/automatic-advance.js';
import { actionIndicesFor, startIndexFor, nextAutomaticAction } from '../public/js/playback-model.js';
import { readJSONResponse } from '../public/js/http.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const contest = (name) => ({ name, teams: [{ id: 'a' }], problems: [{ id: 'p' }] });
const classes = () => ({ add() {}, remove() {}, toggle() {}, contains() { return false; } });
const node = () => ({ hidden: false, value: '', textContent: '', style: {}, dataset: {}, classList: classes(), addEventListener() {}, querySelector: () => null });

async function configHarness() {
  const text = (await readFile(new URL('../public/js/config.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('\ninit();', '\n');
  const nodes = new Map(); const timers = new Map(); let timer = 0;
  const context = { FREEZE_DEFAULTS, MEDAL_DEFAULTS, normalizeFreezeOptions, normalizeMedalOptions,
    applySchoolLogos, applyMediaLibrary, preserveContestMedia, structuredClone, URL, console,
    MediaLibraryUI: class { items = []; async load() {} clearReport() {} showReport() {} },
    window: { confirm: () => true }, document: { getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id);
    } },
    setTimeout(fn, delay) { const id = ++timer; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.createContext(context);
  vm.runInContext(text + `
    fetchJSON = (...args) => http(...args);
    loadConfigs = async () => { await configsReady(); state.apiOnline = true; };
    renderSummary = resetLogoManager = syncOptionControls = updateOptionOutputs = updateSourceBadge = () => {};
    schedulePersist = rememberState = showToast = setFileStatus = setBusy = () => {};
    setPreviewState = (kind) => { state.previewState = kind; };
    globalThis.entry = { state, boot, applyPreset, handleFile, buildPreview, commitOptions };
  `, Object.assign(context, { configsReady: async () => {}, http: async () => ({}) }));
  return { ...context.entry, nodes, timers, context };
}

test('slow startup restoration cannot replace a contest loaded by the user in the meantime', async () => {
  const h = await configHarness();
  const ready = deferred(); h.context.configsReady = () => ready.promise;
  const boot = h.boot({ contest: contest('Previously saved'), options: {} });
  await h.applyPreset({ name: 'New preset', contest: contest('Latest contest'), config: { title: 'Latest title' } });
  ready.resolve(); await boot;
  assert.equal(h.state.contest.name, 'Latest contest');
  assert.equal(h.state.options.title, 'Latest title');
});

test('a late file import cannot replace a newer preset selection', async () => {
  const h = await configHarness();
  const parsed = deferred(); h.context.http = () => parsed.promise;
  const uploading = h.handleFile({ name: 'old.ndjson', size: 10, text: async () => '{}' });
  await new Promise(setImmediate);
  await h.applyPreset({ name: 'New preset', contest: contest('Latest contest'), config: {} });
  parsed.resolve({ contest: contest('Stale upload') }); await uploading;
  assert.equal(h.state.contest.name, 'Latest contest');
  assert.equal(h.state.busy.parse, false);
});

test('concurrent preset responses preserve the latest selection and its options', async () => {
  const h = await configHarness();
  const first = deferred(), second = deferred();
  h.context.http = (url) => url.endsWith('/first') ? first.promise : second.promise;
  const oldLoad = h.applyPreset({ id: 'first', name: 'First', hasContest: true });
  const newLoad = h.applyPreset({ id: 'second', name: 'Second', hasContest: true });
  second.resolve({ name: 'Second', contest: contest('Second'), config: { title: 'Second title' } }); await newLoad;
  first.resolve({ name: 'First', contest: contest('First'), config: { title: 'First title' } }); await oldLoad;
  assert.equal(h.state.contest.name, 'Second');
  assert.equal(h.state.options.title, 'Second title');
});

test('changing preview options invalidates the in-flight response before the debounce fires', async () => {
  const h = await configHarness();
  h.state.contest = contest('Preview'); h.state.apiOnline = true;
  const oldResult = deferred(); h.context.http = () => oldResult.promise;
  const oldBuild = h.buildPreview();
  h.state.options.title = 'New title'; h.commitOptions();
  oldResult.resolve({ id: 'old', game: { meta: {} }, controlToken: 'old-token' }); await oldBuild;
  assert.equal(h.state.gameId, null);
  assert.equal(h.nodes.get('previewFrame').src, undefined);
  h.context.http = async () => ({ id: 'new', game: { meta: {} }, controlToken: 'new-token' });
  await h.buildPreview();
  assert.equal(h.state.gameId, 'new');
  assert.match(h.nodes.get('previewFrame').src, /id=new/);
});

async function presenterHarness(position) {
  const text = (await readFile(new URL('../public/js/play.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('\nboot();', '\n');
  const nodes = new Map(); const requests = [];
  const context = { actionIndicesFor, startIndexFor, nextAutomaticAction, AutomaticAdvance, readJSONResponse, URL, URLSearchParams,
    performance, AbortSignal, console, setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame() {},
    location: { search: '?id=fixture', hash: '', origin: 'http://localhost:4173', hostname: 'localhost' },
    window: { addEventListener() {} }, document: { body: { classList: classes() }, addEventListener() {}, getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id);
    } },
    fetch: async (url, options) => {
      requests.push(JSON.parse(options.body));
      return requests.length === 1
        ? Response.json({ playback: { revision: 1, index: 4 } }, { status: 409 })
        : Response.json({ playback: { revision: 2, index: requests.at(-1).index } });
    }, position,
  };
  vm.createContext(context);
  vm.runInContext(text + `
    steps = Array.from({ length: 6 }, () => ({ type: 'presentation', screen: 'scoreboard' }));
    game = { options: { startScreen: 'scoreboard' }, steps };
    actionIndices = actionIndicesFor(steps); actionPos = position; index = position;
    view = { seek() {}, applyStep() {} };
    globalThis.entry = { goToStart, goPrevious, moveTo, syncPlayback, get connected() { return connected; }, get index() { return index; } };
  `, context);
  return { entry: context.entry, ...context.entry, requests, context };
}

test('Home stays an absolute jump during a presenter conflict while Previous remains relative', async () => {
  const home = await presenterHarness(1);
  await home.goToStart();
  assert.deepEqual(home.requests.map((request) => request.index), [0, 0]);
  const previous = await presenterHarness(2);
  await previous.goPrevious();
  assert.deepEqual(previous.requests.map((request) => request.index), [1, 3]);
});

test('the fixed viewer releases old views, ignores stale boot errors and probes without downloading snapshots', async () => {
  const text = (await readFile(new URL('../public/js/watch.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('\nboot();', '\n');
  const nodes = new Map(), timers = new Map(); const views = [], streams = [], probes = [];
  let current = 'first', sequence = 0, lateBoot = null;
  class EventSource {
    static CLOSED = 2;
    constructor() { this.handlers = {}; streams.push(this); }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    close() { this.readyState = 2; }
  }
  const context = { EventSource, URLSearchParams, performance, readJSONResponse, AbortSignal, console,
    location: { search: '' }, navigator: { onLine: true }, requestAnimationFrame() {},
    window: { addEventListener() {} }, document: { body: { classList: classes() }, fonts: { load: async () => {} },
      addEventListener() {}, getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    ResolverView: class {
      constructor(canvas, game) { this.id = game.id; this.disposed = 0; views.push(this); }
      seek() {} dispose() { this.disposed++; }
    },
    fetch: async (url, options) => {
      if (options.method === 'HEAD') { probes.push(options.method); return new Response(null, { status: 204 }); }
      if (url === '/api/watch/current') return Response.json({ id: current, name: current });
      if (lateBoot) { const pending = lateBoot; lateBoot = null; return pending.promise; }
      return Response.json({ game: { id: current, contest: { name: current }, steps: [] },
        playback: { index: 0, revision: 0, currentAction: 1, totalActions: 10 } });
    },
  };
  vm.createContext(context);
  vm.runInContext(text + '\nglobalThis.entry = { findCurrent, boot };', context);
  await context.entry.findCurrent();
  assert.equal(views[0].id, 'first');
  current = 'second'; await context.entry.findCurrent();
  assert.equal(views[0].disposed, 1);
  assert.equal(views[1].id, 'second');
  await streams.at(-1).onerror();
  assert.deepEqual(probes, ['HEAD']);
  const pending = deferred(); lateBoot = pending;
  const oldBoot = context.entry.boot();
  current = 'third'; await context.entry.findCurrent();
  pending.resolve(Response.error()); await oldBoot;
  await new Promise(setImmediate);
  assert.equal(views[1].disposed, 1);
  assert.equal(views.at(-1).id, 'third');
  assert.equal(nodes.get('error').hidden, true);
  assert.equal(nodes.get('hud-contest').textContent, 'third');
});


test('a poll started before an uncertain move cannot unlock presenter controls with stale progress', async () => {
  const h = await presenterHarness(0);
  const oldPoll = deferred();
  h.context.fetch = async (_url, options) => {
    if (options.method === 'PUT') throw new Error('response lost after server commit');
    return oldPoll.promise;
  };
  const pending = h.entry.syncPlayback();
  assert.equal(await h.entry.moveTo(1), undefined);
  assert.equal(h.entry.connected, false);
  oldPoll.resolve(Response.json({ playback: { revision: 0, index: 0 } }));
  await pending;
  assert.equal(h.entry.connected, false, 'old pre-mutation poll must not reopen controls');
  h.context.fetch = async () => Response.json({ playback: { revision: 1, index: 1 } });
  await h.entry.syncPlayback();
  assert.equal(h.entry.connected, true);
  assert.equal(h.entry.index, 1, 'read the committed progress before accepting another click');
});
