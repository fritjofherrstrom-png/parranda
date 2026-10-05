'use strict';
// The day title's place name fills one line for its longest word and never
// breaks inside a word ("MALM / Ö"). The fit measures the rendered word, so it
// holds for whichever face is loaded; the test uses Chromium's fallback for the
// display stack (no network), which is wider than the estimate assumed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const NAMES = ['Malmö', 'Rome', 'Barcelona', 'Reykjavík', 'Wrocław', 'Mmmmmmm', 'Ålesund', 'San Sebastián', 'Llanfairpwllgwyngyll'];

test('place names fit their column without breaking a word', { timeout: 240000 }, async t => {
  const temp = await fs.mkdtemp(path.join(frontend, '.place-sign-'));
  let browser, server;
  try {
    const entry = path.join(temp, 'entry.tsx');
    await fs.writeFile(entry, `import React from 'react'; import {createRoot} from 'react-dom/client'; import {PlaceSign} from '../src/components/planner/DayHeader';
const names=${JSON.stringify(NAMES)};
function Harness(){return <div>{names.map(n=><h2 key={n} data-name={n} className="type-title text-[2.5rem] text-parranda-ink" style={{containerType:'inline-size',marginBottom:24}}>A day in <PlaceSign text={n}/></h2>)}</div>}
createRoot(document.getElementById('root')).render(<Harness/>);`);
    await require(path.join(frontend, 'node_modules/esbuild')).build({ entryPoints: [entry], bundle: true, outdir: temp, format: 'iife', jsx: 'automatic', logLevel: 'silent' });
    await fs.writeFile(path.join(temp, 'input.css'), `@import ${JSON.stringify(path.join(frontend, 'src/styles/tokens.css'))};\n@import ${JSON.stringify(path.join(frontend, 'src/styles/tailwind.css'))};\n@source not ${JSON.stringify(path.join(frontend, 'src'))};\n@source ${JSON.stringify(entry)};\n@source ${JSON.stringify(path.join(frontend, 'src/components/planner/DayHeader.tsx'))};\n`);
    execFileSync(process.execPath, [path.join(frontend, 'node_modules/@tailwindcss/cli/dist/index.mjs'), '-i', path.join(temp, 'input.css'), '-o', path.join(temp, 'tailwind.css')], { cwd: frontend, stdio: 'pipe' });
    server = http.createServer(async (req, res) => {
      try {
        const file = req.url === '/' ? null : path.join(temp, path.basename(req.url));
        res.setHeader('Content-Type', req.url.endsWith('.js') ? 'application/javascript' : req.url.endsWith('.css') ? 'text/css' : req.url.endsWith('.woff2') ? 'font/woff2' : 'text/html');
        res.end(file ? await fs.readFile(file) : `<!doctype html><html data-theme="day"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/tailwind.css"><div id="root" style="padding:0 16px"></div><script src="/entry.js"></script>`);
      } catch { res.statusCode = 404; res.end(); }
    }).listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const launches = [process.env.PARRANDA_TEST_CHROMIUM && { executablePath: process.env.PARRANDA_TEST_CHROMIUM }, {}, { channel: 'chrome' }].filter(Boolean);
    for (const candidate of launches) {
      try { browser = await chromium.launch({ ...candidate, headless: true, timeout: 15000, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] }); break; } catch {}
    }
    if (!browser) {
      if (process.env.CI) throw new Error('Real Chromium is required in CI');
      t.skip('Chromium unavailable; set PARRANDA_TEST_CHROMIUM'); return;
    }
    for (const width of [320, 390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(origin);
      await page.waitForFunction(n => document.querySelectorAll('[data-name]').length === n, NAMES.length);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const seen = await page.evaluate(() => [...document.querySelectorAll('[data-name]')].map(h => {
        const sign = h.querySelector('em');
        const size = parseFloat(getComputedStyle(sign).fontSize);
        const words = [...sign.querySelectorAll('[data-sign-word]')].map(w => {
          const rects = w.getClientRects();
          return { word: w.textContent, lines: new Set([...rects].map(r => Math.round(r.top))).size, width: w.getBoundingClientRect().width };
        });
        return { name: h.dataset.name, size, column: sign.clientWidth, words };
      }));
      for (const sign of seen) {
        if (sign.name === 'Llanfairpwllgwyngyll') {
          // Too long for one line even at the floor: it may break, never overflow.
          assert.ok(sign.size >= 32, `${width}px ${sign.name}: never below 2rem`);
          for (const w of sign.words) assert.ok(w.width <= sign.column + 1, `${width}px ${sign.name}: stays in the column`);
          continue;
        }
        for (const w of sign.words) {
          assert.equal(w.lines, 1, `${width}px ${sign.name}: "${w.word}" is on one line (no MALM / Ö)`);
          assert.ok(w.width <= sign.column + 1, `${width}px ${sign.name}: "${w.word}" fits the column (${w.width} > ${sign.column})`);
        }
        assert.ok(sign.size >= 32 && sign.size <= 76, `${width}px ${sign.name}: size within 2–4.75rem (${sign.size})`);
      }
      const malmo = seen.find(s => s.name === 'Malmö');
      assert.ok(malmo.words[0].width >= malmo.column * 0.85 || malmo.size === 76, `${width}px Malmö fills its line`);
      await page.close();
    }
  } finally {
    await browser?.close();
    server?.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
