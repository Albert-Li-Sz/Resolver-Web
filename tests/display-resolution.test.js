import test from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY_DEFAULTS, normalizeDisplay, displayGeometry, renderDimensions, readDisplaySettings, saveDisplaySettings } from '../public/js/display-preferences.js';
import { ResolverView } from '../public/js/render/resolver-view.js';
import { buildGame } from '../server/lib/engine.js';
import { createDemo } from '../server/lib/demo.js';

test('fresh output and legacy LED preferences default to 2K without losing calibration', () => {
  assert.equal(DISPLAY_DEFAULTS.resolution, '1440p');
  const legacy = normalizeDisplay({ region: 'top', aspect: '32:9', margin: 5 });
  assert.equal(legacy.region, 'top'); assert.equal(legacy.aspect, '32:9'); assert.equal(legacy.margin, 5);
  assert.equal(legacy.resolution, '1440p');
  for (const value of [null, 'toString', '8k', 2160, {}]) {
    assert.equal(normalizeDisplay({ resolution: value }).resolution, '1440p');
    assert.deepEqual(renderDimensions(1920, value), { width: 2560, height: 1440 });
  }
});

test('selectable pixel sizes preserve logical aspect ratio and bound extreme LED allocation', () => {
  for (const [resolution, width, height] of [['1080p', 1920, 1080], ['1440p', 2560, 1440], ['2160p', 3840, 2160]]) {
    assert.deepEqual(renderDimensions(1920, resolution), { width, height });
    const geometry = displayGeometry({ region: 'top', aspect: '32:9', resolution }, 1920, 1080);
    assert.equal(geometry.logicalWidth, 3840);
    assert.deepEqual(renderDimensions(geometry.logicalWidth, resolution), { width: width * 2, height });
  }
  assert.deepEqual(renderDimensions(1440, '2160p'), { width: 2880, height: 2160 });
  const extreme = renderDimensions(5760, '2160p');
  assert.equal(extreme.width, 8192); assert.ok(extreme.height > 1440 && extreme.height < 2160);
});

test('display preferences survive reload and unavailable or corrupt storage falls back safely', (t) => {
  const previous = { localStorage: globalThis.localStorage, window: globalThis.window, CustomEvent: globalThis.CustomEvent };
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  } });
  let stored = null, events = 0;
  globalThis.localStorage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
  globalThis.window = { dispatchEvent: () => { events++; } };
  globalThis.CustomEvent = class {};
  assert.equal(saveDisplaySettings({ region: 'top', resolution: '2160p' }), true);
  assert.equal(readDisplaySettings().resolution, '2160p'); assert.equal(readDisplaySettings().region, 'top');
  assert.equal(events, 1);
  stored = '{broken'; assert.deepEqual(readDisplaySettings(), DISPLAY_DEFAULTS);
  globalThis.localStorage.getItem = () => { throw new Error('unavailable'); };
  globalThis.localStorage.setItem = () => { throw new Error('quota'); };
  assert.deepEqual(readDisplaySettings(), DISPLAY_DEFAULTS);
  assert.equal(saveDisplaySettings({ resolution: '2160p' }), false);
});

test('resolution changes redraw real pixels without changing ranking, scroll, or award progress', async (t) => {
  const oldImage = globalThis.Image;
  globalThis.Image = class {};
  t.after(() => { if (oldImage === undefined) delete globalThis.Image; else globalThis.Image = oldImage; });
  const transforms = [];
  const ctx = new Proxy({ measureText: () => ({ width: 20 }), setTransform: (...args) => transforms.push(args) }, {
    get(target, key) { return key in target ? target[key] : () => {}; },
  });
  const canvas = { style: {}, dataset: {}, getContext: () => ctx };
  const demo = createDemo();
  const game = buildGame(demo.contest, { ...demo.options, showAwards: true });
  const view = new ResolverView(canvas, game);
  await view.ready();
  view.seek(game.steps, game.steps.findIndex((s) => s.screen === 'teamAward'));
  const before = view.captureState();
  const layout = { ...view.layout };
  for (const [resolution, width, height] of [['1080p', 1920, 1080], ['1440p', 2560, 1440], ['2160p', 3840, 2160]]) {
    canvas.dataset.resolution = resolution; view.resize(); view.render(10000);
    assert.equal(canvas.width, width); assert.equal(canvas.height, height);
    assert.deepEqual(view.captureState(), before);
    assert.deepEqual(view.layout, layout);
    assert.deepEqual(transforms.at(-1), [width / 1920, 0, 0, height / 1080, 0, 0]);
  }
  view.dispose();
});

test('an open preview follows resolution changes from another tab and releases all listeners', (t) => {
  const previous = { Image: globalThis.Image, window: globalThis.window, localStorage: globalThis.localStorage };
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  } });
  const listeners = new Map(); let resolution = '1440p';
  globalThis.Image = class {};
  globalThis.localStorage = { getItem: () => JSON.stringify({ resolution }) };
  globalThis.window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const canvas = { style: {}, dataset: {}, getContext: () => ({ measureText: () => ({ width: 20 }) }) };
  const demo = createDemo(); const game = buildGame(demo.contest, demo.options);
  const view = new ResolverView(canvas, game); const before = view.captureState();
  assert.equal(canvas.width, 2560);
  resolution = '2160p'; listeners.get('storage')({ type: 'storage', key: 'unrelated' });
  assert.equal(canvas.width, 2560);
  listeners.get('storage')({ type: 'storage', key: 'resolver.display.v1' });
  assert.equal(canvas.width, 3840); assert.equal(canvas.height, 2160);
  assert.deepEqual(view.captureState(), before);
  view.dispose(); assert.equal(listeners.size, 0);
});
