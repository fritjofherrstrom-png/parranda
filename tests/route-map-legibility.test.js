'use strict';
// Isolated presentation harness: real RouteMap, React, Leaflet and production
// Tailwind in Chromium. No Planner motor, API, providers or committed dist.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const proof = process.env.PARRANDA_MAP_PROOF || '/tmp/parranda-map-proof';
const lifecycleProbe = process.env.PARRANDA_MAP_PROBE === 'lifecycle';
const stop = (id, lat, lng) => ({ id, label: `Stop ${id}`, lat, lng });
const days = [
  ['diagonal', [[55.595,12.99],[55.598,12.998],[55.601,13.004],[55.603,13.01],[55.606,13.018]]],
  ['north-east', [[55.5982,12.9905],[55.6005,12.997],[55.6021,13.003],[55.6036,13.0085],[55.605,13.0125]]],
  ['north-west', [[55.605,12.9905],[55.6036,12.9945],[55.6021,13],[55.6005,13.006],[55.5982,13.0125]]],
  ['every-corner', [[55.5982,12.9905],[55.605,12.9905],[55.605,13.0125],[55.5982,13.0125]]],
  ['clustered-pair', [[55.6,12.985],[55.6,12.997],[55.6004,13.006],[55.5996,13.006],[55.6,13.02]]],
  ['dense-north-east', [[55.595,12.99],[55.598,12.998],[55.601,13.004],[55.6055,13.0165],[55.6062,13.0178]]],
].map(([name, coords]) => ({name, stops: coords.map(([lat,lng],i) => stop(i+1,lat,lng))}));
let seed = 531;
const random = () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed / 4294967296; };
for (let n=0;n<12;n++) {
  const lat=35+random()*25, lng=-20+random()*40;
  const stops=Array.from({length:4+n%3},(_,i) => stop(i+1,lat+(random()-.5)*.008,lng+(random()-.5)*.012));
  if(n%3===0) Object.assign(stops[1],{lat:stops[0].lat,lng:stops[0].lng});
  days.push({name:`seed-531-${n}`,stops});
}
for(const day of days) day.stops.at(-1).is_live_event=true;

test('every number is legible and opens its own stop at 320/390/1280, collapsed/expanded', {timeout:480000}, async t => {
  await fs.mkdir(proof,{recursive:true});
  const temp=await fs.mkdtemp(path.join(frontend,'.map-browser-'));
  let browser,server;
  try {
    const entry=path.join(temp,'entry.tsx');
    await fs.writeFile(entry,`import React from 'react'; import {createRoot} from 'react-dom/client'; import RouteMap from '../src/components/planner/RouteMap';
function Harness(){const [expanded,setExpanded]=React.useState(false);const [stops,setStops]=React.useState([]);window.setDay=setStops;return <section aria-label="Rutten"><RouteMap hasPrimaryRoute={true} routeStops={stops} primaryRoute={{map_path_points:stops}} areas={[]} routeContextSuggestions={[]} showContext={false} sketch={true} mapExpanded={expanded} onToggleExpanded={()=>setExpanded(!expanded)} heightClass={expanded?'h-[420px]':'h-[190px]'} t={(sv)=>sv}/></section>} createRoot(document.getElementById('root')).render(<Harness/>);`);
    await require(path.join(frontend,'node_modules/esbuild')).build({entryPoints:[entry],bundle:true,outdir:temp,format:'iife',jsx:'automatic',loader:{'.png':'dataurl'},logLevel:'silent'});
    // Production Tailwind (v4, CSS-first): the real tokens and stylesheet, scanned
    // over the harness and the real RouteMap only.
    await fs.writeFile(path.join(temp,'input.css'),`@import ${JSON.stringify(path.join(frontend,'src/styles/tokens.css'))};\n@import ${JSON.stringify(path.join(frontend,'src/styles/tailwind.css'))};\n@source not ${JSON.stringify(path.join(frontend,'src'))};\n@source ${JSON.stringify(entry)};\n@source ${JSON.stringify(path.join(frontend,'src/components/planner/RouteMap.tsx'))};\n`);
    execFileSync(process.execPath,[path.join(frontend,'node_modules/@tailwindcss/cli/dist/index.mjs'),'-i',path.join(temp,'input.css'),'-o',path.join(temp,'tailwind.css')],{cwd:frontend,stdio:'pipe'});
    server=http.createServer(async(req,res)=>{try{const file=req.url==='/'?null:path.join(temp,path.basename(req.url)); res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':req.url.endsWith('.css')?'text/css':'text/html');res.end(file?await fs.readFile(file):'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/entry.css"><link rel="stylesheet" href="/tailwind.css"><div id="root" style="margin:12px"></div><script src="/entry.js"></script>');}catch{res.statusCode=404;res.end();}}).listen(0,'127.0.0.1');
    await new Promise(r=>server.once('listening',r));
    const origin=`http://127.0.0.1:${server.address().port}`;
    const launches = [process.env.PARRANDA_TEST_CHROMIUM && {executablePath:process.env.PARRANDA_TEST_CHROMIUM}, {}, {channel:'chrome'}].filter(Boolean);
    const launchErrors = [];
    for (const candidate of launches) {
      try { browser = await chromium.launch({...candidate,headless:true,timeout:15000,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']}); break; }
      catch (error) { launchErrors.push(error.message); }
    }
    if (!browser) {
      if (process.env.CI) throw new Error(`Real Chromium is required in CI: ${launchErrors.join(' | ')}`);
      t.skip('Chromium unavailable; set PARRANDA_TEST_CHROMIUM to run the real map acceptance'); return;
    }
    const results=[];
    for(const width of (lifecycleProbe ? [320] : [320,390,1280])) {
      const context=await browser.newContext({viewport:{width,height:844},hasTouch:true});
      await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      const page=await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin,{waitUntil:'domcontentloaded',timeout:15000});
      try { await page.waitForFunction(()=>window.setDay,null,{timeout:10000}); }
      catch (error) { throw new Error(`Map harness did not mount: ${errors.join(' | ')}; ${error.message}`); }
      // As in #529, observe what the real touch click opens before Chromium
      // restores its parked mouse hover and closes that transient tooltip.
      await page.evaluate(() => {
        window.mapTapRecord = { clicked: false, opened: [] };
        new MutationObserver(() => {
          for (const tip of document.querySelectorAll('.leaflet-tooltip')) {
            if (tip.style.opacity !== '0') window.mapTapRecord.opened.push(tip.textContent.trim());
          }
        }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
        document.addEventListener('click', () => { window.mapTapRecord.clicked = true; }, true);
        document.addEventListener('dblclick', e => e.stopPropagation(), true);
      });
      for(const day of (lifecycleProbe ? [] : days)){
        await page.evaluate(stops=>window.setDay(stops),day.stops);
        await page.locator('.route-map-marker').nth(day.stops.length-1).waitFor();
        for(const expanded of [false,true]) {
          const button=page.locator('button[aria-expanded]');
          if((await button.getAttribute('aria-expanded'))!==String(expanded)) await button.click();
          await page.waitForTimeout(450);
          const where=`${day.name}-${width}-${expanded?'expanded':'collapsed'}`;
          const measured=await page.evaluate(()=>{
            const container=document.querySelector('.leaflet-container');container.scrollIntoView({block:'center'});
            const map=container.getBoundingClientRect();
            const controls=[...container.parentElement.querySelectorAll('.leaflet-control,button')].map(e=>e.getBoundingClientRect());
            const markers=[...document.querySelectorAll('.route-map-marker')].map(e=>{const r=e.getBoundingClientRect();return {number:e.textContent,x:(r.left+r.right)/2,y:(r.top+r.bottom)/2};});
            const issues=[];
            for(const m of markers){
              if(m.x-15<map.left||m.x+15>map.right||m.y-15<map.top||m.y+15>map.bottom) issues.push(`${m.number}: clipped`);
              for(const c of controls) if(m.x+15>c.left&&m.x-15<c.right&&m.y+15>c.top&&m.y-15<c.bottom) issues.push(`${m.number}: control overlap`);
              const hit=document.elementFromPoint(m.x,m.y)?.closest('.route-map-marker');
              if(hit?.textContent!==m.number) issues.push(`${m.number}: centre hits ${hit?.textContent||'no number'}`);
              for(const n of markers) if(Number(n.number)>Number(m.number)&&Math.hypot(m.x-n.x,m.y-n.y)<31) issues.push(`${m.number}/${n.number}: overlapping discs`);
            }
            return {markers,issues};
          });
          results.push({where,...measured});
          await fs.writeFile(path.join(proof,'results.json'),JSON.stringify(results,null,2));
          if(measured.issues.length){await page.screenshot({path:path.join(proof,`${where}-failure.png`)});assert.deepEqual(measured.issues,[],where);}
          // Real mouse hover and emulated touch: each visible number must open only its own name.
          for(const m of measured.markers){
            await page.mouse.move(1,1);await page.waitForTimeout(60);
            await page.mouse.move(m.x,m.y);
            await page.waitForFunction(label=>{const names=[...document.querySelectorAll('.leaflet-tooltip')].filter(e=>e.style.opacity!=='0').map(e=>e.textContent);return names.length>0&&names.every(n=>n===label)},`Stop ${m.number}`,{timeout:2000});
            await page.mouse.move(1,1);await page.waitForTimeout(250);
            await page.evaluate(() => { window.mapTapRecord = { clicked: false, opened: [] }; });
            await page.touchscreen.tap(m.x,m.y);
            await page.waitForFunction(() => window.mapTapRecord.clicked && window.mapTapRecord.opened.length > 0, null, {timeout:2000});
            const opened = await page.evaluate(() => [...new Set(window.mapTapRecord.opened)]);
            assert.deepEqual(opened, [`Stop ${m.number}`], `${where}: touch on ${m.number}`);
          }
          if(day.name==='dense-north-east') await page.screenshot({path:path.join(proof,`${where}.png`)});
        }
      }
      if (width === 320) {
        const lifecycleToggle = page.locator('button[aria-expanded]');
        if ((await lifecycleToggle.getAttribute('aria-expanded')) !== 'true') await lifecycleToggle.click();
        await page.evaluate(stops => window.setDay(stops), days[5].stops);
        await page.waitForTimeout(700);
        for (const action of ['zoom', 'pan']) {
          if (action === 'zoom') await page.locator('.leaflet-control-zoom-in').click();
          else {
            const box = await page.locator('.leaflet-container').boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 180, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
          }
          await page.waitForTimeout(900);
          const markers = await page.locator('.route-map-marker').evaluateAll(es => es.map(e => { const r=e.getBoundingClientRect();return {number:e.textContent,x:r.left+r.width/2,y:r.top+r.height/2}; }));
          for (const m of markers) {
            await page.mouse.move(m.x,m.y);
            await page.waitForFunction(label => [...document.querySelectorAll('.leaflet-tooltip')].some(e => e.style.opacity !== '0' && e.textContent === label), `Stop ${m.number}`, { timeout: 2000 });
            const clips = await page.evaluate(() => {
              const box=document.querySelector('.leaflet-container').getBoundingClientRect();
              return [...document.querySelectorAll('.leaflet-tooltip')].filter(e=>e.style.opacity!=='0').map(e=>{const r=e.getBoundingClientRect();return r.left<box.left||r.right>box.right||r.top<box.top||r.bottom>box.bottom;});
            });
            if (!clips.length || clips.some(c=>c)) await page.screenshot({path:path.join(proof,`lifecycle-${action}-${m.number}-failure.png`)});
            assert.ok(clips.length > 0 && clips.every(c=>!c), `${action}: visible number ${m.number} must reveal an on-map name`);
          }
          results.push({where:`lifecycle-${action}-320`,markers,issues:[]});
        }
        const many=Array.from({length:100},(_,i)=>({id:i,label:`Crowded ${i}`,lat:55.6,lng:13}));
        await page.evaluate(stops=>window.setDay(stops),many);
        await page.waitForFunction(()=>[...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('trång')));
        await page.evaluate(()=>window.setDay([]));
        await page.waitForFunction(()=>!document.querySelector('.route-map-marker')&&![...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('trång')));
        await fs.writeFile(path.join(proof,'results.json'),JSON.stringify(results,null,2));
      }
      assert.deepEqual(errors,[]);await context.close();
    }
    t.diagnostic(lifecycleProbe ? 'Lifecycle probe at 320px: zoom/pan and crowded-to-empty verified' : `${days.length} days (6 fixtures + 12 seeded), 3 widths, collapsed/expanded plus zoom/pan: ${results.length} views passed`);
  } finally {
    await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await fs.rm(temp,{recursive:true,force:true});
  }
});
