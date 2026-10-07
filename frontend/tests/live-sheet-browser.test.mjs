import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

// Native browser, real mounted React, deterministic captured/fixture data.
// This is NOT real-provider, deployed-runtime, geographic or phone acceptance.
const captured = JSON.parse(readFileSync(new URL('./fixtures/captured-uncovered-live.json', import.meta.url)));
const bundle = await build({
  stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import LiveSheet from './src/components/planner/LiveSheet';
    import { pulseHealthState, liveSourceFailure } from './src/lib/pulse-view.mjs';
    const root = createRoot(document.getElementById('root'));
    window.renderSheet = (events, lang, time = 'tonight', extra = {}) => {
      const buckets = { tonight: events?.tonight || [], thisWeek: events?.this_week || [] };
      const state = pulseHealthState(events, buckets);
      window.sheetState = state;
      root.render(<LiveSheet lang={lang} t={(sv,en) => lang === 'sv' ? sv : en}
        anchorLabel="Fixture area" selected={[]} liveDayLabel="Selected day"
        liveSheetTime={time} setLiveSheetTime={() => {}} onRetry={() => window.retried = true}
        liveSheetScope="around_place" requestLiveSheetScope={() => {}}
        aroundPlaceScopeAvailable={true} inPlaceScopeAvailable={true} routeScopeAvailable={false}
        liveQueryPending={false} liveQueryGeoHint={null} liveQueryError={null}
        sheetLiveEvents={events} sheetBuckets={buckets} sheetBrowseBuckets={{tonight:[],thisWeek:[]}}
        sheetPulseState={state} sheetFailure={liveSourceFailure(events,buckets)}
        sheetSourceHealth={events?.acquisition?.source_health || null} sheetSources={null}
        wovenNames={[]} includedInRoute="Included in route"
        liveFailureSentence={() => 'Selected-source failure preserved'}
        dialogRef={{current:null}} closeRef={{current:null}} onClose={() => {}} {...extra} />);
    };`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
});

async function browserHarness(t) {
  const browser = await chromium.launch({
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    headless: true, args: ['--no-sandbox'],
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const render = async (events, lang = 'en', time = 'tonight', extra = {}) => {
    await page.evaluate(({events,lang,time,extra}) => window.renderSheet(events,lang,time,extra), {events,lang,time,extra});
    // Wait for React's scheduled commit, not just for the previous dialog.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return page.locator('[role="dialog"]').innerText();
  };
  t.after(() => assert.deepEqual(errors, [], 'no React/browser exceptions'));
  return { page, render };
}

test('mobile LiveSheet long source periods do not push event text offscreen', async t => {
  const {page,render}=await browserHarness(t);
  const cssDir=new URL('../dist/_astro/',import.meta.url);
  for(const file of readdirSync(cssDir).filter(f=>f.endsWith('.css'))) {
    await page.addStyleTag({content:readFileSync(new URL(file,cssDir),'utf8')});
  }
  const row={id:'long-period',title:"Exposició 'Recerca del passat per a salvar el futur'",place:'Carrer de Sant Cugat',
    timezone:'Europe/Madrid',time_window:{kind:'period',starts_on:'2026-09-10',ends_on:'2026-10-31'},
    source_label:'Open Data BCN',source_url:'https://guia.barcelona.cat/event',source_link_kind:'page',source_link_host:'guia.barcelona.cat'};
  const events={coverage:'covered',selected_date:'2026-10-07',tonight:[],this_week:[row],acquisition:{source_health:{status:'healthy',result:'events_found',selected_source_count:1,responding_source_count:1}}};
  for(const width of [320,390,430]) {
    await page.setViewportSize({width,height:844});
    await render(events,'en','week');
    const dimensions=await page.getByRole('dialog').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));
    assert.ok(dimensions.scroll<=dimensions.width+1,`width ${width}: dialog ${JSON.stringify(dimensions)}`);
    const title=await page.getByText(row.title,{exact:true}).boundingBox();
    assert.ok(title.x>=0 && title.x+title.width<=width+1,'event title stays fully inside viewport');
  }
});

const unknown = /Live information is unavailable right now|Live-information är inte tillgänglig just nu/;
const falseEmpty = /Nothing verified|Nothing listed|Inget verifierat|Inget listat/;

test('native mounted calendar layout retains escaped credit, admin scope and half-day flags in sv/en and both periods', async t => {
  const { page, render } = await browserHarness(t);
  const url = 'https://api.example/PublicHolidays?countryIsoCode=XX&validFrom=2026-07-20';
  const credit = '<img src=x onerror=alert(1)> & OpenHolidays API — ODbL';
  const row = { id: 'calendar-fact', title: 'Source holiday title', place: 'Trusted region', starts_on: '2026-07-20',
    ends_on: '2026-07-20', time_window: { kind: 'period', starts_on: '2026-07-20', ends_on: '2026-07-20' },
    calendar_fact: { kind: 'public_holiday', scope: 'regional', country_code: 'XX', area: 'Trusted region',
      temporal_scope: 'half_day', flags: ['Recommended', 'Provisional'] }, source_label: 'OpenHolidays API',
    source_url: url, source_link_kind: 'page', source_link_host: 'api.example',
    sources: [{attribution:credit},{attribution:credit}], lat:null,lng:null,route_eligible:false };
  const withoutUrl = { ...row, id:'no-url', title:'Holiday without source URL', source_url:null, source_link_kind:null, source_link_host:null };
  const events = { coverage:'covered',selected_date:'2026-07-20',tonight:[row,withoutUrl],this_week:[row,withoutUrl],
    acquisition:{source_health:{status:'healthy',result:'events_found',selected_source_count:1,responding_source_count:1}} };
  for (const lang of ['en','sv']) for (const time of ['tonight','week']) {
    const shown = await render(events,lang,time);
    assert.match(shown,/Source holiday title/);
    assert.match(shown,/20 jul/i);
    assert.match(shown,/Trusted region/);
    assert.match(shown,lang === 'en' ? /Regional public holiday — programme not verified/ : /Regional helgdag — program inte verifierat/);
    assert.match(shown,lang === 'en' ? /Half day — time unspecified/ : /Halvdag — tid saknas/);
    assert.match(shown,lang === 'en' ? /Recommended by source/ : /Rekommenderad enligt källan/);
    assert.match(shown,lang === 'en' ? /Provisional date/ : /Preliminärt datum/);
    assert.equal(shown.split(credit).length - 1,2);
    assert.equal(await page.locator('img').count(),0);
    const anchors = page.locator('a');
    assert.equal(await anchors.count(),1);
    assert.equal(await anchors.getAttribute('href'),url);
    assert.equal((await anchors.innerText()).replace(/\s*↗$/, ''),'api.example');
    const dialog = await page.locator('[role="dialog"]').boundingBox();
    assert.ok(dialog.width <= 390,'dialog stays within the narrow fixture viewport');
  }
});

test('native mounted LiveSheet never calls hidden knowledge an empty calendar', async t => {
  const { render } = await browserHarness(t);
  for (const lang of ['en', 'sv']) for (const events of [null, { coverage: 'unknown', tonight: [], this_week: [] }]) {
    const text = await render(events, lang);
    assert.match(text, unknown);
    assert.doesNotMatch(text, falseEmpty);
  }
});

test('native mounted LiveSheet distinguishes captured uncovered and healthy controls in sv/en', async t => {
  const { page, render } = await browserHarness(t);
  const events = health => ({ coverage: 'covered', tonight: [], this_week: [], acquisition: { source_health: health } });
  for (const lang of ['en', 'sv']) for (const time of ['tonight', 'week']) {
    for (const response of captured) {
      const text = await render(response.live_events, lang, time);
      assert.match(text, /No verified calendar coverage for this area yet|Verifierad kalendertäckning saknas för det här området/);
      assert.doesNotMatch(text, falseEmpty);
      assert.doesNotMatch(text, /0\/0|no_approved_sources/);
      assert.equal(await page.evaluate(() => window.sheetState), 'uncovered');
    }
    const empty = await render(events({ status:'healthy', result:'empty', selected_source_count:1, responding_source_count:1 }), lang, time);
    assert.match(empty, /The sources responded but list no events for this period|Källorna svarade men listar inga händelser för perioden/);
    assert.match(empty, /1\/1/);
    assert.doesNotMatch(empty, unknown);
    const pending = await render({ ...events({status:'pending', result:'pending', selected_source_count:1}), pending:true },lang,time);
    assert.match(pending, /calendars are still updating|Kalendrarna uppdateras fortfarande/);
    assert.doesNotMatch(pending, /responded|svarade/);
    const refreshing = await render(captured[0].live_events,lang,time,{liveQueryPending:true});
    assert.match(refreshing, /Refreshing verified sources|Uppdaterar verifierade källor/);
    assert.doesNotMatch(refreshing, falseEmpty);
    for (const status of ['unknown','unavailable']) {
      const unavailable = await render(events({status,result:'unknown',selected_source_count:0}),lang,time);
      assert.match(unavailable,unknown);
      assert.doesNotMatch(unavailable,falseEmpty);
      assert.doesNotMatch(unavailable,/0\/0/);
      await page.getByRole('button', {name:lang === 'en' ? 'Try again' : 'Försök igen',exact:true}).click();
      assert.equal(await page.evaluate(() => window.retried),true);
    }
    const failed = await render(events({status:'unavailable',result:'unknown',selected_source_count:1,responding_source_count:0}),lang,time);
    assert.match(failed,/Selected-source failure preserved/);
    const populated = events({status:'healthy',result:'events_found',selected_source_count:1,responding_source_count:1});
    populated.selected_date = '2026-07-20';
    populated[time === 'week' ? 'this_week' : 'tonight'] = [{id:'event',title:'Deterministic calendar event',
      source_label:'OpenStreetMap', source_url:'https://www.openstreetmap.org/node/42',
      source_link_kind:'page',source_link_host:'openstreetmap.org',
      sources:[{attribution:'© OpenStreetMap contributors — ODbL'}],
      recurrence:{rule:'Mo,Th 09:00-13:00',occurrence_status:'unconfirmed'},
      timezone:'Europe/Paris', time_window:{kind:'occurrences',dates:['2026-07-20','2026-07-23'],local_start:'09:00',local_end:'13:00'},
    }];
    const shown = await render(populated,lang,time);
    assert.match(shown,/Deterministic calendar event/);
    assert.ok(shown.includes('09:00–13:00'), 'the source-local occurrence clock remains visible');
    assert.doesNotMatch(shown,falseEmpty);
    assert.ok(shown.includes(lang === 'en' ? 'Recurring schedule — occurrence unconfirmed'
      : 'Återkommande schema — tillfället är inte bekräftat'));
    assert.ok(shown.includes('© OpenStreetMap contributors — ODbL'));
    assert.equal(await page.locator('a[href="https://www.openstreetmap.org/node/42"]').count(),1);
  }
});
