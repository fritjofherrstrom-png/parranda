import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { mountPlanner } from './helpers/planner-harness.mjs';
import { LAST_KEY, savedEntryId } from '../src/lib/anywhere-storage.mjs';
import { parsePublishedDay } from '../src/lib/published-day.mjs';
import { readCommitmentSnapshot } from '../src/lib/commitment-snapshot.mjs';
import { anchorKey } from '../src/lib/recompose-retention.mjs';
import { navigationAddress, navigationHref, navigationHistoryState, saveNavigationPublication, readNavigationPublication } from '../src/lib/planner-navigation.mjs';
const require = createRequire(import.meta.url);
require('../../tests/helpers/no-live-network.js');
const { buildApp } = require('../../server/app.js');
const { createPublishedDayStore } = require('../../server/planner/published-day-store.js');
const { createWikidataSource } = require('../../server/place-candidates/wikidata-source.js');
const { mockStableWeatherFetch } = require('../../tests/helpers/planner-reservoir-compare.js');
const click = (h, element) => h.act(() => {
  assert.ok(element, 'actual offered control exists');
  element.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
});
const button = (h, pattern) => [...h.container.querySelectorAll('button')].find(b => pattern.test(b.getAttribute('aria-label') || b.textContent));
const ids = entry => entry.safeResponse.days[0].primary_route?.main_stops.map(s => s.id) || [];
function request(server, call) {
  return new Promise((resolve, reject) => {
    const payload = call.body === null ? null : JSON.stringify(call.body);
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: call.url,
      method: call.method, headers: payload ? { 'Content-Type': 'application/json' } : {} }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end(payload);
  });
}
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'recipient-day-'));
  const originalFetch = global.fetch;
  global.fetch = mockStableWeatherFetch();
  let loads = 0, resolutions = 0, puts = 0;
  const source = createWikidataSource({ limit: 60, fetcher: async () => ({ ok: true, json: async () => ({ results: { bindings:
    Array.from({ length: 24 }, (_, i) => ({ item: { value: `http://www.wikidata.org/entity/Q${1000+i}` },
      itemLabel: { value: `Collection ${i+1}` }, lat: { value: String(41.9+(i%6)*.0008) },
      lng: { value: String(12.49+Math.floor(i/6)*.0008) }, classRoot: { value: 'http://www.wikidata.org/entity/Q33506' } })) } }) }) });
  const records = await source({ lat: 41.9, lng: 12.49 });
  const store = createPublishedDayStore({ directory });
  const server = buildApp({ openDataLoader: async () => { loads++; return records; },
    placeResolver: async () => { resolutions++; return [{ label: 'Roma, Italia', lat: 41.9, lng: 12.49,
      confidence: 'high', provenance: 'offline_fixture', timezone: 'Europe/Rome', osm_class: 'place', osm_ref: 'relation/41485' }]; },
    placeSuggestions: null, reviewedPlaceSource: null, sourceCatalog: null, eventSupply: null,
    placeSelectionStore: { issue: () => null }, publishedDayStore: { read: store.read, async put(value) { puts++; return store.put(value); } },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(r => server.close(r)); global.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); });
  return { server, directory, counts: () => ({ loads, resolutions, puts }) };
}
async function relay(h, server, call) {
  // The mounted request and the actual final response cross real loopback HTTP.
  const clientFetch = global.fetch;
  let response;
  try { global.fetch = mockStableWeatherFetch(); response = await request(server, call); }
  finally { global.fetch = clientFetch; }
  await h.act(() => call.resolveResponse(new Response(response.text, { status: response.status, headers: { 'Content-Type': 'application/json' } })));
  return JSON.parse(response.text);
}

test('mounted original → real publication/store → Share → empty-profile GET restores the immutable day', async t => {
  const backend = await setup(t);
  const first = await mountPlanner({ url: 'http://localhost/anywhere?place=Roma&prefs=culture&lang=en' });
  let href, original, envelope;
  try {
    const call = first.fetchMock.calls[0];
    assert.ok(call.url.startsWith('/api/route-recommendations'));
    original = await relay(first, backend.server, call);
    assert.equal(original.agnostic_route_output_experiment.promotion.promote, true);
    assert.ok(original.days[0].primary_route.main_stops.every(s => s.origin === 'curated_catalog' && !s.id.startsWith('wikidata-')));
    assert.equal(new URL(call.url, 'http://localhost').searchParams.get('include_day_snapshot'), '1', 'original typed execution must opt in');
    assert.equal(original.day_snapshot?.state, 'ready', 'real persisted terminal sidecar');
    assert.equal(first.readStorage(LAST_KEY).dateIso, call.body.dates[0]);
    const copied = [];
    Object.defineProperty(first.window.navigator, 'clipboard', { value: { writeText: async s => copied.push(s) } });
    await click(first, button(first, /^Share/));
    assert.equal(copied.length, 1);
    href = copied[0];
    assert.equal(href, `http://localhost/anywhere?snapshot=${original.day_snapshot.ref}&lang=en`);
    assert.equal(first.fetchMock.calls.length, 1, 'Share never composes or uploads');
    const stored = JSON.parse(await readFile(join(backend.directory, 'published-days-v1', `${original.day_snapshot.ref}.json`), 'utf8'));
    assert.ok(JSON.stringify(stored).includes(original.day_snapshot.ref), 'actual atomic file exists before Share');
  } finally { await first.unmount(); }
  const counts = backend.counts();
  const recipient = await mountPlanner({ url: href });
  try {
    assert.equal(recipient.window.localStorage.length, 0, 'empty recipient profile before read');
    const [get] = recipient.fetchMock.calls;
    assert.equal(get.url, `/api/shared-days/${original.day_snapshot.ref}`);
    assert.equal(get.method, 'GET'); assert.equal(get.body, null);
    envelope = await relay(recipient, backend.server, get);
    const restored = recipient.readStorage(LAST_KEY);
    assert.deepEqual(ids(restored), original.days[0].primary_route.main_stops.map(s => s.id));
    assert.equal(restored.dateIso, original.days[0].date);
    assert.deepEqual(restored.safeResponse, envelope.result, 'authoritative projected facts, not regenerated facts');
    assert.match(recipient.text(), /Saved day/);
    assert.equal(recipient.window.location.href, href, 'no private view contaminates the public URL');
    await recipient.clock.advance(6000);
    assert.equal(recipient.fetchMock.calls.length, 1);
    assert.deepEqual(backend.counts(), counts, 'GET and restore acquire/compose nothing');
    t.diagnostic(JSON.stringify({ ref: original.day_snapshot.ref, date: restored.dateIso, ids: ids(restored), counts }));
  } finally { await recipient.unmount(); }
});

test('real acknowledged priorities/rhythm/pin reason survive public language/reload; explicit rhythm action rebuilds the frozen day', async t => {
  const backend = await setup(t);
  const date = '2026-10-25';
  const result = await request(backend.server, { method:'POST', url:'/api/route-recommendations?lang=en&experimental_agnostic_route_output=1&agnostic_engine_compose=1&include_day_snapshot=1',
    body:{place:'Roma',dates:[date],preferences:['culture','views'],preference_priority:['views','culture'],day_rhythm:'calm',pinned_candidate_ids:['missing-source-place'],live_event_choices:[{occurrence_id:`live:${date}:${'c'.repeat(32)}`,action:'remove'}],include_external_candidates:1} });
  const original = JSON.parse(result.text);
  assert.equal(original.day_snapshot?.state,'ready');
  const ref = original.day_snapshot.ref;
  const href = `http://localhost/anywhere?snapshot=${ref}&lang=en`;
  let envelope, expected, svHref;
  const h = await mountPlanner({url:href});
  try {
    envelope = await relay(h,backend.server,h.fetchMock.calls[0]);
    expected = h.readStorage(LAST_KEY);
    assert.ok(expected,'real envelope accepted by mounted parser');
    assert.deepEqual(expected.inputs.preferencePriority,['views','culture']);
    assert.equal(expected.inputs.walkKey,'calm');
    assert.equal(expected.id,savedEntryId({...expected.inputs,dateIso:date}));
    const ledger = readCommitmentSnapshot(expected.commitments,{anchorKey:anchorKey(expected.inputs),dayKey:expected.id});
    assert.equal(ledger.applies,true);
    assert.deepEqual(ledger.entries[`live:${date}:${'c'.repeat(32)}`],{kind:'exclude',label:'',liveAction:'remove'},'acknowledged occurrence removal retains exact identity and action');
    assert.deepEqual(ledger.refusals,original.agnostic_route_output_experiment.pinned_candidates.unhonored.filter(f=>f.reason));
    const sv = [...h.container.querySelectorAll('a')].find(a=>a.textContent.trim()==='SV');
    svHref = sv.href;
    assert.equal(svHref,`http://localhost/anywhere?snapshot=${ref}&lang=sv`);
  } finally { await h.unmount(); }
  // Private storage can be blocked and the calendar can roll over independently
  // of the accepted absolute date. The same public reference remains the owner.
  t.mock.timers.enable({apis:['Date'],now:Date.now()+86400000});
  for (const navigationType of ['navigate','reload','back_forward']) {
    const next = await mountPlanner({url:svHref,navigationType,props:{lang:'sv'}});
    Object.defineProperty(next.window,'sessionStorage',{configurable:true,get(){throw new Error('blocked');}});
    try {
      await relay(next,backend.server,next.fetchMock.calls[0]);
      assert.equal(next.window.location.href,svHref);
      assert.deepEqual(ids(next.readStorage(LAST_KEY)),ids(expected));
      assert.equal(next.readStorage(LAST_KEY).dateIso,date);
      assert.match(next.text(),/Sparad dag/);
      await next.clock.advance(6000);
      assert.equal(next.fetchMock.calls.length,1,'language/reload never acquires');
    } finally { await next.unmount(); }
  }
  const action = await mountPlanner({url:href});
  try {
    await relay(action,backend.server,action.fetchMock.calls[0]);
    await click(action,button(action,/^Adjust/));
    await click(action,button(action,/^Full/));
    await action.clock.advance(450);
    const rebuild = action.fetchMock.calls.find(c=>c.url.startsWith('/api/route-recommendations'));
    assert.ok(rebuild,'an explicit action must not remain suppressed behind restoredAt');
    assert.deepEqual(rebuild.body.dates,[date]);
    assert.equal(rebuild.body.place_ref,'r41485');
    assert.equal(rebuild.body.place_selection,undefined);
  } finally { await action.unmount(); }
});

async function actualEnvelope(t, extra={}) {
  const backend=await setup(t);
  const result=await request(backend.server,{method:'POST',url:'/api/route-recommendations?lang=en&experimental_agnostic_route_output=1&agnostic_engine_compose=1&include_day_snapshot=1',body:{place:'Roma',dates:['2026-10-25'],preferences:['culture'],day_rhythm:'balanced',include_external_candidates:1,...extra}});
  const original=JSON.parse(result.text);
  assert.equal(original.day_snapshot?.state,'ready');
  const get=await request(backend.server,{method:'GET',url:`/api/shared-days/${original.day_snapshot.ref}`,body:null});
  assert.equal(get.status,200);
  return {backend,original,envelope:JSON.parse(get.text)};
}

test('null durable place references refuse before replacing LAST or offering a label-only rebuild',async t=>{
  const {backend,envelope}=await actualEnvelope(t);
  const href=`http://localhost/anywhere?snapshot=${envelope.ref}&lang=en`;
  const valid=await mountPlanner({url:href});
  let previous;
  try{
    await relay(valid,backend.server,valid.fetchMock.calls[0]);
    previous=valid.readStorage(LAST_KEY);
    assert.ok(previous,'the actual canonical server reference is accepted');
    assert.equal(previous.inputs.placeRef,'r41485');
  }finally{await valid.unmount();}
  const unrelated={...previous,label:'Previously remembered day'};
  const malformed=structuredClone(envelope);
  // Incompatible transport control: the real server above emitted r41485,
  // not null. Only these two reference fields are corrupted deliberately.
  malformed.intent.placeRef=null;
  malformed.result.agnostic_route_output_experiment.intake.resolved.place_ref=null;
  const h=await mountPlanner({url:href,storage:{[LAST_KEY]:unrelated}});
  try{
    const get=h.fetchMock.calls[0];
    assert.equal(get.method,'GET');
    assert.equal(get.url,`/api/shared-days/${envelope.ref}`);
    await h.act(()=>get.resolveResponse(new Response(JSON.stringify(malformed))));
    await h.clock.advance(6000);
    assert.deepEqual(h.readStorage(LAST_KEY),unrelated,'incompatible identity must not replace an unrelated remembered answer');
    assert.match(h.text(),/shared day is unavailable/i);
    assert.doesNotMatch(h.text(),/Saved day/);
    assert.ok(!button(h,/rebuild for fresh events/i),'invalid identity must not offer a label-only rebuild');
    assert.equal(h.fetchMock.calls.length,1,'no acquisition, fallback, or automatic rebuild');
    assert.equal(h.window.location.href,href);
  }finally{await h.unmount();}
});

test('malformed public intent beats old LAST/history; incompatible reads never acquire or substitute',async t=>{
  const {envelope}=await actualEnvelope(t);
  const initial=await mountPlanner({url:`http://localhost/anywhere?snapshot=${envelope.ref}&lang=en`});
  let old;
  try {await initial.fetchMock.respond(initial.fetchMock.calls[0],envelope);old=initial.readStorage(LAST_KEY);} finally {await initial.unmount();}
  assert.ok(old);
  const memory=new Map();
  const privateStore={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)};
  const publication=saveNavigationPublication(privateStore,old,{address:navigationAddress(old,{lang:'en'}),readOnly:true});
  assert.ok(publication,'an independently valid old private publication exists');
  const privateHref=navigationHref(publication,'en');
  const historyState=navigationHistoryState(null,publication);
  assert.equal(readNavigationPublication(privateStore,{pathname:'/anywhere',search:new URL(privateHref,'http://localhost').search,state:historyState,navigationType:'reload'}).kind,'restored');
  const privateSession=Object.fromEntries([...memory].map(([key,value])=>[key,JSON.parse(value)]));
  const queries=['snapshot=','snapshot=BAD',`snapshot=${envelope.ref}&snapshot=${envelope.ref}`,`snapshot=${envelope.ref}&place=Roma`,`snapshot=${envelope.ref}&view=old`,`snapshot=${envelope.ref}&lang=en&lang=sv`,`${new URL(privateHref,'http://localhost').search.slice(1)}&snapshot=`];
  for(const query of queries){
    const h=await mountPlanner({url:`http://localhost/anywhere?${query}`,storage:{[LAST_KEY]:old},sessionStorage:privateSession,historyState,navigationType:'reload'});
    try {
      await h.clock.advance(1000);assert.equal(h.fetchMock.calls.length,0);assert.match(h.text(),/shared day is unavailable/i);
      assert.deepEqual(h.readStorage(LAST_KEY),old);assert.equal(h.window.location.search,`?${query}`);
      const sv=[...h.container.querySelectorAll('a')].find(a=>a.textContent.trim()==='SV');
      assert.ok(sv && !sv.hasAttribute('href') && sv.getAttribute('aria-disabled') === 'true','invalid snapshot language must not offer an old-LAST fallback');
    } finally {await h.unmount();}
  }
  for(const mutation of ['missing','transport','expired','wrong-ref','unknown']){
    const h=await mountPlanner({url:`http://localhost/anywhere?snapshot=${envelope.ref}&lang=en`,storage:{[LAST_KEY]:old}});
    try {
      const copy=structuredClone(envelope),call=h.fetchMock.calls[0];
      if(mutation==='expired') copy.expires_at='2026-10-24T00:00:00.000Z';
      if(mutation==='wrong-ref') copy.ref='f'.repeat(48);
      if(mutation==='unknown') copy.version=2;
      if(mutation==='transport') await h.act(()=>call.rejectResponse(new Error('offline')));
      else await h.fetchMock.respond(call,copy,mutation==='missing'?404:200);
      await h.clock.advance(6000);assert.equal(h.fetchMock.calls.length,1);assert.match(h.text(),/shared day is unavailable/i);
      assert.deepEqual(h.readStorage(LAST_KEY),old);assert.doesNotMatch(h.text(),/Saved day/);
    } finally {await h.unmount();}
  }
});

test('Share never reuses an initial reference after accepted replacement and says unavailable without it',async t=>{
  const {backend}=await actualEnvelope(t);
  const h=await mountPlanner({url:'http://localhost/anywhere?place=Roma&prefs=culture&lang=en'});
  try {
    await relay(h,backend.server,h.fetchMock.calls[0]);
    assert.ok(button(h,/^Share/),'actual ready sidecar offers Share');
    await click(h,button(h,/^Adjust/));await click(h,button(h,/^Relaxed/));await h.clock.advance(450);
    const call=h.fetchMock.calls.findLast(c=>c.url.startsWith('/api/route-recommendations'));
    const clientFetch=global.fetch;let wire;
    try {global.fetch=mockStableWeatherFetch();wire=await request(backend.server,call);}finally{global.fetch=clientFetch;}
    const later=JSON.parse(wire.text);assert.equal(later.day_snapshot.state,'ready');
    // Explicit mock boundary: an older/unsupported terminal publisher has no ref.
    delete later.day_snapshot;
    await h.fetchMock.respond(call,later);
    assert.ok(!button(h,/^Share/),'previous ref is not available for the later answer');
    assert.match(h.text(),/Exact sharing is unavailable/i);
    assert.ok(h.readStorage(LAST_KEY)?.safeResponse.days[0].primary_route,'displayed answer remains');
  }finally{await h.unmount();}
});

test('actual applied-shorter and intentional-empty publications restore their acknowledged edit atomically',async t=>{
  for(const empty of [false,true]){
    const retained=empty?[]:['piazza-vittorio','colosseum'];
    const {backend,envelope,original}=await actualEnvelope(t,{day_edit:{version:1,action:'remove',candidate_id:'mercato-monti',retained_candidate_ids:retained,target_stop_count:retained.length,slot_index:0,replacement_preference:null,removed_candidate_ids:['piazza-navona']},pinned_candidate_ids:empty?[]:['piazza-vittorio']});
    assert.equal(original.agnostic_route_output_experiment.day_edit.status,'applied');
    const h=await mountPlanner({url:`http://localhost/anywhere?snapshot=${envelope.ref}&lang=en`});
    try{
      await relay(h,backend.server,h.fetchMock.calls[0]);
      const restored=h.readStorage(LAST_KEY);assert.ok(restored);
      const bad=structuredClone(envelope);bad.result.agnostic_route_output_experiment.day_edit.candidate_id='different-command';
      assert.equal(parsePublishedDay(bad,{ref:envelope.ref,decision:h.window.AnywhereRenderDecision}),null,'mock corruption: applied verdict must bind the acknowledged edit identity');
      assert.deepEqual(ids(restored),retained);assert.deepEqual(restored.inputs.dayEdit,envelope.intent.dayEdit);
      assert.equal(restored.classification.status,empty?'edited_empty':restored.classification.status);
      assert.equal(restored.dateIso,envelope.intent.dateIso);
      const ledger=readCommitmentSnapshot(restored.commitments,{anchorKey:anchorKey(restored.inputs),dayKey:restored.id});
      assert.equal(ledger.applies,true);assert.deepEqual(Object.keys(ledger.entries),[...envelope.intent.pinnedCandidateIds,...envelope.intent.excludedCandidateIds]);
      await h.clock.advance(6000);assert.equal(h.fetchMock.calls.length,1,'restoration never replays a one-shot edit');
      assert.match(h.text(),/Saved day/);
      const copied=[];
      Object.defineProperty(h.window.navigator,'clipboard',{value:{writeText:async value=>copied.push(value)}});
      await click(h,button(h,/^Share/));
      assert.deepEqual(copied,[`http://localhost/anywhere?snapshot=${envelope.ref}&lang=en`]);
      await click(h,button(h,/rebuild for fresh events/i));
      const rebuild=h.fetchMock.calls.find(c=>c.url.startsWith('/api/route-recommendations'));
      assert.ok(rebuild);assert.deepEqual(rebuild.body.dates,[envelope.intent.dateIso]);
      assert.equal(rebuild.body.place_ref,envelope.intent.placeRef);
      assert.deepEqual(rebuild.body.day_edit,envelope.intent.dayEdit,'explicit rebuild preserves applied extent, not a replacement command');
    }finally{await h.unmount();}
  }
});

test('deferred public bodies cannot install or announce after navigation or a newer restored entry',async t=>{
  const {envelope}=await actualEnvelope(t);
  const initial=await mountPlanner({url:`http://localhost/anywhere?snapshot=${envelope.ref}&lang=en`});
  let saved;
  try {await initial.fetchMock.respond(initial.fetchMock.calls[0],envelope);saved=initial.readStorage(LAST_KEY);}finally{await initial.unmount();}
  for(const transition of ['home','saved']){
    for(const success of [true,false]){
      const old={...saved,label:'Other remembered day'};
      const h=await mountPlanner({url:`http://localhost/anywhere?snapshot=${envelope.ref}&lang=en`,storage:{[LAST_KEY]:old,'parranda:anywhere:saved':[old]}});
      try{
        const call=h.fetchMock.calls[0];
        let release;
        await h.act(()=>call.resolveResponse({ok:true,json:()=>new Promise((resolve,reject)=>{release=()=>success?resolve(envelope):reject(new Error('late body failure'));})}));
        if(transition==='home'){
          h.document.addEventListener('click',e=>e.preventDefault());
          await click(h,h.container.querySelector('a[href="/?lang=en"]'));
        }else await click(h,button(h,/Other remembered day/));
        const before={text:h.text(),url:h.window.location.href,last:h.readStorage(LAST_KEY)};
        await h.act(()=>release());await h.clock.advance(6000);
        assert.equal(h.text(),before.text,'late success/failure cannot replace current copy');assert.equal(h.window.location.href,before.url);assert.deepEqual(h.readStorage(LAST_KEY),before.last);
        assert.equal(h.fetchMock.calls.length,1);assert.equal(call.aborted,true);
      }finally{await h.unmount();}
    }
  }
});

test('mock unsupported Live revision withdraws sharing; a later real original owns its new reference',async t=>{
  const {backend,original}=await actualEnvelope(t);
  const h=await mountPlanner({url:'http://localhost/anywhere?place=Roma&prefs=culture&lang=en'});
  try{
    // Explicit negative transport control: attach an unsupported pending Live
    // generation to a real original body. This is NOT backend revision evidence.
    const pending=structuredClone(original);
    pending.live_events={coverage:'covered',pending:true,tonight:[],this_week:[]};
    pending.live_completion={version:1,token:'negative-live-capability',expires_in_ms:120000,route_upgrade:'not_supported'};
    await h.fetchMock.respond(h.fetchMock.calls[0],pending);
    assert.ok(!button(h,/^Share/),'a pending Live generation cannot share a ready-looking initial ref');
    await h.clock.advance(2000);
    const completion=h.fetchMock.calls.find(c=>c.url==='/api/planner-live-completion');assert.ok(completion);
    const wire=JSON.parse(await readFile(new URL('./fixtures/live-wire-81d2ad7.json',import.meta.url),'utf8')).fixtures.completion_ready.body;
    const terminal=structuredClone(wire);terminal.live_completion.route_upgrade='not_supported';
    await h.fetchMock.respond(completion,terminal);
    assert.ok(!button(h,/^Share/),'no backend revision ref, no terminal Live Share');
    await click(h,button(h,/^Adjust/));await click(h,button(h,/^Relaxed/));await h.clock.advance(450);
    const request=h.fetchMock.calls.findLast(c=>c.url.startsWith('/api/route-recommendations'));
    const later=await relay(h,backend.server,request);
    assert.equal(later.day_snapshot.state,'ready');
    assert.ok(button(h,/^Share/),'a newer original must not inherit an older completion suppression');
  }finally{await h.unmount();}
});

test('interrupted public read returns from bfcache as unavailable, not an inert source-rebuild action',async t=>{
  const {envelope}=await actualEnvelope(t);
  const h=await mountPlanner({url:`http://localhost/anywhere?snapshot=${envelope.ref}&lang=en`});
  try{
    await h.act(()=>h.window.dispatchEvent(new h.window.Event('pagehide')));
    const event=new h.window.Event('pageshow');Object.defineProperty(event,'persisted',{value:true});
    await h.act(()=>h.window.dispatchEvent(event));
    assert.match(h.text(),/shared day is unavailable/i);
    assert.ok(!button(h,/Continue planning/),'there is no acquisition request to resume');
    assert.equal(h.fetchMock.calls.length,1);
  }finally{await h.unmount();}
});

test('Share rechecks expiry at the actual click and refuses truthfully without acquisition',async t=>{
  const {backend}=await actualEnvelope(t);
  const h=await mountPlanner({url:'http://localhost/anywhere?place=Roma&prefs=culture&lang=en'});
  try{
    const original=await relay(h,backend.server,h.fetchMock.calls[0]);
    const share=button(h,/^Share/);assert.ok(share);
    const copied=[];Object.defineProperty(h.window.navigator,'clipboard',{value:{writeText:async s=>copied.push(s)}});
    t.mock.timers.enable({apis:['Date'],now:Date.parse(original.day_snapshot.expires_at)});
    await click(h,share);
    assert.deepEqual(copied,[]);assert.equal(h.fetchMock.calls.length,1);
    assert.match(h.text(),/Exact sharing is unavailable/i);
  }finally{await h.unmount();}
});

test('expired Share on a real intentional-empty publication explains unavailability without replacing the day',async t=>{
  const {backend,envelope}=await actualEnvelope(t,{day_edit:{version:1,action:'remove',
    candidate_id:'mercato-monti',retained_candidate_ids:[],target_stop_count:0,slot_index:0,
    replacement_preference:null,removed_candidate_ids:['piazza-navona']}});
  const href=`http://localhost/anywhere?snapshot=${envelope.ref}&lang=en`;
  const h=await mountPlanner({url:href});
  try{
    await relay(h,backend.server,h.fetchMock.calls[0]);
    const before=h.readStorage(LAST_KEY);
    assert.equal(before.classification.status,'edited_empty','actual server-accepted zero publication');
    assert.equal(before.safeResponse.days[0].primary_route,null);
    assert.match(h.text(),/Your day is empty/);
    assert.match(h.text(),/Saved day/);
    const share=button(h,/^Share/);assert.ok(share,'the unexpired stored publication offers Share');
    const copied=[];
    Object.defineProperty(h.window.navigator,'clipboard',{value:{writeText:async value=>copied.push(value)}});
    t.mock.timers.enable({apis:['Date'],now:Date.parse(envelope.expires_at)});
    await click(h,share);
    assert.deepEqual(copied,[],'an expired reference is never copied');
    assert.ok(!button(h,/^Share/));
    assert.equal(h.fetchMock.calls.length,1,'only the original recipient GET, no fallback or acquisition');
    assert.deepEqual(h.readStorage(LAST_KEY),before,'expiry cannot replace or refill the accepted empty answer');
    assert.equal(h.window.location.href,href);
    assert.match(h.text(),/Your day is empty/);
    assert.match(h.text(),/Exact sharing is unavailable/i,'empty answers need the same truthful refusal copy');
  }finally{await h.unmount();}
});
