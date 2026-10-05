import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
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

const unknown = /Live information is unavailable right now|Live-information är inte tillgänglig just nu/;
const falseEmpty = /Nothing verified|Nothing listed|Inget verifierat|Inget listat/;

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
    assert.match(empty, falseEmpty);
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
    populated[time === 'week' ? 'this_week' : 'tonight'] = [{id:'event',title:'Deterministic calendar event'}];
    const shown = await render(populated,lang,time);
    assert.match(shown,/Deterministic calendar event/);
    assert.doesNotMatch(shown,falseEmpty);
  }
});
