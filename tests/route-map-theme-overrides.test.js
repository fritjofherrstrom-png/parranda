'use strict';
// Leaflet's stylesheet is lazy-loaded with the map, so in the built surface it
// can arrive after Parranda's. The theme overrides for the map chrome must win
// regardless: this loads Leaflet's CSS last (the losing order) in real Chromium
// and reads the computed colours in both themes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');

const page = theme => `<!doctype html><html data-theme="${theme}"><head>
<link rel="stylesheet" href="/tailwind.css"><link rel="stylesheet" href="/leaflet.css"></head><body>
<div class="leaflet-container" id="map" style="width:300px;height:200px;position:relative">
  <div class="leaflet-control-container">
    <div class="leaflet-bar leaflet-control"><a id="zoom" class="leaflet-control-zoom-in" href="#">+</a></div>
    <div class="leaflet-control-attribution leaflet-control"><a id="attribution" href="#">OpenStreetMap</a></div>
  </div>
  <div class="leaflet-pane leaflet-tooltip-pane"><div id="tooltip" class="leaflet-tooltip leaflet-tooltip-top">Stop 1</div></div>
</div></body></html>`;

test('map chrome follows the theme even when Leaflet CSS loads last', { timeout: 120000 }, async t => {
  const temp = await fs.mkdtemp(path.join(frontend, '.map-theme-'));
  let browser, server;
  try {
    await fs.writeFile(path.join(temp, 'input.css'), `@import ${JSON.stringify(path.join(frontend, 'src/styles/tokens.css'))};\n@import ${JSON.stringify(path.join(frontend, 'src/styles/tailwind.css'))};\n@source not ${JSON.stringify(path.join(frontend, 'src'))};\n`);
    execFileSync(process.execPath, [path.join(frontend, 'node_modules/@tailwindcss/cli/dist/index.mjs'), '-i', path.join(temp, 'input.css'), '-o', path.join(temp, 'tailwind.css')], { cwd: frontend, stdio: 'pipe' });
    await fs.copyFile(path.join(frontend, 'node_modules/leaflet/dist/leaflet.css'), path.join(temp, 'leaflet.css'));
    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://x');
        if (url.pathname.endsWith('.css')) { res.setHeader('Content-Type', 'text/css'); res.end(await fs.readFile(path.join(temp, path.basename(url.pathname)))); return; }
        res.setHeader('Content-Type', 'text/html'); res.end(page(url.searchParams.get('theme') || 'day'));
      } catch { res.statusCode = 404; res.end(); }
    }).listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const launches = [process.env.PARRANDA_TEST_CHROMIUM && { executablePath: process.env.PARRANDA_TEST_CHROMIUM }, {}, { channel: 'chrome' }].filter(Boolean);
    const launchErrors = [];
    for (const candidate of launches) {
      try { browser = await chromium.launch({ ...candidate, headless: true, timeout: 15000, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] }); break; }
      catch (error) { launchErrors.push(error.message); }
    }
    if (!browser) {
      if (process.env.CI) throw new Error(`Real Chromium is required in CI: ${launchErrors.join(' | ')}`);
      t.skip('Chromium unavailable; set PARRANDA_TEST_CHROMIUM to run the map theme check'); return;
    }
    const tab = await browser.newPage();
    for (const theme of ['day', 'night']) {
      await tab.goto(`${origin}/?theme=${theme}`);
      const seen = await tab.evaluate(() => {
        const token = name => `rgb(${getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).join(', ')})`;
        const style = id => getComputedStyle(document.getElementById(id));
        return {
          ink: token('--p-color-ink'),
          paper: token('--p-color-paper'),
          container: getComputedStyle(document.getElementById('map')).backgroundColor,
          attribution: style('attribution').color,
          zoomBackground: style('zoom').backgroundColor,
          zoomColor: style('zoom').color,
          tooltipBackground: style('tooltip').backgroundColor,
          tooltipColor: style('tooltip').color,
          tooltipArrow: getComputedStyle(document.getElementById('tooltip'), '::before').borderTopColor,
        };
      });
      assert.equal(seen.container, seen.paper, `${theme}: map background is paper`);
      assert.equal(seen.attribution, seen.ink, `${theme}: attribution links are ink, not Leaflet blue`);
      assert.equal(seen.zoomBackground, seen.paper, `${theme}: zoom control is paper`);
      assert.equal(seen.zoomColor, seen.ink, `${theme}: zoom glyph is ink`);
      assert.equal(seen.tooltipBackground, seen.ink, `${theme}: tooltip is ink, not Leaflet white`);
      assert.equal(seen.tooltipColor, seen.paper, `${theme}: tooltip text is paper`);
      assert.equal(seen.tooltipArrow, seen.ink, `${theme}: tooltip arrow matches the tooltip`);
    }
  } finally {
    await browser?.close();
    server?.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
