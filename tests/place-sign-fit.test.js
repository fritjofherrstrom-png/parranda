'use strict';
// Exercise the production day heading with narrow columns and larger text.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const NAMES = ['Stockholm', 'Malmö', 'Rome', 'Barcelona', 'Reykjavík', 'Wrocław', 'Mmmmmmm', 'Ålesund', 'San Sebastián', 'Llanfairpwllgwyngyll'];

test('the compact ink day heading wraps and fits beside Change place', { timeout: 240000 }, async t => {
  const temp = await fs.mkdtemp(path.join(frontend, '.place-sign-'));
  let browser, server;
  try {
    const entry = path.join(temp, 'entry.tsx');
    await fs.writeFile(entry, `import React from 'react';
import {createRoot} from 'react-dom/client';
import DayHeader from '../src/components/planner/DayHeader';
import {ChangePlaceLink} from '../src/components/planner/AnchorCard';
const names=${JSON.stringify(NAMES)};
const noop = () => {};
const root = createRoot(document.getElementById('root'));
window.renderHeadings = (lang) => {
  const t = (sv, en) => lang === 'sv' ? sv : en;
  root.render(names.map(name => <section key={name} data-name={name} style={{maxWidth:'36rem'}}>
    <DayHeader t={t} lang={lang} staleNotice={null} navigationInterrupted={false} retryPlan={noop}
      mode="typed" placeLabel={name} anchorLabel={name} primaryRoute={{}} date={null} weatherSummary={null}
      titleAction={<ChangePlaceLink t={t} lang={lang} onChangePlace={noop}/>}
      coreCount={3} wovenCount={0} pickCoverage={[]} dayLimitationNote={null} restoredAt={null} resolveAndRun={noop}/>
  </section>));
};
window.renderHeadings('en');`);
    await require(path.join(frontend, 'node_modules/esbuild')).build({ entryPoints: [entry], bundle: true, outdir: temp, format: 'iife', jsx: 'automatic', logLevel: 'silent' });
    const assets = path.join(frontend, 'dist', '_astro');
    const styles = (await fs.readdir(assets)).filter(file => file.endsWith('.css'));
    const css = await Promise.all(styles.map(file => fs.readFile(path.join(assets, file), 'utf8')));
    await fs.writeFile(path.join(temp, 'tailwind.css'), css.join('\n'));
    server = http.createServer(async (req, res) => {
      try {
        const directory = req.url.startsWith('/_astro/') ? assets : temp;
        const file = req.url === '/' ? null : path.join(directory, path.basename(req.url));
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
    for (const width of [320, 390, 430, 1280, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
      await page.goto(origin);
      await page.waitForFunction(n => document.querySelectorAll('[data-name]').length === n, NAMES.length);
      await page.evaluate(() => document.fonts.ready);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      const { root: documentRoot } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: documentRoot.nodeId, selector: 'h1' });
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      assert.ok(fonts.length > 0 && fonts.every(font => /^Archivo\b/.test(font.familyName) && font.isCustomFont),
        'Measure the production Archivo face: ' + JSON.stringify(fonts));
      await cdp.detach();
      for (const [lang, theme, rem] of [['en', 'day', 16], ['sv', 'night', 16], ['en', 'night', 32], ['sv', 'day', 32]]) {
        await page.evaluate(async ({lang, theme, rem}) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.style.fontSize = rem + 'px';
          window.renderHeadings(lang);
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, {lang, theme, rem});
        const seen = await page.locator('[data-name]').evaluateAll(sections => sections.map(section => {
          const heading = section.querySelector('h1');
          const link = section.querySelector('a');
          const style = getComputedStyle(heading);
          const ink = 'rgb(' + style.getPropertyValue('--p-color-ink').trim().split(/\s+/).join(', ') + ')';
          const range = document.createRange();
          range.selectNodeContents(heading);
          const linkRect = link.getBoundingClientRect();
          return { name: section.dataset.name, text: heading.textContent, size: parseFloat(style.fontSize),
            correctInk: style.color === ink && [...heading.querySelectorAll('*')].every(el => getComputedStyle(el).color === ink),
            fits: [...range.getClientRects()].every(rect => rect.right <= linkRect.left + 1 && rect.left >= section.getBoundingClientRect().left - 1),
            linkHeight: linkRect.height, scrollWidth: document.documentElement.scrollWidth };
        }));
        for (const title of seen) {
          const context = `${width}px · ${lang} · ${theme} · ${rem}px · ${title.name}`;
          assert.equal(title.text, `${lang === 'sv' ? 'En dag i' : 'A day in'} ${title.name}`, context);
          assert.equal(title.correctInk, true, context);
          assert.equal(title.size, rem * (width >= 640 ? 2 : 1.625), context);
          assert.equal(title.fits, true, context);
          assert.equal(title.scrollWidth, width, context);
          assert.ok(title.linkHeight >= 44, context);
        }
      }
      await page.close();
    }
  } finally {
    await browser?.close();
    server?.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
