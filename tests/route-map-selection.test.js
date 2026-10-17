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
const empty=[];
function Harness(){
  const [expanded,setExpanded]=React.useState(false);
  const [stops,setStops]=React.useState([{id:'a',label:'Stop A',lat:55.595,lng:12.99},{id:'b',label:'Stop B',lat:55.598,lng:12.998},{id:'c',label:'Stop C',lat:55.603,lng:13.01}]);
  const route=React.useMemo(()=>({map_path_points:stops}),[stops]);
  return <main style={{padding:12,minHeight:1800}}><button onClick={()=>setStops([{id:'new',label:'New day',lat:55.6,lng:13}])}>New day</button><section aria-label="The route"><RouteMap hasPrimaryRoute={true} routeStops={stops} primaryRoute={route} areas={empty} routeContextSuggestions={empty} showContext={false} sketch={true} mapExpanded={expanded} onToggleExpanded={()=>setExpanded(!expanded)} heightClass={expanded?'h-[420px]':'h-[190px]'} t={(_,en)=>en}/></section><button>Outside map</button></main>;
} createRoot(document.getElementById('root')).render(<Harness/>);`);
  const esbuild = require(path.join(frontend, 'node_modules/esbuild'));
  await esbuild.build({ entryPoints: [path.join(frontend, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs')], bundle: true,
    outfile: path.join(temp, 'maplibre-worker.js'), format: 'esm', logLevel: 'silent' });
  const workerUrl = { name: 'worker-url', setup(build) {
    build.onResolve({ filter: /\?worker&url$/ }, () => ({ path: 'worker-url', namespace: 'worker-url' }));
    build.onLoad({ filter: /.*/, namespace: 'worker-url' }, () => ({ contents: 'export default "/maplibre-worker.js"', loader: 'js' }));
  } };
  await esbuild.build({ entryPoints: [entry], bundle: true, outdir: temp, format: 'iife', jsx: 'automatic',
    loader: { '.png': 'dataurl' }, plugins: [workerUrl], logLevel: 'silent' });
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
            scrollY, trace: window.selectionTrace || [], body: document.body.innerText.slice(0, 2000) };
        });
        t.diagnostic(JSON.stringify({ stage: diagnostics.stage, state }));
      } catch (error) { t.diagnostic(JSON.stringify({ stage: diagnostics.stage, captureError: String(error) })); }
    }
    try { assert.deepEqual(errors, [], 'no browser/React errors'); }
    finally { await context.close(); }
  });
  if (diagnostics) diagnostics.stage = 'navigation';
  await page.goto(origin);
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
