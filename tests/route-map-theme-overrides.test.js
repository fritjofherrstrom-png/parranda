'use strict';
// MapLibre's stylesheet ships with the map code, so in the built surface it can
// arrive after Parranda's. The theme overrides for the map chrome must win
// regardless: this loads MapLibre's CSS last (the losing order) in real
// Chromium and reads the computed colours in both themes.
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
<link rel="stylesheet" href="/tailwind.css"><link rel="stylesheet" href="/maplibre.css"></head><body>
<div class="route-map-frame" style="position:relative;width:300px;height:200px">
  <div class="maplibregl-map" id="map" style="width:300px;height:200px">
    <div class="maplibregl-control-container">
      <div class="maplibregl-ctrl-top-left"><div class="maplibregl-ctrl maplibregl-ctrl-group"><button id="zoom" class="maplibregl-ctrl-zoom-in" type="button"><span id="zoomIcon" class="maplibregl-ctrl-icon"></span></button></div></div>
      <div class="maplibregl-ctrl-bottom-right"><div class="maplibregl-ctrl maplibregl-ctrl-attrib"><div class="maplibregl-ctrl-attrib-inner"><a id="attribution" href="#">OpenStreetMap</a></div></div></div>
    </div>
  </div>
  <div id="tooltip" class="route-map-tooltip route-map-tooltip--right" style="left:20px;top:40px">Stop 1</div>
</div></body></html>`;

test('map chrome follows the theme even when the MapLibre CSS loads last', { timeout: 120000 }, async t => {
  const temp = await fs.mkdtemp(path.join(frontend, '.map-theme-'));
  let browser, server;
  try {
    await fs.writeFile(path.join(temp, 'input.css'), `@import ${JSON.stringify(path.join(frontend, 'src/styles/tokens.css'))};\n@import ${JSON.stringify(path.join(frontend, 'src/styles/tailwind.css'))};\n@source not ${JSON.stringify(path.join(frontend, 'src'))};\n`);
    execFileSync(process.execPath, [path.join(frontend, 'node_modules/@tailwindcss/cli/dist/index.mjs'), '-i', path.join(temp, 'input.css'), '-o', path.join(temp, 'tailwind.css')], { cwd: frontend, stdio: 'pipe' });
    await fs.copyFile(path.join(frontend, 'node_modules/maplibre-gl/dist/maplibre-gl.css'), path.join(temp, 'maplibre.css'));
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
    for (const theme of ['night', 'day']) {
      await tab.goto(`${origin}/?theme=${theme}`);
      const seen = await tab.evaluate(() => {
        const token = name => `rgb(${getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).join(', ')})`;
        const style = id => getComputedStyle(document.getElementById(id));
        return {
          ink: token('--p-color-ink'),
          paper: token('--p-color-paper'),
          container: getComputedStyle(document.getElementById('map')).backgroundColor,
          attribution: style('attribution').color,
          attributionBackground: getComputedStyle(document.querySelector('.maplibregl-ctrl-attrib')).backgroundColor,
          expectedAttributionBackground: `rgba(${getComputedStyle(document.documentElement).getPropertyValue('--p-color-paper').trim().split(/\s+/).join(', ')}, 0.85)`,
          attributionRules: [...document.styleSheets].flatMap(sheet => [...sheet.cssRules].filter(rule => rule.selectorText && document.querySelector('.maplibregl-ctrl-attrib').matches(rule.selectorText)).map(rule => rule.cssText)),
          group: getComputedStyle(document.querySelector('.maplibregl-ctrl-group')).backgroundColor,
          zoomGlyph: style('zoomIcon').backgroundColor,
          zoomSize: [style('zoom').width, style('zoom').height],
          tooltipBackground: style('tooltip').backgroundColor,
          tooltipColor: style('tooltip').color,
        };
      });
      console.log(JSON.stringify({ theme, ...seen }));
      assert.equal(seen.attributionBackground, seen.expectedAttributionBackground, `${theme}: attribution background is themed paper, not translucent white`);
      assert.equal(seen.container, seen.paper, `${theme}: map background is paper`);
      assert.equal(seen.attribution, seen.ink, `${theme}: attribution links are ink, not MapLibre grey`);
      assert.equal(seen.group, seen.paper, `${theme}: zoom control is paper, not MapLibre white`);
      assert.equal(seen.zoomGlyph, seen.ink, `${theme}: zoom glyph is ink`);
      assert.deepEqual(seen.zoomSize, ['44px', '44px'], `${theme}: zoom buttons are a thumb's size`);
      assert.equal(seen.tooltipBackground, seen.ink, `${theme}: a stop's name is ink`);
      assert.equal(seen.tooltipColor, seen.paper, `${theme}: its text is paper`);
    }
  } finally {
    await browser?.close();
    server?.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
