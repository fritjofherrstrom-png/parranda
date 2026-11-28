import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

// Mount the unchanged real component/layout. Only MapLibre's WebGL/transport
// boundary and browser layout/ResizeObserver delivery are controlled here.
// No tiles, providers or geolocation services are contacted.
const require = createRequire(import.meta.url);
const temp = await mkdtemp(join(tmpdir(), 'route-map-location-'));
const output = join(temp, 'map.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('../src/components/planner/RouteMap.tsx', import.meta.url))],
  outfile: output, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent',
  plugins: [{ name: 'controlled-map-runtime', setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, args => ({ path: require.resolve(args.path), external: true }));
    builder.onResolve({ filter: /^maplibre-gl/ }, args => ({ path: args.path, namespace: 'controlled-map' }));
    builder.onLoad({ filter: /.*/, namespace: 'controlled-map' }, () => ({ loader: 'js', contents: `
      const runtime = () => globalThis.__routeMapLocation;
      export default {};
      export const setWorkerUrl = () => {};
      export class Map {
        constructor({container}) {
          if (runtime().failMap) throw new Error('Controlled WebGL unavailable');
          this.container = container; this.events = {}; this.sources = {}; this.layers = {};
          this.zoom = 12; this.center = [13, 55.6]; runtime().maps.push(this);
        }
        on(type, ...args) { (this.events[type] ??= []).push(args.at(-1)); return this; }
        once(type, callback) { return this.on(type, callback); }
        off() {}
        remove() { for (const fn of this.events.remove || []) fn(); }
        addControl() {}
        getCanvas() { return this.container; }
        isStyleLoaded() { return true; }
        addSource(id) { this.sources[id] = { setData: data => { this.sources[id].data = data; } }; }
        getSource(id) { return this.sources[id]; }
        addLayer(layer) { this.layers[layer.id] = layer; }
        getLayer(id) { return this.layers[id]; }
        setPaintProperty() {}
        resize() { runtime().resizes++; }
        getZoom() { return this.zoom; }
        jumpTo(options) {
          runtime().camera.push(options);
          if (options.zoom !== undefined) this.zoom = options.zoom;
          if (options.center) this.center = options.center;
        }
        fitBounds(...args) { runtime().camera.push({fitBounds: args}); }
        project([lng, lat]) { runtime().projects++; return {x: 250 + (lng-13)*1000, y: 70-(lat-55.6)*1000}; }
      }
      export class Marker {
        constructor({element, offset = [0,0]}) { this.element = element; this.offset = offset; }
        setLngLat(value) { this.at = value; return this; }
        addTo(map) { map.container.append(this.element); return this; }
        setOffset(offset) { this.offset = offset; runtime().offsets.push([...offset]); }
        remove() { this.element.remove(); }
      }
      export class NavigationControl {}
      export class AttributionControl {}
    ` }));
  } }],
});
const { default: RouteMap } = await import(pathToFileURL(output).href);
test.after(() => rm(temp, { recursive: true, force: true }));

const stops = [{ id: 'a', label: 'Museum', lat: 55.6, lng: 13 }, { id: 'b', label: 'Park', lat: 55.65, lng: 12.9 }];
const rect = (left, top, right, bottom) => ({ left, top, right, bottom, x: left, y: top, width: right-left, height: bottom-top, toJSON() {} });

async function mount(t, { failMap = false, enabled = false, status = 'idle' } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const { window } = dom;
  const runtime = { failMap, maps: [], camera: [], projects: 0, resizes: 0, offsets: [], chipReads: [] };
  const frames = new Map(), observers = new Set();
  let frameId = 0, chipBox = rect(220, 10, 380, 54);
  class ControlledResizeObserver {
    constructor(callback) { this.callback = callback; this.targets = new Set(); this.initial = new Set(); observers.add(this); }
    observe(target) { this.targets.add(target); this.initial.add(target); }
    disconnect() { this.targets.clear(); this.initial.clear(); observers.delete(this); }
  }
  const prior = new Map();
  for (const [key, value] of Object.entries({ window, document: window.document, Node: window.Node,
    Element: window.Element, HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
    ResizeObserver: ControlledResizeObserver, getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id), IS_REACT_ACT_ENVIRONMENT: true, __routeMapLocation: runtime })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute('data-location-status')) { runtime.chipReads.push({...chipBox}); return chipBox; }
    if (this.hasAttribute('data-map-control')) return rect(330, 230, 380, 274);
    return rect(0, 0, 390, 300);
  };
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 390, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 300, configurable: true });
  const root = createRoot(window.document.getElementById('root'));
  let props = { hasPrimaryRoute: true, routeStops: stops, primaryRoute: { map_path_points: [] },
    areas: [], routeContextSuggestions: [], showContext: false, sketch: true,
    heightClass: 'h-[300px]', positionEnabled: enabled, positionSession: { supported: true, state: { status } },
    t: (_, en) => en };
  const run = callback => act(async () => { await callback?.(); });
  async function render(update = {}) { props = {...props, ...update}; await run(() => root.render(React.createElement(RouteMap, props))); }
  async function settle() {
    // Deliver only native-equivalent initial observer notifications, followed
    // by explicitly requested frames. Bound the loop so feedback is a failure.
    for (let i = 0; i < 6; i++) {
      const pending = [...observers].filter(observer => observer.initial.size);
      if (!pending.length && !frames.size) return;
      await run(() => {
        for (const observer of pending) {
          const entries = [...observer.initial].map(target => ({target}));
          observer.initial.clear(); observer.callback(entries);
        }
        const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0));
      });
    }
    assert.fail('location control layout must settle without a feedback loop');
  }
  t.after(async () => {
    await run(() => root.unmount());
    assert.equal(frames.size, 0, 'unmount cancels owned layout frames');
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    dom.window.close();
  });
  await render(); await settle();
  return { runtime, window, document: window.document, render, settle, run,
    state: async (next, positionEnabled = true) => { await render({positionEnabled, positionSession: {supported: true, state: {status: next}}}); await settle(); },
    resizeChip: async box => { chipBox = box; await run(() => {
      const chip = window.document.querySelector('[data-location-status]');
      for (const observer of observers) if (observer.targets.has(chip)) {
        observer.callback([{target: chip}]);
        observer.callback([{target: chip}]); // multiple deliveries coalesce into one frame
      }
    }); await settle(); },
    observed: target => [...observers].some(observer => observer.targets.has(target)),
    updateStatus: next => {
      props = {...props, positionSession: {supported: true, state: {status: next}}};
      root.render(React.createElement(RouteMap, props));
    },
    pendingFrames: () => frames.size,
  };
}

for (const terminalStatus of ['denied', 'unavailable']) test(`F2 location control appearance and ${terminalStatus} size changes reach the real marker layout before a GPS fix`, async t => {
  const h = await mount(t), {runtime} = h;
  assert.equal(h.document.querySelectorAll('.route-map-marker-shell').length, 2, 'real component drew the fixture stops');
  const camera = structuredClone(runtime.camera), resizes = runtime.resizes;
  const before = runtime.projects;
  await h.state('locating');
  assert.ok(runtime.projects > before, 'appearing location chip must re-evaluate the real marker layout');
  assert.ok(runtime.chipReads.length > 0, 'real controlBoxes must measure the new chip');
  const chip = h.document.querySelector('[data-location-status]');
  assert.ok(h.observed(chip), 'observe the chip, not only its unchanged map container');
  await h.state(terminalStatus);
  const prior = runtime.projects;
  await h.resizeChip(rect(120, 10, 380, 96));
  assert.equal(runtime.projects - prior, stops.length, 'multiple control resize notifications coalesce into one real marker layout');
  assert.equal(runtime.chipReads.at(-1).bottom, 96, 'layout consumes the new actual keepout extent');
  assert.deepEqual(runtime.camera, camera, 'status appearance/resize must not refit, recenter or zoom');
  assert.equal(runtime.resizes, resizes, 'status changes do not resize/reset the map');
  assert.equal(h.document.querySelectorAll('[data-current-position]').length, 0, 'no GPS fix was needed');
  t.diagnostic(JSON.stringify({terminalStatus, layoutProjectCallsBefore: before, layoutProjectCallsAfter: runtime.projects,
    resizeLayoutProjectCalls: runtime.projects - prior, measuredKeepout: Object.fromEntries(['left','top','right','bottom'].map(key => [key, runtime.chipReads.at(-1)[key]])), cameraUnchanged: true, mapResizeUnchanged: true}));
  await h.state('idle', false);
  assert.equal(h.observed(chip), false, 'removed status controls release their observer');
  assert.equal(h.pendingFrames(), 0);
});

for (const failMap of [true, false]) test(`F3 keyboard-equivalent Retry keeps focus on surviving Stop location (${failMap ? 'mapFailed fallback' : 'ordinary map preservation'})`, async t => {
  const h = await mount(t, {failMap, enabled: true, status: 'unavailable'});
  let retries = 0;
  await h.render({onLocate: () => { retries++; h.updateStatus('locating'); }});
  const retry = [...h.document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Try again');
  const stop = h.document.querySelector('button[aria-label="Stop location"]');
  assert.ok(retry && stop, 'real branch renders both controls before retry');
  assert.equal(Boolean(h.document.querySelector('[data-route-map]')), !failMap, 'exercise the declared real rendering branch');
  retry.focus();
  assert.equal(h.document.activeElement === retry, true);
  // Keyboard activation produces a click with detail=0; jsdom does not
  // synthesize default button activation from a dispatched keydown.
  await h.run(() => retry.dispatchEvent(new h.window.MouseEvent('click', {bubbles: true, detail: 0})));
  assert.equal(retries, 1);
  assert.equal(retry.isConnected, false, 'locating removes Retry');
  assert.equal(stop.isConnected, true, 'the same Stop button survives locating');
  assert.equal(h.document.activeElement === stop, true, 'Retry must hand focus to the surviving Stop location button in this branch');
  t.diagnostic(JSON.stringify({branch: failMap ? 'fallback' : 'ordinary', retryRemoved: !retry.isConnected,
    focusedControl: h.document.activeElement.getAttribute('aria-label'), sameStopSurvived: stop.isConnected}));
  await h.settle();
});
