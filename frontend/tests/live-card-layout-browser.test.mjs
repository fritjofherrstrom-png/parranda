import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {chromium} from 'playwright-core';import {readFileSync,readdirSync} from 'node:fs';import {fileURLToPath} from 'node:url';
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import LiveCard from './src/components/planner/LiveCard';const root=createRoot(document.getElementById('root'));window.renderCard=(events,lang)=>root.render(<LiveCard t={(sv,en)=>lang==='sv'?sv:en} lang={lang} mode="typed" anchorLabel="Stockholm" liveEvents={events} liveDayLabel="Wed 7 Oct" showDay={true} dayflow={null} clothing={null} wovenNames={[]} includedInRoute="" pulseState="populated" liveFailure={null} liveFailureSentence={()=>''} pulseBuckets={{tonight:events.tonight,thisWeek:[]}} showExplore={false} pulseSources={null} liveSheetTriggerRef={{current:null}} openLiveSheet={()=>{}}/>);`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic'});
test('Stockholm Live card keeps long source dates and titles inside mobile viewport in sv/en',async t=>{const browser=await chromium.launch({executablePath:process.env.PARRANDA_TEST_CHROMIUM,headless:true,args:['--no-sandbox']});t.after(()=>browser.close());const page=await browser.newPage();await page.setContent('<div id="root"></div>');const cssDir=new URL('../dist/_astro/',import.meta.url);for(const name of readdirSync(cssDir).filter(x=>x.endsWith('.css')))await page.addStyleTag({content:readFileSync(new URL(name,cssDir),'utf8')});await page.addScriptTag({content:bundle.outputFiles[0].text});const ev={id:'event',title:'Högt uppsatta vänner: Utgrävningar vid en biskopsbostad på Island',place:'Historiska museet',time_window:{kind:'period',starts_on:'2026-09-10',ends_on:'2026-10-31'},source_url:'https://historiska.se/event',source_link_kind:'page',source_link_host:'historiska.se'};for(const width of [320,390,430])for(const lang of ['en','sv']){await page.setViewportSize({width,height:844});await page.evaluate(({ev,lang})=>window.renderCard({selected_date:'2026-10-07',tonight:[ev]},lang),{ev,lang});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const rect=await page.locator('section').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));assert.ok(rect.scroll<=rect.width+1,`${lang} ${width}: ${JSON.stringify(rect)}`);const box=await page.getByText(ev.title,{exact:true}).boundingBox();assert.ok(box.x+box.width<=width+1,'full title fits viewport');}});

test('Live card timing stays in natural case with a separate visible uncertainty note and readable place', async t => {
  const browser = await chromium.launch({executablePath:process.env.PARRANDA_TEST_CHROMIUM,headless:true,args:['--no-sandbox']});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.setContent('<div id="root"></div>');
  const cssDir=new URL('../dist/_astro/',import.meta.url);
  for(const name of readdirSync(cssDir).filter(x=>x.endsWith('.css'))) await page.addStyleTag({content:readFileSync(new URL(name,cssDir),'utf8')});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const ev={id:'readable',title:'Höstlov på Kiviks Musteri',place:'Kiviks Musteri, Kivik; tel: 0414-719 00, Epost: info@kiviksmusteri.se',
    time_window:{kind:'period',starts_on:'2026-10-01',ends_on:'2026-10-31',local_start:'09:30',local_end:'15:30'},
    source_label:'Simrishamns kommuns evenemangskalender',source_url:'https://venue.example/event',source_link_kind:'page',source_link_host:'venue.example',
    sources:[{attribution:'© Source owner — CC BY 4.0'}]};
  for(const width of [320,390,430]) for(const lang of ['en','sv']) {
    await page.setViewportSize({width,height:844});
    await page.evaluate(({ev,lang})=>window.renderCard({selected_date:'2026-10-07',tonight:[ev]},lang),{ev,lang});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const title=page.getByRole('heading',{name:ev.title,exact:true});
    const clock=page.locator('p').filter({hasText:'09:30–15:30'});
    const place=page.getByText('Kiviks Musteri, Kivik',{exact:true});
    assert.equal(await clock.evaluate(e=>getComputedStyle(e).textTransform),'none','dates remain in natural case');
    const [titleBox,clockBox,placeBox]=await Promise.all([title.boundingBox(),clock.boundingBox(),place.boundingBox()]);
    assert.ok(titleBox.y+titleBox.height<=clockBox.y+1,'title precedes timing on a separate line');
    assert.ok(clockBox.y+clockBox.height<=placeBox.y+1,'place follows timing on a separate line');
    assert.equal(await page.getByText(lang==='en'?'Check current days and times with the organiser.':'Se aktuella dagar och tider hos arrangören.',{exact:true}).isVisible(),true);
    assert.equal(await page.getByText('© Source owner — CC BY 4.0',{exact:true}).isVisible(),true,'required credit remains visible');
    assert.equal(await page.locator('a[href="https://venue.example/event"]').isVisible(),true,'destination stays outside disclosure');
    assert.doesNotMatch(await page.locator('section').innerText(),/0414-719|info@kiviksmusteri/);
    const details=page.locator('summary').filter({hasText:lang==='en'?'Source details':'Källinformation'});
    await details.click();
    assert.equal(await page.getByText('via Simrishamns kommuns evenemangskalender').isVisible(),true,'full feed attribution stays reachable');
    const rect=await page.locator('section').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));
    assert.ok(rect.scroll<=rect.width+1,lang+' '+width+': '+JSON.stringify(rect));
    await details.click();
  }
});
