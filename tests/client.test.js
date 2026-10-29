import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { readJSONResponse } from '../public/js/http.js';
import { FREEZE_DEFAULTS, normalizeFreezeOptions } from '../public/js/freeze.js';
import { MEDAL_DEFAULTS, normalizeMedalOptions } from '../public/js/medals.js';

test('fresh online and offline boots stay empty without synthetic demo data', async () => {
  const text = (await readFile(new URL('../public/js/config.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('\ninit();', '\n');
  for (const online of [true, false]) {
    const previewStates = [];
    const context = { FREEZE_DEFAULTS, MEDAL_DEFAULTS, MediaLibraryUI: class { async load() {} },
      document: {}, window: {}, setTimeout, clearTimeout, console, online };
    vm.createContext(context);
    vm.runInContext(text + `\nloadConfigs = async () => { state.apiOnline = online; };
      renderSummary = () => rendered++;
      setPreviewState = (kind) => previewStates.push(kind);
      globalThis.entry = { boot, state };`, Object.assign(context, { previewStates, rendered: 0 }));
    await context.entry.boot(null);
    assert.equal(context.entry.state.contest, null);
    assert.equal(context.entry.state.game, null);
    assert.equal(previewStates.at(-1), 'empty');
    assert.ok(context.rendered >= 1);
  }
});

test('offline data cannot be saved or published after the API comes online', async () => {
  const text = (await readFile(new URL('../public/js/config.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('\ninit();', '\n');
  let requests = 0; let popups = 0; const messages = [];
  const context = { FREEZE_DEFAULTS, MEDAL_DEFAULTS, normalizeFreezeOptions, normalizeMedalOptions, readJSONResponse,
    MediaLibraryUI: class {}, document: { getElementById: () => ({}) },
    window: { open: () => { popups++; } }, fetch: () => { requests++; },
    setTimeout, clearTimeout, AbortController, console };
  vm.createContext(context);
  vm.runInContext(text + `\nshowToast = (text) => messages.push(text);
    state.contest = { name: 'offline', teams: [], problems: [] }; state.source = 'offline';
    state.apiOnline = true; state.previewDisabled = true;
    globalThis.entry = { startResolve, saveConfig };`, Object.assign(context, { messages }));
  await context.entry.startResolve();
  await context.entry.saveConfig({ preventDefault() {} });
  assert.equal(requests, 0); assert.equal(popups, 0);
  assert.equal(messages.length, 2);
  assert.ok(messages.every((message) => message.includes('离线演示')));
});

test('proxy HTML errors are readable without leaking their body', async () => {
  await assert.rejects(readJSONResponse(new Response('<html>INTERNAL-SECRET</html>', { status: 503 })), (err) =>
    err.status === 503 && err.message.includes('HTTP 503') && !err.message.includes('SECRET'));
});

test('a ready preview exposes the canvas; loading and error states restore the overlay', async () => {
  const text = (await readFile(new URL('../public/js/config.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('\ninit();', '\n');
  const nodes = new Map();
  const context = { FREEZE_DEFAULTS, MEDAL_DEFAULTS, MediaLibraryUI: class {},
    document: { getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { hidden: false, dataset: {}, classList: { add() {}, remove() {} } });
      return nodes.get(id);
    } }, window: {}, setTimeout, clearTimeout, console };
  vm.createContext(context);
  vm.runInContext(text + '\nglobalThis.setState = setPreviewState;', context);
  context.setState('ready');
  assert.equal(nodes.get('previewOverlay').hidden, true);
  for (const kind of ['loading', 'error', 'empty']) {
    context.setState(kind);
    assert.equal(nodes.get('previewOverlay').hidden, false, kind);
    const visible = { loading: 'previewLoading', error: 'previewError', empty: 'previewEmpty' }[kind];
    assert.equal(nodes.get(visible).hidden, false);
  }
  context.setState('ready'); assert.equal(nodes.get('previewOverlay').hidden, true);
});

test('spectator reconnects CLOSED streams after errors, skips duplicate snapshots and keeps healthy connections', async () => {
  const text = (await readFile(new URL('../public/js/watch.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('\nboot();', '\n');
  const nodes = new Map(); const events = {}; const timers = new Map(); const streams = [];
  let nextTimer = 0; let seeks = 0;
  const node = () => ({ hidden: false, textContent: '', style: {}, addEventListener() {} });
  const document = { hidden: false, body: { classList: { toggle() {}, remove() {}, contains() { return false; }, add() {} } },
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
    addEventListener(name, fn) { events[name] = fn; } };
  class EventSource {
    static CLOSED = 2;
    constructor() { this.readyState = 0; this.handlers = {}; streams.push(this); }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    close() { this.readyState = 2; }
  }
  const context = { document, window: { addEventListener(name, fn) { events[name] = fn; } }, navigator: { onLine: true },
    location: { search: '?id=fixture' }, URLSearchParams, performance, EventSource, readJSONResponse,
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch: async () => new Response('{}', { status: 503 }), AbortSignal, requestAnimationFrame() {}, console,
    ResolverView: class { seek() { seeks++; } } };
  vm.createContext(context);
  vm.runInContext(text + '\nglobalThis.entry = { connect, snapshot };', context);
  const data = { game: { steps: [] }, playback: { revision: 1, index: 0, currentAction: 1, totalActions: 3 } };
  context.entry.snapshot(data);
  context.entry.connect();
  streams[0].readyState = 1; streams[0].onopen();
  events.visibilitychange();
  assert.equal(streams.length, 1);
  context.entry.snapshot(data); assert.equal(seeks, 1, 'GET and first SSE snapshot must not replay twice');
  await streams[0].onerror();
  const retry = [...timers.values()].find(({ delay }) => delay === 500);
  assert.ok(retry, 'a timer must revive even a permanently CLOSED EventSource');
  retry.fn();
  assert.equal(streams.length, 2);
  streams[1].readyState = 1; streams[1].onopen();
  context.entry.snapshot({ ...data, playback: { ...data.playback, revision: 2 } });
  assert.equal(seeks, 2);
});
