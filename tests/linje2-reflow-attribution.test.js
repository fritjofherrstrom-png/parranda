'use strict';
// Real components in offline Chromium. Dist must be rebuilt after CSS changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../frontend/node_modules/esbuild');
const { chromium } = require('playwright-core');
const { waitForRouteMapLayout } = require('./helpers/route-map-ready');
let browser, script, css;
test.before(async () => {
  const result = await build({ stdin: { resolveDir: path.resolve('frontend'), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import StopLine from './src/components/planner/StopLine';
    import RouteMap from './src/components/planner/RouteMap';
    const root=createRoot(document.getElementById('root'));
    const stops=[{id:'a',label:'Museum',lat:55.6,lng:13,type:'museum',daypart:'evening'},
      {id:'b',label:'Second place',lat:55.601,lng:13.002,type:'museum',daypart:'evening'}];
    window.renderFixture=(kind,lang='en',geometry=true)=>{
      const t=(sv,en)=>lang==='sv'?sv:en;
      root.render(kind==='line'?<StopLine t={t} lang={lang} stale={false} routeLineIsSketch={true}
        split={{core:stops,woven:[]}} routeStops={stops} legForStop={()=>null}
        expandedStopKey={null} setExpandedStopKey={()=>{}} expandedCandidateKey={null} setExpandedCandidateKey={()=>{}}
        commitments={{}} selected={[]} releaseCommitment={()=>{}} keepStop={()=>{}} dismissStop={()=>{}} removeStop={()=>{}} commit={()=>{}}
        eveningEvent={null} selectedDate="2026-11-18" dayOffset={0} follow={{supported:true,state:{status:'idle'}}}
        following={false} canFollowToday={true} onToggleFollow={()=>{}} routeContextSuggestions={[]}
        detoursOpen={false} setDetoursOpen={()=>{}} continuesFromMap={true}/>
        :<RouteMap t={t} hasPrimaryRoute={kind!=='places'} routeStops={stops} primaryRoute={{map_path_points:stops,
          geometry_source:geometry?'osrm':'heuristic',geometry_mode:'walking',geometry_attribution:{label:'FOSSGIS',
          url:'https://routing.openstreetmap.de/about.html',fixMapUrl:'https://www.openstreetmap.org/fixthemap'}}}
          areas={kind==='places'?[{center:stops[0],stops}]:[]} routeContextSuggestions={[]} showContext={false} sketch={true} still={true} heightClass="h-[190px]"/>);
    };` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{name:'worker-url',setup(build){
      build.onResolve({filter:/\?worker&url$/},args=>({path:args.path,namespace:'worker-url'}));
      build.onLoad({filter:/.*/,namespace:'worker-url'},()=>({contents:`export default ${JSON.stringify('data:text/javascript;base64,'+fs.readFileSync('frontend/node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs').toString('base64'))};`}));
    }}] });
  script = result.outputFiles[0].text;
  css = fs.readdirSync('frontend/dist/_astro').filter(n=>n.endsWith('.css')).map(n=>fs.readFileSync('frontend/dist/_astro/'+n,'utf8')).join('\n');
  browser = await chromium.launch({headless:true,...(process.env.PARRANDA_TEST_CHROMIUM ? {executablePath:process.env.PARRANDA_TEST_CHROMIUM} : {})});
});
test.after(async()=>browser?.close());
test('route-map readiness scrolls first and settles mobile and desktop layouts before measurement', async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  try {
    for(const selector of ['[data-route-map]','aside']) {
      await page.setContent(`<div style="height:1200px"></div><aside aria-label="Karta över dagen">
        <div data-route-map><div class="maplibregl-map" style="height:190px;position:relative">
          <div class="maplibregl-ctrl" style="height:20px"></div>
          <div class="route-map-marker" style="position:absolute;left:0;top:40px;width:44px;height:44px;transition:left 150ms linear">1</div>
        </div></div></aside><div style="height:1200px"></div>`);
      await page.evaluate(()=>{
        const marker=document.querySelector('.route-map-marker');
        marker.getBoundingClientRect();
        // Like ResizeObserver's queued refit: not completed at the first frame.
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          document.querySelector('.maplibregl-ctrl').style.height='40px';
          marker.style.left='100px';
        }));
      });
      await waitForRouteMapLayout(page.locator(selector));
      const settled=await page.evaluate(()=>{
        const map=document.querySelector('.maplibregl-map').getBoundingClientRect();
        return {left:parseFloat(getComputedStyle(document.querySelector('.route-map-marker')).left),
          controlHeight:document.querySelector('.maplibregl-ctrl').getBoundingClientRect().height,
          inView:map.top>=0&&map.bottom<=innerHeight};
      });
      assert.deepEqual(settled,{left:100,controlHeight:40,inView:true},selector);
    }
  } finally {await page.close();}
});
async function pageFor(webgl=true) {
  const page=await browser.newPage();
  await page.route('**/*',r=>r.abort());
  if(!webgl) await page.addInitScript(()=>{}); // getContext is patched before mounting below.
  await page.setContent('<main style="padding:24px 16px"><div id="root"></div></main>');
  if(!webgl) await page.evaluate(()=>{ const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){if(/webgl/.test(kind)){window.webglRefused=true;return null;}return original.call(this,kind,...args);}; });
  await page.addStyleTag({content:css});
  await page.addScriptTag({content:script});
  return page;
}
test('daypart and follow reflow without overlap or overflow in both themes and languages', async()=>{
  const page=await pageFor();
  try {
    const failures=[];
    for(const width of [320,390,1440]) for(const theme of ['day','night']) for(const lang of ['sv','en']) for(const font of [16,32]) {
      await page.setViewportSize({width,height:900});
      await page.evaluate(({theme,lang,font})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=font+'px';window.renderFixture('line',lang);},{theme,lang,font});
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      const result=await page.evaluate(()=>{const h=document.querySelector('h3'),b=document.querySelector('button[aria-pressed]');
        const range=document.createRange();range.selectNodeContents(h);const a=range.getBoundingClientRect(),c=b.getBoundingClientRect();
        return {overlap:a.left<c.right&&a.right>c.left&&a.top<c.bottom&&a.bottom>c.top,
          overflow:document.documentElement.scrollWidth>innerWidth,buttonHeight:c.height};});
      if(result.overlap||result.overflow||result.buttonHeight<44) failures.push({width,theme,lang,font,...result});
    }
    assert.deepEqual(failures,[]);
  } finally {await page.close();}
});
for(const webgl of [false,true]) for(const geometry of [true,false]) {
  test(`walking credit: WebGL ${webgl?'available':'initialization refused'}, geometry ${geometry}`,async()=>{
    const page=await pageFor(webgl);
    try {
      await page.evaluate(geometry=>window.renderFixture('map','en',geometry),geometry);
      if(!webgl) {
        await page.getByText("The map can't be shown in this browser.",{exact:false}).waitFor({timeout:15000});
        assert.equal(await page.evaluate(()=>window.webglRefused),true,'actual MapLibre constructor requested WebGL');
      } else {
        await page.locator('.route-map-marker').first().waitFor({timeout:15000});
        await page.getByText('Drawing the map …').waitFor({state:'detached'});
      }
      assert.equal(await page.getByRole('link',{name:'FOSSGIS',exact:true}).count(),geometry?1:0);
      assert.equal(await page.getByRole('link',{name:'Fix the map',exact:true}).count(),geometry?1:0);
      if(webgl&&geometry) assert.equal(await page.locator('.maplibregl-ctrl-attrib').getByRole('link',{name:'FOSSGIS',exact:true}).count(),1);
    } finally {await page.close();}
  });
}

test('candidate map failure copy describes places without promising a route', async()=>{
  for(const webgl of [false,true]) {
    const page=await pageFor(webgl);
    try {
      await page.evaluate(()=>window.renderFixture('places','en',false));
      const status = webgl
        ? "The map background couldn't be loaded. Nearby places are still shown."
        : "The map can't be shown in this browser. Nearby places are still listed.";
      await page.getByRole('status').filter({hasText:status}).waitFor({timeout:6000});
      assert.equal(await page.locator('.route-map-marker').count(),0);
      assert.equal(await page.getByRole('link',{name:'FOSSGIS',exact:true}).count(),0);
    } finally {await page.close();}
  }
});
