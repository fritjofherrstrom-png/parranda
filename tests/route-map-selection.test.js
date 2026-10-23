'use strict';

// Real RouteMap, React, MapLibre and production CSS in Chromium. The height
// transition is controlled; all external requests (including tiles) are refused.
// No API fixtures, provider/cache calls or committed dist are involved.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const frontend = path.resolve(__dirname, '../frontend');
let browser, server, temp, origin;

test.before(async () => {
  temp = await fs.mkdtemp(path.join(frontend, '.map-selection-'));
  const entry = path.join(temp, 'entry.tsx');
  await fs.writeFile(entry, `import React from 'react'; import {createRoot} from 'react-dom/client'; import RouteMap from '../src/components/planner/RouteMap';
import {Map as FixtureMap} from 'maplibre-gl';
window.mapInteractionTrace=[];
const originalFire=FixtureMap.prototype.fire;
FixtureMap.prototype.fire=function(event,...args){
  window.mapFixtureInstance=this;
  const type=typeof event==='string'?event:event.type;
  if(['movestart','zoomstart','zoomend','moveend'].includes(type)) window.mapInteractionTrace.push({type,zoom:this.getZoom(),original:event.originalEvent?.type});
  return originalFire.call(this,event,...args);
};
const empty=[];
function Harness(){
  const [expanded,setExpanded]=React.useState(false);
  const [stops,setStops]=React.useState([{id:'a',label:'Stop A',lat:55.595,lng:12.99},{id:'b',label:'Stop B',lat:55.598,lng:12.998},{id:'c',label:'Stop C',lat:55.603,lng:13.01}]);
  window.setMapTestStops=setStops;
  const route=React.useMemo(()=>({map_path_points:stops}),[stops]);
  return <main style={{padding:12,minHeight:1800}}><button onClick={()=>setStops([{id:'new',label:'New day',lat:55.6,lng:13}])}>New day</button><section aria-label="The route"><RouteMap hasPrimaryRoute={true} routeStops={stops} primaryRoute={route} areas={empty} routeContextSuggestions={empty} showContext={false} sketch={true} mapExpanded={expanded} onToggleExpanded={()=>setExpanded(!expanded)} heightClass={expanded?'h-[420px]':'h-[190px]'} t={(_,en)=>en}/></section><button>Outside map</button></main>;
} createRoot(document.getElementById('root')).render(<Harness/>);`);

  const compiler = path.join(frontend, 'node_modules/esbuild/bin/esbuild');
  const compile = args => execFileSync(compiler, [...args, '--log-level=silent'], { cwd: frontend, stdio: 'pipe', timeout: 30000 });
  compile([path.join(frontend, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs'), '--bundle',
    `--outfile=${path.join(temp, 'maplibre-worker.js')}`, '--format=esm']);
  const workerModule = path.join(temp, 'worker-url.mjs');
  await fs.writeFile(workerModule, 'export default "/maplibre-worker.js"');
  // The CLI produces the same real component/worker bundle without keeping a
  // compiler service alive alongside each browser fixture.

  compile([entry, '--bundle', `--outdir=${temp}`, '--format=iife', '--jsx=automatic', '--loader:.png=dataurl',
    `--alias:maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url=${workerModule}`]);
  await fs.writeFile(path.join(temp, 'input.css'), `@import ${JSON.stringify(path.join(frontend, 'src/styles/tokens.css'))};\n@import ${JSON.stringify(path.join(frontend, 'src/styles/tailwind.css'))};\n@source not ${JSON.stringify(path.join(frontend, 'src'))};\n@source ${JSON.stringify(entry)};\n@source ${JSON.stringify(path.join(frontend, 'src/components/planner/RouteMap.tsx'))};\n`);

  execFileSync(process.execPath, [path.join(frontend, 'node_modules/@tailwindcss/cli/dist/index.mjs'), '-i', path.join(temp, 'input.css'), '-o', path.join(temp, 'tailwind.css')], { cwd: frontend, stdio: 'pipe' });

  server = http.createServer(async (req, res) => {
    try {
      const file = req.url === '/' ? null : path.join(temp, path.basename(req.url));
      res.setHeader('Content-Type', req.url.endsWith('.js') ? 'application/javascript' : req.url.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(file ? await fs.readFile(file) : '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/entry.css"><link rel="stylesheet" href="/tailwind.css"><div id="root"></div><script src="/entry.js"></script>');
    } catch { res.statusCode = 404; res.end(); }
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch({ ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
test.after(async () => {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (temp) await fs.rm(temp, { recursive: true, force: true });
});

async function pageFor(t, hasTouch = false, diagnostics = null) {

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    if (diagnostics) {
      try {
        const state = await page.evaluate(() => {
          const frame = document.querySelector('[data-route-map]');
          const animation = window.expansionTransition;
          return { readyState: document.readyState, markerCount: document.querySelectorAll('.route-map-marker').length,
            height: frame?.getBoundingClientRect().height, frameClass: frame?.className,
            animation: animation ? { playState: animation.playState, currentTime: animation.currentTime } : null,
            tooltips: [...document.querySelectorAll('[role="tooltip"]')].map(node => node.textContent),
            scrollY, trace: window.selectionTrace || [], mapTrace: window.mapInteractionTrace || [], body: document.body.innerText.slice(0, 2000) };
        });
        t.diagnostic(JSON.stringify({ stage: diagnostics.stage, state }));
      } catch (error) { t.diagnostic(JSON.stringify({ stage: diagnostics.stage, captureError: String(error) })); }
    }
    try { assert.deepEqual(errors, [], 'no browser/React errors'); }
    finally { await context.close(); }
  });
  if (diagnostics) diagnostics.stage = 'navigation';
  try {
    await page.goto(origin);
  } catch (error) {
    const snapshot = await Promise.race([
      page.evaluate(() => ({ readyState: document.readyState, title: document.title,
        mounted: typeof window.setMapTestStops === 'function',
        markers: document.querySelectorAll('.route-map-marker').length,
        text: document.body.innerText.slice(0, 1400),
        resources: performance.getEntriesByType('resource').map(r => ({ path: new URL(r.name).pathname, duration: r.duration })) })),
      new Promise(resolve => setTimeout(() => resolve({ captureTimedOut: true }), 2000)),
    ]).catch(captureError => ({ captureError: String(captureError) }));
    t.diagnostic(JSON.stringify({ stage: 'navigation-failure', snapshot, errors }));
    throw error;
  }
  if (diagnostics) diagnostics.stage = 'third marker initialization';
  await page.locator('.route-map-marker').nth(2).waitFor();
  return page;
}

test('explicit click during expansion keeps its marker name after mouseleave and scroll', { timeout: 30000 }, async t => {
  const diagnostics = { stage: 'context initialization' };
  const page = await pageFor(t, false, diagnostics);
  diagnostics.stage = 'install controlled transition';
  await page.evaluate(() => {
    const frame = document.querySelector('[data-route-map]');
    frame.style.transitionDuration = '1800ms';
    window.selectionTrace = [];
    window.expansionTransition = null;
    // React's class update is observed before paint. Pause the native CSS
    // height transition at 600ms so a slow browser command cannot miss the
    // short middle-height window. The actual marker click precedes resume.
    const pauseExpansion = new MutationObserver(() => {
      const animation = frame.getAnimations().find(animation => animation.transitionProperty === 'height');
      if (!animation) return;
      animation.pause();
      animation.currentTime = 600;
      window.expansionTransition = animation;
      window.selectionTrace.push({ kind: 'paused', height: frame.getBoundingClientRect().height });
      pauseExpansion.disconnect();
    });
    pauseExpansion.observe(frame, { attributes: true, attributeFilter: ['class'] });
    for (const kind of ['click', 'mouseout', 'transitionend']) frame.addEventListener(kind, event => {
      window.selectionTrace.push({ kind, target: String(event.target.className), y: event.clientY, height: frame.getBoundingClientRect().height });
    }, true);
    new MutationObserver(mutations => {
      for (const mutation of mutations) for (const node of mutation.addedNodes) {
        if (node.nodeType === 1 && node.matches('[role="tooltip"]')) window.selectionTrace.push({ kind: 'opened', text: node.textContent });
      }
    }).observe(frame, { childList: true, subtree: true });
  });
  diagnostics.stage = 'real expand click';
  await page.getByRole('button', { name: 'Expand map', exact: true }).click();
  // Deliberately hold a real transition in its middle, rather than racing a
  // wall-clock window. Resume after the real marker click, so subsequent
  // native geometry-driven mouseleave still exercises selection retention.
  diagnostics.stage = 'controlled middle height';
  await page.waitForFunction(() => {
    const h = document.querySelector('[data-route-map]').getBoundingClientRect().height;
    return window.expansionTransition?.playState === 'paused' && h > 220 && h < 330;
  });
  diagnostics.stage = 'middle-height marker coordinates';
  const point = await page.locator('.route-map-marker').first().evaluate(element => {
    const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  diagnostics.stage = 'real middle-height marker click';
  await page.mouse.click(point.x, point.y);
  diagnostics.stage = 'resume native height transition';
  await page.evaluate(() => window.expansionTransition.play());
  await page.waitForFunction(() => document.querySelector('[data-route-map]').getBoundingClientRect().height >= 419.9);
  diagnostics.stage = 'native geometry-driven mouseout';
  // Finished geometry and browser pointer dispatch are separate events. The
  // full-suite trace showed mouseout arriving after the old synchronous read.
  // Require the actual native precondition before asserting retained selection.
  await page.waitForFunction(() => window.selectionTrace.some(event =>
    event.kind === 'mouseout' && event.target === 'route-map-marker'));
  diagnostics.stage = 'selection and actual mouseout assertions';
  const trace = await page.evaluate(() => window.selectionTrace);
  const click = trace.find(e => e.kind === 'click' && e.target === 'route-map-marker');
  assert.ok(click && click.height > 220 && click.height < 400, 'real marker click happened during expansion');
  assert.ok(trace.some(e => e.kind === 'opened' && e.text === 'Stop A'), 'the real marker opened its own name');
  assert.ok(trace.some(e => e.kind === 'mouseout' && e.target === 'route-map-marker'), 'movement really moved marker away from pointer');
  assert.deepEqual(await page.getByRole('tooltip').allTextContents(), ['Stop A'], 'explicit selection survives geometry-triggered mouseleave');
  await page.mouse.move(380, 700);
  diagnostics.stage = 'real wheel scrolling';
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => scrollY > 0);
  diagnostics.stage = 'selection after scroll';
  assert.deepEqual(await page.getByRole('tooltip').allTextContents(), ['Stop A'], 'scrolling does not discard explicit selection');
  t.diagnostic(JSON.stringify({ click, mouseout: trace.filter(e => e.kind === 'mouseout' && e.target === 'route-map-marker') }));
  diagnostics.stage = 'complete';
});

test('hover name still closes on pointer leave without an explicit selection', { timeout: 30000 }, async t => {
  const page = await pageFor(t);
  await page.locator('.route-map-marker').first().hover();
  await page.getByRole('tooltip').getByText('Stop A', { exact: true }).waitFor();
  await page.mouse.move(380, 700);
  await page.getByRole('tooltip').waitFor({ state: 'detached' });
});

test('another explicit selection replaces the name and Escape clears it', { timeout: 30000 }, async t => {
  const page = await pageFor(t);
  await page.locator('.route-map-marker').first().click();
  await page.mouse.move(380, 700);
  assert.deepEqual(await page.getByRole('tooltip').allTextContents(), ['Stop A']);
  await page.locator('.route-map-marker').nth(1).click();
  await page.mouse.move(380, 700);
  assert.deepEqual(await page.getByRole('tooltip').allTextContents(), ['Stop B']);
  await page.keyboard.press('Escape');
  await page.getByRole('tooltip').waitFor({ state: 'detached' });
  await page.locator('.route-map-marker').first().hover();
  await page.getByRole('tooltip').getByText('Stop A', { exact: true }).waitFor();
  await page.mouse.move(380, 700);
  await page.getByRole('tooltip').waitFor({ state: 'detached' });
});

test('hovering another marker after a click inspects that marker while restored same-marker hover retains the click', { timeout: 30000 }, async t => {
  const page = await pageFor(t);
  await page.locator('.route-map-marker').first().click();
  await page.mouse.move(380, 700);
  await page.locator('.route-map-marker').first().hover();
  await page.mouse.move(380, 700);
  assert.deepEqual(await page.getByRole('tooltip').allTextContents(), ['Stop A'], 'restored hover of the selected marker must not downgrade its click');
  await page.locator('.route-map-marker').nth(1).hover();
  await page.getByRole('tooltip').getByText('Stop B', { exact: true }).waitFor();
  await page.mouse.move(380, 700);
  await page.getByRole('tooltip').waitFor({ state: 'detached' });
});

test('layout moving another marker under a stationary pointer preserves the click, but a real return can inspect it', { timeout: 30000 }, async t => {
  const page = await pageFor(t);
  const first = page.locator('.route-map-marker').first();
  const point = await first.evaluate(e => { const r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; });
  await page.mouse.click(point.x, point.y);
  await page.getByRole('tooltip').getByText('Stop A', { exact: true }).waitFor();
  await page.evaluate(point => {
    const target = document.querySelectorAll('.route-map-target')[1];
    window.stationaryTrace = [];
    document.addEventListener('mousemove', event => window.stationaryTrace.push({ kind: 'move', x: event.clientX, y: event.clientY }), true);
    target.addEventListener('mouseenter', event => window.stationaryTrace.push({ kind: 'enter', x: event.clientX, y: event.clientY, trusted: event.isTrusted }));
    const rect = target.getBoundingClientRect();
    document.querySelector('.route-map-marker-shell').style.translate = '120px 0';
    document.querySelector('.route-map-target').style.translate = '120px 0';
    target.style.translate = `${point.x-rect.x-rect.width/2}px ${point.y-rect.y-rect.height/2}px`;
  }, point);
  const geometry = await page.evaluate(point => {
    const target = document.querySelectorAll('.route-map-target')[1];
    const rect = target.getBoundingClientRect();
    return { targetUnderPointer: document.elementFromPoint(point.x, point.y) === target,
      center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
  }, point);
  assert.equal(geometry.targetUnderPointer, true, 'the moved target must really own the original hit-test point');
  assert.ok(Math.abs(geometry.center.x - point.x) < 0.01 && Math.abs(geometry.center.y - point.y) < 0.01);
  // CSS transforms do not guarantee a boundary event until the next native hit
  // test (including headless Chromium). Refresh it WITHOUT pointer displacement.
  // Require a real trusted enter; do not dispatch an artificial DOM event.
  await page.mouse.move(point.x, point.y);
  await page.waitForFunction(() => window.stationaryTrace.some(event => event.kind === 'enter'));
  const trace = await page.evaluate(() => window.stationaryTrace);
  t.diagnostic(JSON.stringify({ point, geometry, trace }));
  assert.ok(trace.some(event => event.kind === 'enter' && event.trusted));
  assert.ok(trace.every(event => event.x === point.x && event.y === point.y), 'the native enter occurred without pointer displacement');
  assert.deepEqual(await page.getByRole('tooltip').allTextContents(), ['Stop A'], 'layout-generated enter must not replace the clicked marker');
  await page.mouse.move(380, 700);
  await page.mouse.move(point.x, point.y);
  await page.getByRole('tooltip').getByText('Stop B', { exact: true }).waitFor();
  await page.mouse.move(380, 700);
  await page.getByRole('tooltip').waitFor({ state: 'detached' });
});

test('keyboard focus opens the marker name and blur closes it', { timeout: 30000 }, async t => {
  const page = await pageFor(t);
  await page.mouse.move(380, 700);
  await page.locator('.route-map-marker-shell').first().focus();
  await page.getByRole('tooltip').getByText('Stop A', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Outside map', exact: true }).focus();
  await page.getByRole('tooltip').waitFor({ state: 'detached' });
});

test('touch selection survives pointer restoration and a new route clears it', { timeout: 30000 }, async t => {
  const page = await pageFor(t, true);
  await page.mouse.move(380, 700);
  await page.locator('.route-map-marker').first().tap();
  assert.deepEqual(await page.getByRole('tooltip').allTextContents(), ['Stop A']);
  await page.mouse.move(379, 700);
  assert.deepEqual(await page.getByRole('tooltip').allTextContents(), ['Stop A']);
  await page.getByRole('button', { name: 'New day', exact: true }).click();
  await page.locator('.route-map-marker-shell[aria-label="1. New day"]').waitFor();
  await page.getByRole('tooltip').waitFor({ state: 'detached' });
});

test('coincident group members remain inspectable without endless zoom', { timeout: 30000 }, async t => {
  const diagnostics = { stage: 'coincident initialization' };
  const page = await pageFor(t, true, diagnostics);
  await page.evaluate(() => window.setMapTestStops([
    { id: 'same-a', label: 'Alpha', lat: 55.6, lng: 13 },
    { id: 'same-b', label: 'Beta', lat: 55.6, lng: 13 },
  ]));
  const group = page.getByRole('button', { name: /Stops 1,2: 1\. Alpha, 2\. Beta/ });
  await group.waitFor();
  const initialZoom = await page.evaluate(() => window.mapFixtureInstance.getZoom());
  await group.tap();
  const picker = page.getByRole('dialog', { name: 'Stops in this group', exact: true });
  await picker.waitFor({ timeout: 2000 });
  await picker.getByRole('button', { name: '2. Beta', exact: true }).tap();
  await page.getByRole('tooltip').getByText('Beta', { exact: true }).waitFor();
  await picker.waitFor({ state: 'detached' });
  await group.tap();
  await picker.waitFor();
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'detached' });
  assert.equal(await group.evaluate(element => element === document.activeElement), true, 'Escape restores group focus');
  diagnostics.stage = 'reopen after Escape';
  await group.tap();
  await picker.waitFor();
  assert.equal(await page.evaluate(() => window.mapFixtureInstance.getZoom()), initialZoom,
    'rapid taps on a group control must not become a map double-tap zoom');
  await page.getByRole('button', { name: 'New day', exact: true }).click();
  await picker.waitFor({ state: 'detached' });
  await page.locator('.route-map-marker-shell[aria-label="1. New day"]').waitFor();
});

test('a distinct pair at maximum zoom has finite keyboard inspection and dismissal', { timeout: 30000 }, async t => {
  const diagnostics = { stage: 'maximum zoom initialization' };
  const page = await pageFor(t, true, diagnostics);
  await page.evaluate(() => window.setMapTestStops([
    { id: 'near-a', label: 'Alpha', lat: 55.6, lng: 13 },
    { id: 'near-b', label: 'Beta', lat: 55.60000001, lng: 13 },
  ]));
  const group = page.getByRole('button', { name: /Stops 1,2: 1\. Alpha, 2\. Beta/ });
  await group.waitFor();
  // Zoom around the fixture stops, not the previous fitted camera centre:
  // otherwise this tiny pair can be offscreen and no group is inspectable.
  await page.evaluate(() => window.mapFixtureInstance.jumpTo({ center: [13, 55.6], zoom: window.mapFixtureInstance.getMaxZoom() }));
  diagnostics.stage = 'maximum zoom group visible';
  await page.waitForFunction(() => document.querySelector('.route-map-group')?.getAttribute('aria-label').includes('Inspect the stops'));
  await group.focus();
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Stops in this group', exact: true });
  await picker.waitFor({ timeout: 2000 });
  assert.equal(await picker.getByRole('button', { name: '1. Alpha', exact: true }).evaluate(element => element === document.activeElement), true);
  await picker.getByRole('button', { name: 'Close', exact: true }).tap();
  await picker.waitFor({ state: 'detached' });
  assert.equal(await group.evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Space');
  await picker.waitFor({ timeout: 2000 });
  await page.getByRole('button', { name: 'Outside map', exact: true }).click();
  await picker.waitFor({ state: 'detached' });
});
