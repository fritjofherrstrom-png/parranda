import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { buildApp } = require('../../server/app');
const observation = require('../../tests/fixtures/blitz-now-observation.json');
// Real BlitzCard/view, real HTTP handlers/middleware, controlled trusted loader,
// clock and weather. No product API interception and no live providers.
const bundle = await build({
  stdin: { contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import BlitzCard from './src/components/planner/BlitzCard';
    import {anywhereBlitzView} from './src/lib/blitz-view.mjs';
    const lang = new URLSearchParams(location.search).get('lang') || 'en';
    function App() {
      const [phase,setPhase] = useState('idle');
      const [result,setResult] = useState(null);
      async function blitz() {
        setPhase('loading');
        const response = await fetch('/api/blitz?anywhere_blitz=1&lang='+lang, {
          method:'POST', headers:{'content-type':'application/json'},
          body:JSON.stringify(${JSON.stringify({ ...observation.anchor, preferences: observation.preferences })})
        });
        window.actualResponse = await response.json();
        setResult(anywhereBlitzView(window.actualResponse)); setPhase('done');
      }
      return <BlitzCard t={(sv,en)=>lang==='sv'?sv:en} lang={lang}
        mode="typed" anchorLabel="Test anchor" typedPlaceLabel="Test anchor" dayOnScreen={true}
        blitz={blitz} blitzPhase={phase} blitzResult={result}
        sharePositionForBlitz={()=>{}} blitzPositionFailed={false} />;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
});

async function harness(t, records, { weatherProvider = async () => ({
  timezone_resolution: { timezone: observation.timezone, timezone_source: 'weather_provider_auto' },
}) } = {}) {
  const app = buildApp({
    clock: { now: () => observation.observed_at },
    weatherProvider,
    openDataLoader: async () => records,
  });
  const server = http.createServer((req,res) => {
    if (req.url.startsWith('/__blitz-test.js')) {
      res.setHeader('content-type','text/javascript'); res.end(bundle.outputFiles[0].text);
    } else if (req.url.startsWith('/__blitz-test?')) {
      res.setHeader('content-type','text/html'); res.end('<meta name="viewport" content="width=device-width"><div id="root"></div><script src="/__blitz-test.js"></script>');
    } else app(req,res);
  }).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser = await chromium.launch({ headless:true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? {executablePath:process.env.PARRANDA_TEST_CHROMIUM} : {}),
    args:['--no-sandbox'],
  });
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  t.after(()=>assert.deepEqual(errors,[]));
  return {page, async show(lang) {
    await page.goto(`http://127.0.0.1:${server.address().port}/__blitz-test?lang=${lang}`);
    await page.getByRole('button',{name:lang==='sv'?'Blitz just nu':'Blitz right now',exact:true}).click();
    await page.waitForFunction(()=>window.actualResponse);
    await page.getByText(records[0].name,{exact:true}).waitFor();
    return page.locator('#root').innerText();
  }};
}

test('actual HTTP → native BlitzCard distinguishes unknown indoor hours from a possible visit in sv/en', async t=>{
  const {page,show}=await harness(t,[structuredClone(observation.selected)]);
  for(const lang of ['sv','en']) {
    const text=await show(lang);
    assert.match(text,lang==='sv'?/Öppet just nu är inte bekräftat/:/Open now is not confirmed/);
    assert.match(text,lang==='sv'?/platsförslag/:/place suggestion/);
    assert.doesNotMatch(text,/utomhus|exterior|outdoor|outside/i);
    assert.deepEqual((await page.evaluate(()=>window.actualResponse)).best_move.availability,
      {status:'unknown',reason:'opening_hours_unavailable'},'missing source hours stay an honest unknown assessment');
  }
});

test('actual HTTP → native BlitzCard qualifies late-open hours and labels its unknown backup', async t=>{
  const {page,show}=await harness(t,[
    {...structuredClone(observation.selected),opening_hours:'Th 22:00-02:00'},
    {...structuredClone(observation.selected),id:'backup',name:'Unconfirmed gallery',type:'gallery',lat:59.334,lng:18.07},
  ]);
  for(const lang of ['sv','en']) {
    const text=await show(lang);
    assert.match(text,lang==='sv'?/Källans schema anger öppet vid kontrollen/:/Listed hours indicate open at the time checked/);
    assert.match(text,/Unconfirmed gallery/);
    assert.match(text,lang==='sv'?/Öppet just nu är inte bekräftat/:/Open now is not confirmed/);
    const actual=await page.evaluate(()=>window.actualResponse);
    assert.equal(actual.best_move.availability.status,'available_in_window');
    assert.deepEqual(actual.backup_option.availability,{status:'unknown',reason:'opening_hours_unavailable'});
  }
});

test('actual HTTP → native BlitzCard distinguishes known source hours from unconfirmed local-time assessment in sv/en', async t=>{
  // Mutating the fallback back to "Hours unknown" must fail: these source
  // schedules are known, while the independent trusted local-time seam fails.
  const {page,show}=await harness(t,[
    {...structuredClone(observation.selected),opening_hours:'24/7'},
    {...structuredClone(observation.selected),id:'known-hours-backup',name:'Known-hours gallery',type:'gallery',lat:59.334,lng:18.07,opening_hours:'24/7'},
  ], {weatherProvider:async()=>null});
  for(const lang of ['sv','en']) {
    const text=await show(lang);
    const actual=await page.evaluate(()=>window.actualResponse);
    assert.equal(actual.context.date,'2026-10-15','the injected server instant is retained without inventing local time');
    assert.equal(actual.context.timezone,null,'no trusted timezone was supplied');
    assert.equal(actual.context.time_status,'timezone_unavailable');
    assert.equal(actual.best_move.candidate_id,observation.selected.id);
    assert.equal(actual.backup_option.candidate_id,'known-hours-backup');
    for(const move of [actual.best_move,actual.backup_option]) {
      assert.deepEqual(move.availability,{status:'unknown',reason:'opening_hours_local_day_unavailable'});
    }
    assert.doesNotMatch(text,lang==='sv'?/Öppettider(?:na)? (?:är )?okända/:/Hours unknown/i,
      'known source schedules must not be relabeled as missing source hours');
    const unconfirmed=lang==='sv'?/Öppet just nu är inte bekräftat/g:/Open now is not confirmed/g;
    assert.equal((text.match(unconfirmed)||[]).length,2,
      'best and backup each disclose that current opening could not be confirmed');
    assert.match(text,/Known-hours gallery/);
  }
});
