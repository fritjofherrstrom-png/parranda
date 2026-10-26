'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const { buildApp } = require('../server/app');
const { externalRecord, makeLoader, requestJson, mockStableWeatherFetch } = require('./helpers/planner-reservoir-compare');
const { classifyAnywhereResult } = require('../anywhere-render-decision');
const { projectPublishedDay } = require('../server/planner/published-day-projection');
const DATE = '2026-05-25';
function captureEvidence(name,published,projected,capturedIntent,evidence) {
  const directory=process.env.PARRANDA_PROJECTOR_EVIDENCE_DIR;
  if (!directory) return;
  assert.equal(published.live_completion,undefined,'no bearer in offline evidence');
  assert.equal(published.agnostic_route_output_experiment.intake.resolved.selection_id == null,true,'no selection receipt in offline evidence');
  const policy={};
  for(const key of ['explicitCoordinatesPresent','customEndpointPresent','biasPresent','contextSelectionPresent','selectionPresent','requestedPlaceRefPresent']) policy[key]=evidence[key];
  policy.publicSourceUrls=[...evidence.publicSourceUrls];
  require('node:fs').writeFileSync(require('node:path').join(directory,name+'.json'),JSON.stringify({
    evidence_kind:'OFFLINE_CONTROLLED_SOURCE_PUBLISHER; URL SET IS A PRIVATE POLICY FIXTURE, NOT REAL-SOURCE SHARE APPROVAL',
    input:{published,intent:capturedIntent,privacy:policy,language:projected.language},projection:projected},null,2)+'\n');
}
const privacy = () => ({ explicitCoordinatesPresent: false, customEndpointPresent: false,
  biasPresent: false, contextSelectionPresent: false, selectionPresent: false,
  requestedPlaceRefPresent: false, publicSourceUrls: new Set(records().flatMap(row => row.sources.map(source => source.url))) });
const intent = () => ({ dateIso: DATE, preferences: ['food', 'fika', 'views'],
  preferencePriority: [], dayRhythm: 'balanced', excludedCandidateIds: [], pinnedCandidateIds: [], liveEventChoices: [], dayEdit: null });
function records() {
  return [['food','restaurant',['mat']],['cafe','cafe',['fika']],['view','viewpoint',['utsikt']]]
    .flatMap(([prefix,type,tags]) => Array.from({length: 11}, (_, i) => externalRecord(`${prefix}-${i}`,
      `${prefix} ${i}`, type, 41.9 + (i % 5) * .0008, 12.49 + Math.floor(i / 5) * .0008, tags)));
}
// OFFLINE real HTTP publisher with controlled source/resolver/weather seams.
// This is not a real-source URL sharing approval or a deployed-runtime test.
async function publication(extra = {}, options = {}) {
  const originalFetch = global.fetch;
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader: makeLoader(records()),
    placeResolver: async () => [{label: 'Northport, Testland', lat: 41.9, lng: 12.49,
      confidence: 'high', provenance: 'offline_fixture', timezone: 'Europe/Rome',
      osm_class: 'place', osm_ref: 'relation/123456'}],
    placeSuggestions: null, reviewedPlaceSource: null, sourceCatalog: null, eventSupply: null,
    placeSelectionStore: { issue: () => null }, publishedDayStore: { read: async () => null },
    clock: () => new Date(`${DATE}T10:00:00Z`), ...options });
  const listener = server.listen(0, '127.0.0.1');
  try {
    await once(listener, 'listening');
    const response = await requestJson(listener, { path: '/api/route-recommendations?lang=en&experimental_agnostic_route_output=1&agnostic_engine_compose=1',
      body: {place: 'Northport', dates: [DATE], preferences: ['food','fika','views'], day_rhythm: 'balanced',
        include_external_candidates: 1, ...extra} });
    assert.equal(response.status, 200, 'offline publisher precondition');
    return response.body;
  } finally {
    await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    global.fetch = originalFetch;
  }
}
test('projects a real final promoted typed publication, not its diagnostic trial', async () => {
  const published = await publication();
  assert.equal(published.agnostic_route_output_experiment.promotion.promote, true);
  assert.equal(published.agnostic_route_output_experiment.intake.resolved.place_ref, 'r123456');
  const projected = projectPublishedDay({published, intent: intent(), privacy: privacy(), language: 'en'});
  if (!projected) assert.doesNotThrow(() => require('../server/planner/published-day-fields').budget(privacy()).copy('Result', published), 'source-derived field diagnosis');
  assert.ok(projected, 'a valid authoritative final publication must project');
  assert.deepEqual(projected.result.days[0].primary_route.main_stops.map(s => s.id), published.days[0].primary_route.main_stops.map(s => s.id));
  assert.deepEqual(projected.result.days[0].primary_route.map_path_points, published.days[0].primary_route.map_path_points);
  assert.equal(classifyAnywhereResult(projected.result).status, classifyAnywhereResult(published).status);
  assert.equal(projected.intent.place, 'Northport, Testland');
  assert.equal(projected.intent.placeRef, 'r123456');
  assert.equal(projected.result.agnostic_route_output_experiment.experimental_route, undefined);
  captureEvidence('ordinary',published,projected,intent(),privacy());
});

for (const [field, limit] of [['resolved label', 500], ['stop id', 200], ['stop label', 500]]) {
  test(`portable identity boundaries round-trip through the actual recipient: ${field}`, async () => {
    const original = await publication();
    const { parsePublishedDay } = await import('../frontend/src/lib/published-day.mjs');
    const decision = require('../anywhere-render-decision');
    const now = Date.parse(`${DATE}T10:00:00Z`), ref = 'a'.repeat(48);
    const changes = [
      ['boundary', 'x'.repeat(limit), true],
      ['oversized', 'x'.repeat(limit + 1), false],
      ['leading whitespace', ' leading', false],
      ['trailing whitespace', 'trailing ', false],
      ['embedded control', 'a\u001fb', false],
      ['DEL', 'a\u007fb', false],
      ['empty', '', false],
    ];
    for (const [name, value, portable] of changes) {
      const published = structuredClone(original);
      if (field === 'resolved label') published.agnostic_route_output_experiment.intake.resolved.label = value;
      else if (field === 'stop id') published.days[0].primary_route.main_stops[0].id = value;
      else {
        const route = published.days[0].primary_route, old = route.main_stops[0].label;
        route.main_stops[0].label = value;
        for (const point of route.map_route_points) if (point.label === old) point.label = value;
      }
      const projected = projectPublishedDay({ published, intent: intent(), privacy: privacy(), language: 'en' });
      assert.equal(Boolean(projected), portable, `${field}: ${name} must be admitted or refused before storage`);
      if (!projected) continue;
      const snapshot = { version: 1, ref, created_at: new Date(now).toISOString(),
        expires_at: new Date(now + 60000).toISOString(), ...projected };
      assert.ok(parsePublishedDay(snapshot, { ref, decision, now }), `${field}: ${name} must hydrate without normalization`);
      const actual = field === 'resolved label' ? projected.intent.place
        : projected.result.days[0].primary_route.main_stops[0][field === 'stop id' ? 'id' : 'label'];
      assert.equal(actual, value, `${field}: the authoritative value is unchanged`);
    }
  });
}

test('authority requires the entire final publication conjunction and exact absolute day', async () => {
  const original = await publication();
  const cases = [
    ['promotion', p => { p.agnostic_route_output_experiment.promotion.promote = false; }],
    ['mutation', p => { p.agnostic_route_output_experiment.route_mutation = false; }],
    ['eligibility', p => { p.agnostic_route_output_experiment.eligibility.eligible = false; }],
    ['confidence', p => { p.agnostic_route_output_experiment.intake.resolved.confidence = 'low'; }],
    ['day marker', p => { delete p.days[0].experimental_agnostic_day; delete p.days[0].experimental_agnostic_route_applied; delete p.days[0].source; }],
    ['absolute date', p => { p.days[0].date = '2026-05-26'; }],
    ['ordinary empty', p => { p.days[0].primary_route = null; }],
    ['manual marker', p => { p.days[0].manual_empty_day = true; }],
    ['trial only', p => { delete p.days; }],
    ['legacy', p => { p.agnostic_route_output_experiment.synthesized_via = 'legacy'; }],
    ['classless', p => { delete p.agnostic_route_output_experiment.intake.resolved.place_ref; }],
    ['malformed ref', p => { p.agnostic_route_output_experiment.intake.resolved.place_ref = 'r01'; }],
    ['multiple days', p => { p.days.push(structuredClone(p.days[0])); }],
  ];
  for (const [name, change] of cases) {
    const published = structuredClone(original); change(published);
    assert.equal(projectPublishedDay({published,intent:intent(),privacy:privacy(),language:'en'}), null, name);
  }
  for (const key of ['explicitCoordinatesPresent','customEndpointPresent','biasPresent','contextSelectionPresent','selectionPresent','requestedPlaceRefPresent']) {
    for (const invalid of [undefined,null,0,'false']) {
      const evidence = privacy(); if (invalid === undefined) delete evidence[key]; else evidence[key] = invalid;
      assert.equal(projectPublishedDay({published:original,intent:intent(),privacy:evidence,language:'en'}),null,key+': strict own boolean');
    }
    const inherited = Object.assign(Object.create({[key]:false}),privacy()); delete inherited[key];
    assert.equal(projectPublishedDay({published:original,intent:intent(),privacy:inherited,language:'en'}),null,key+': own property');
  }
  for (const key of ['explicitCoordinatesPresent','customEndpointPresent','biasPresent','contextSelectionPresent']) {
    assert.equal(projectPublishedDay({published:original,intent:intent(),privacy:{...privacy(),[key]:true},language:'en'}),null,key);
  }
  assert.ok(projectPublishedDay({published:original,intent:intent(),privacy:{...privacy(),selectionPresent:true,requestedPlaceRefPresent:true},language:'sv'}));
  for (const language of [null,'de',undefined]) assert.equal(projectPublishedDay({published:original,intent:intent(),privacy:privacy(),language}),null);
});

test('preserves the real candidate context and detours with closed hours and eligibility', async () => {
  const published = await publication();
  assert.ok(published.place_structure?.district_day?.areas?.length, 'actual source context exists');
  const { normalizeSelectedDayHoursFact } = require('../server/place-candidates/opening-hours');
  const { buildRouteContextSuggestions } = require('../frontend/src/lib/route-context-view.mjs');
  const areas = published.place_structure.district_day.areas;
  const candidate = areas[0].stops[0];
  candidate.chain = true; candidate.local_feel_rank = 2; candidate.commitment_eligible = false;
  candidate.selected_day_hours = normalizeSelectedDayHoursFact({status:'unknown',all_day:false,windows:[],ordinary_status:'known',
    ordinary_windows:[{opens:'09:00',closes:'24:00'}],uncertainty:'holiday_exceptions',date:DATE,timezone:'Europe/Rome',
    source_url:'https://sources.example/hours?edition=1#original',observed_at:'2026-05-20T10:00:00.000Z'});
  assert.ok(candidate.selected_day_hours);
  const evidence = privacy(); evidence.publicSourceUrls.add(candidate.selected_day_hours.source_url);
  const projected = projectPublishedDay({published,intent:intent(),privacy:evidence,language:'en'});
  assert.ok(projected);
  assert.ok(projected.result.place_structure, 'candidate context must survive');
  assert.equal(projected.result.place_structure.area_count,published.place_structure.area_count);
  const copied = projected.result.place_structure.district_day.areas;
  const factKeys = ['id','place_id','candidate_id','name','lat','lng','type','chain','local_feel_rank','commitment_eligible','selected_day_hours','address','area'];
  const facts = value => Object.fromEntries(factKeys.filter(k => Object.hasOwn(value,k)).map(k => [k,value[k]]));
  assert.deepEqual(copied.map(a => a.stops.map(facts)),areas.map(a => a.stops.map(facts)));
  assert.deepEqual(buildRouteContextSuggestions(projected.result.days[0].primary_route.main_stops,copied).map(s => s.id),
    buildRouteContextSuggestions(published.days[0].primary_route.main_stops,areas).map(s => s.id));
  const cycle = {}; cycle.raw = cycle;
  candidate.private_transport = cycle;
  candidate.selected_day_hours.windows.private_transport = cycle;
  Object.defineProperty(candidate.selected_day_hours,'private_token',{get() { throw Error('must not traverse'); }});
  const closed = projectPublishedDay({published,intent:intent(),privacy:evidence,language:'en'});
  assert.ok(closed); assert.equal(JSON.stringify(closed).includes('private_transport'),false);
  assert.equal(closed.result.place_structure.district_day.areas[0].stops[0].commitment_eligible,false);
});

const LIVE_URL = 'https://sources.example/program?edition=1#programme';
function offlineLive() {
  const { toEventView, rankCollectedEventsForPreferences } = require('../server/place-candidates/agnostic-event-supply');
  const feed = {id:'offline-calendar',label:'Offline calendar',license:'CC-BY',timezone:'Europe/Rome'};
  const row = (id, title, minute, extra = {}) => toEventView({id,title,starts_at:`${DATE}T18:${String(minute).padStart(2,'0')}:00Z`,
    ends_at:`${DATE}T22:00:00Z`,place_context:'Public hall',source_url:LIVE_URL,lat:41.9,lng:12.49,
    tags:['concert','culture'],confidence:'medium',sources:[{identity:'calendar:offline',provider_id:'secondary',occurrence_id:id,
      family:'municipal_open',type:'calendar',label:'Secondary calendar',url:LIVE_URL,tier:'official',confidence:'medium',attribution:'City',license:'CC-BY'}],
    ...extra},feed,{routeEligible:false});
  const rows = [
    ...Array.from({length:9},(_,i)=>row(`programme-${i}`,'Festival programme',i)),
    ...Array.from({length:8},(_,i)=>row(`series-${i}`,'Source series',i,{source_series_id:'declared-series',source_occurrence_id:`slot-${i}`})),
    ...Array.from({length:8},(_,i)=>row(`other-${i}`,`Different concert ${i}`,i)),
    row('holiday','Half-day holiday',0,{calendar_fact:{kind:'public_holiday',scope:'national',country_code:'xx',area:'Testland',temporal_scope:'half_day',flags:['Provisional']}}),
    row('uncertain','Unconfirmed recurrence',1,{recurrence:{rule:'FREQ=WEEKLY',occurrence_status:'unconfirmed'},
      time_window:{kind:'period',starts_on:DATE,ends_on:'2026-05-30',all_day_explicit:false}}),
  ];
  const health = {status:'partial',result:'events_found',reasons:['source_failed'],selected_source_count:2,responding_source_count:1,
    event_bearing_source_count:1,empty_source_count:0,failed_source_count:1,unavailable_source_count:0,
    raw_event_count:rows.length+2,normalized_event_count:rows.length+1,out_of_period_event_count:0,
    accepted_event_count:rows.length,surfaced_event_count:0,rejected_event_count:1};
  return rankCollectedEventsForPreferences({selected_date:DATE,coverage:'covered',feed:{...feed,status:'ok',
      source_profile:{reviewed_at:'2026-01-01T00:00:00Z',qualified_at:'2026-01-02T00:00:00Z',expires_at:'2027-01-01T00:00:00Z'}},feeds:[feed],
    acquisition:{source_health:health,rejection_summary:[{reason:'invalid_geometry',count:1}],
      discovery_health:{contract:'source_discovery_health_v1',status:'search_failed',reasons:['provider_failed'],observed_at:'2026-05-20T12:00:00Z',
        search:{status:'failed',queried_count:2,responding_query_count:0,failed_query_count:2,degraded_query_count:0,result_count:0,seed_count:0,retry_recommended:true},
        scout:{status:'not_run',inspected_source_count:0,blocked_source_count:0,failed_source_count:0},
        qualification:{status:'not_run',candidate_count:0,qualified_candidate_count:0}}},
    tonight:rows,this_week:[]},['culture']);
}
function plantPrivate(value,seen=new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))
    if (Object.hasOwn(descriptor,'value')) plantPrivate(descriptor.value,seen);
  Object.defineProperty(value,'private_transport',{get() { throw Error('private graph traversed'); },enumerable:true});
}
test('closed Live projection retains full programmes, declared series, browse, source identities and original health', async () => {
  const live = offlineLive();
  const published = await publication({}, {eventSupply:async()=>live});
  const evidence = privacy(); evidence.publicSourceUrls.add(LIVE_URL);
  assert.ok(published.live_events.tonight.some(e => e.occurrences?.length > 6));
  assert.ok(published.live_events.browse.tonight.more.length);
  const projected = projectPublishedDay({published,intent:intent(),privacy:evidence,language:'en'});
  assert.ok(projected?.result.live_events,'the complete published Live panel must survive');
  captureEvidence('full-live',published,projected,intent(),evidence);
  const copied = projected.result.live_events;
  assert.deepEqual(copied.acquisition,published.live_events.acquisition);
  const allRows = l => [...l.tonight,...l.this_week,...l.browse.tonight.more,...l.browse.this_week.more];
  const identity = e => ({id:e.id,source_provider_id:e.source_provider_id,source_series_id:e.source_series_id,source_occurrence_id:e.source_occurrence_id,
    starts_at:e.starts_at,time_window:e.time_window,recurrence:e.recurrence,calendar_fact:e.calendar_fact,sources:e.sources,
    occurrences:e.occurrences?.map(identity)});
  assert.deepEqual(allRows(copied).map(identity),allRows(published.live_events).map(identity));
  assert.equal(copied.browse.tonight.more_count,published.live_events.browse.tonight.more_count);
  assert.deepEqual(copied.feed.source_profile,published.live_events.feed.source_profile);
  plantPrivate(published.live_events);
  assert.deepEqual(projectPublishedDay({published,intent:intent(),privacy:evidence,language:'en'}),projected,'unknown properties at every Live object depth are not read');
});

test('acknowledges only normalized exact preferences, priority, rhythm and bounded input intent', async () => {
  const published = await publication();
  const invalid = [
    {preferences:['food','legacy-coffee']}, {preferences:['food','food']}, {preferencePriority:['green']},
    {preferencePriority:['food','food']}, {dayRhythm:'long'}, {dateIso:'2026-02-31'},
    {pinnedCandidateIds:['not an id']}, {excludedCandidateIds:['  changed  ']}, {liveEventChoices:[{occurrence_id:'live:bogus',action:'keep'}]},
  ];
  for (const change of invalid) assert.equal(projectPublishedDay({published,intent:{...intent(),...change},privacy:privacy(),language:'en'})===null,true,JSON.stringify(change));
  for (const dayRhythm of ['calm','balanced','full','free']) {
    const inputs = {...intent(),dayRhythm,preferencePriority:['views','food']};
    const projected = projectPublishedDay({published,intent:inputs,privacy:privacy(),language:'sv'});
    assert.ok(projected); assert.deepEqual(projected.intent.selected,inputs.preferences);
    assert.deepEqual(projected.intent.preferencePriority,['views','food']); assert.equal(projected.intent.walkKey,dayRhythm);
    inputs.preferences.reverse(); inputs.preferencePriority.reverse();
    assert.deepEqual(projected.intent.selected,['food','fika','views']); assert.deepEqual(projected.intent.preferencePriority,['views','food']);
  }
  const neutral = projectPublishedDay({published,intent:intent(),privacy:privacy(),language:'en'});
  assert.equal(Object.hasOwn(neutral.intent,'preferencePriority'),false);
  const oversized = {...intent(),preferences:new Array(1000000).fill('food')};
  assert.equal(projectPublishedDay({published,intent:oversized,privacy:privacy(),language:'en'}),null);
});

test('applied replace becomes durable remove over ALL final ordered IDs, never a replay', async () => {
  const { normalizeDayEdit } = require('../shared/planner-intent.mjs');
  const initial = await publication();
  const ids = initial.days[0].primary_route.main_stops.map(s=>s.id);
  const command = normalizeDayEdit({version:1,action:'replace',candidate_id:ids[0],retained_candidate_ids:ids.slice(1),
    target_stop_count:ids.length,slot_index:0,replacement_preference:'views',removed_candidate_ids:['previously-removed'],preserve_retained:false});
  assert.ok(command);
  const published = await publication({day_edit:command});
  assert.equal(published.agnostic_route_output_experiment.day_edit.status,'applied','actual publisher applied the command');
  const finalIds = published.days[0].primary_route.main_stops.map(s=>s.id);
  const inputs = {...intent(),dayEdit:command,excludedCandidateIds:[command.candidate_id,...command.removed_candidate_ids]};
  const projected = projectPublishedDay({published,intent:inputs,privacy:privacy(),language:'en'});
  assert.ok(projected);
  assert.deepEqual(projected.intent.dayEdit,normalizeDayEdit({...command,action:'remove',retained_candidate_ids:finalIds,
    target_stop_count:finalIds.length,replacement_preference:null}));
  assert.deepEqual(projected.result.agnostic_route_output_experiment.day_edit,published.agnostic_route_output_experiment.day_edit);
  assert.equal(projected.intent.dayEdit.action,'remove');
  assert.deepEqual(projected.intent.dayEdit.retained_candidate_ids,finalIds);
  assert.equal(projected.intent.dayEdit.preserve_retained,false);
  captureEvidence('applied-replace',published,projected,inputs,privacy());
  const mismatched = structuredClone(published); mismatched.agnostic_route_output_experiment.day_edit.result_candidate_ids.reverse();
  assert.equal(projectPublishedDay({published:mismatched,intent:inputs,privacy:privacy(),language:'en'})===null,true,'correlated final ID order');
});

function keepLive() {
  const { toEventView } = require('../server/place-candidates/agnostic-event-supply');
  const event = toEventView({id:'offline-kept-concert',title:'Public evening concert',source_url:LIVE_URL,
    starts_at:`${DATE}T18:00:00Z`,ends_at:`${DATE}T22:00:00Z`,lat:41.9005,lng:12.4905,
    place_context:'Public hall',tags:['concert','music','culture'],confidence:'high'},
    {id:'offline-calendar',label:'Offline calendar',license:'CC-BY',timezone:'Europe/Rome'},{routeEligible:true});
  const id = require('../server/planner/live-occurrence-choice').liveOccurrenceId(event);
  assert.ok(id);
  const { rankCollectedEventsForPreferences } = require('../server/place-candidates/agnostic-event-supply');
  return {id,live:rankCollectedEventsForPreferences({selected_date:DATE,coverage:'covered',feed:{label:'Offline calendar'},tonight:[event],this_week:[],
    acquisition:{source_health:{status:'healthy',result:'events_found',selected_source_count:1,responding_source_count:1,
      event_bearing_source_count:1,raw_event_count:1,normalized_event_count:1,accepted_event_count:1}}},['culture'])};
}
function liveId(date, digit) { return `live:${date}:${digit.repeat(32)}`; }
function snapshotOf(projected) {
  const { anchorKey } = require('../frontend/src/lib/recompose-retention.mjs');
  const { savedEntryId } = require('../frontend/src/lib/anywhere-storage.mjs');
  const { buildCommitmentSnapshot } = require('../frontend/src/lib/commitment-snapshot.mjs');
  const input = projected.intent, entries = {};
  for (const id of input.pinnedCandidateIds) entries[id]={kind:'pin',label:''};
  for (const id of input.excludedCandidateIds) entries[id]={kind:'exclude',label:''};
  for (const choice of input.liveEventChoices.filter(c=>c.occurrence_id.slice(5,15)===input.dateIso))
    entries[choice.occurrence_id]=choice.action==='keep'?{kind:'pin',label:''}:{kind:'exclude',label:'',liveAction:choice.action};
  const exp = projected.result.agnostic_route_output_experiment;
  const pinIds = Object.keys(entries).filter(id=>entries[id].kind==='pin');
  return buildCommitmentSnapshot({anchorKey:anchorKey({place:input.place,selectionLabel:input.placeLabel}),dayKey:savedEntryId(input),entries,
    appliedPins:pinIds.map(id=>({id,kind:'pin',label:''})),refusals:[...(exp.pinned_candidates?.unhonored||[]),...(exp.live_event_choices?.unhonored||[])]});
}
test('preserves actual stable and dated Live verdicts and refuses aggregate ledger loss', async () => {
  const kept = keepLive();
  const choices = [{occurrence_id:kept.id,action:'keep'},{occurrence_id:liveId(DATE,'b'),action:'replace'},
    {occurrence_id:liveId(DATE,'c'),action:'replace'},{occurrence_id:liveId('2026-05-26','d'),action:'keep'}];
  const pins = ['pincio-terrace'];
  const published = await publication({pinned_candidate_ids:pins,live_event_choices:choices},{eventSupply:async()=>kept.live});
  const inputs = {...intent(),pinnedCandidateIds:pins,liveEventChoices:choices,excludedCandidateIds:['excluded-place']};
  assert.equal(published.agnostic_route_output_experiment.promotion.promote,true,JSON.stringify({promotion:published.agnostic_route_output_experiment.promotion,eligibility:published.agnostic_route_output_experiment.eligibility}));
  const evidence = privacy(); evidence.publicSourceUrls.add(LIVE_URL);
  const projected = projectPublishedDay({published,intent:inputs,privacy:evidence,language:'en'});
  assert.ok(projected);
  assert.deepEqual(projected.result.agnostic_route_output_experiment.pinned_candidates,published.agnostic_route_output_experiment.pinned_candidates,'source stable verdict');
  assert.deepEqual(projected.result.agnostic_route_output_experiment.live_event_choices,published.agnostic_route_output_experiment.live_event_choices,'source Live verdict');
  assert.deepEqual(projected.intent.liveEventChoices,choices,'acknowledged other-day choices retained separately');
  const snapshot = snapshotOf(projected);
  assert.equal(Object.hasOwn(snapshot.entries,choices[3].occurrence_id),false,'other-date not active');
  assert.equal(snapshot.entries[choices[1].occurrence_id].liveAction,'replace');
  assert.equal(snapshot.entries[choices[2].occurrence_id].liveAction,'replace');
  assert.equal(snapshot.appliedPins.length,2,'answered, not only honored pins');
  assert.deepEqual(snapshot.refusals,published.agnostic_route_output_experiment.pinned_candidates.unhonored.concat(published.agnostic_route_output_experiment.live_event_choices.unhonored));
  const { readCommitmentSnapshot } = require('../frontend/src/lib/commitment-snapshot.mjs');
  const { savedEntryId } = require('../frontend/src/lib/anywhere-storage.mjs');
  assert.equal(readCommitmentSnapshot(JSON.parse(JSON.stringify(snapshot)),snapshot).applies,true);
  for (const difference of [{dateIso:'2026-05-26'},{preferencePriority:['views']},{walkKey:'calm'}])
    assert.equal(readCommitmentSnapshot(snapshot,{anchorKey:snapshot.anchorKey,dayKey:savedEntryId({...projected.intent,...difference})}).applies,false);
  const overflowPins = {...inputs,pinnedCandidateIds:Array.from({length:12},(_,i)=>`pin-${i}`)};
  assert.equal(projectPublishedDay({published,intent:overflowPins,privacy:evidence,language:'en'})===null,true,'stable+Live >12 refuses, never truncates');
  const overflowExclusions = {...inputs,excludedCandidateIds:Array.from({length:40},(_,i)=>`exclude-${i}`)};
  assert.equal(projectPublishedDay({published,intent:overflowExclusions,privacy:evidence,language:'en'})===null,true,'stable+Live >40 refuses');
  assert.equal(projectPublishedDay({published,intent:{...inputs,excludedCandidateIds:pins},privacy:evidence,language:'en'})===null,true,'pin/exclude conflict');
  for (const alter of [e=>e.pinned_candidates.requested_count++,e=>e.pinned_candidates.unhonored=[{id:'unrelated',reason:'unknown_candidate'}],e=>e.live_event_choices.ignored_other_day_count++,e=>e.live_event_choices.unhonored=[{id:liveId(DATE,'e'),reason:'event_not_available_or_eligible'}]]) {
    const changed=structuredClone(published); alter(changed.agnostic_route_output_experiment);
    assert.equal(projectPublishedDay({published:changed,intent:inputs,privacy:evidence,language:'en'})===null,true,'verdict/list/count correlation');
  }
});

test('accepts ONLY the complete real remove-zero publication and rejects each broken marker', async () => {
  const { normalizeDayEdit } = require('../shared/planner-intent.mjs');
  const { buildSavedEntry,isEditedEmptyEntry } = require('../frontend/src/lib/anywhere-storage.mjs');
  const command = normalizeDayEdit({version:1,action:'remove',candidate_id:'food-0',retained_candidate_ids:[],target_stop_count:0,
    slot_index:0,replacement_preference:null,removed_candidate_ids:['older-removal'],preserve_retained:false});
  const published = await publication({day_edit:command});
  assert.equal(classifyAnywhereResult(published).status,'edited_empty','actual publisher accepted empty');
  const inputs = {...intent(),dayEdit:command,excludedCandidateIds:['food-0','older-removal']};
  const projected = projectPublishedDay({published,intent:inputs,privacy:privacy(),language:'en'});
  assert.ok(projected,'deliberate zero is not ordinary source emptiness');
  const entry=buildSavedEntry({place:projected.intent.place,dateIso:DATE,inputs:projected.intent,safeResponse:projected.result,classification:classifyAnywhereResult(projected.result)});
  assert.equal(isEditedEmptyEntry(entry),true);
  captureEvidence('accepted-empty',published,projected,inputs,privacy());
  assert.equal(projected.result.days[0].primary_route,null);
  assert.deepEqual(projected.intent.dayEdit.retained_candidate_ids,[]);
  const changes=[
    p=>p.days[0].manual_empty_day=false,p=>p.days[0].primary_route={},p=>p.days[0].date='2026-05-26',
    p=>p.agnostic_route_output_experiment.manual_edit_published=false,
    p=>p.agnostic_route_output_experiment.promotion.promote=true,
    p=>p.agnostic_route_output_experiment.route_mutation=false,
    p=>p.agnostic_route_output_experiment.eligibility.eligible=false,
    p=>p.agnostic_route_output_experiment.day_edit.version=2,
    p=>p.agnostic_route_output_experiment.day_edit.action='replace',
    p=>p.agnostic_route_output_experiment.day_edit.status='refused',
    p=>p.agnostic_route_output_experiment.day_edit.target_stop_count=1,
    p=>p.agnostic_route_output_experiment.day_edit.actual_stop_count=1,
    p=>p.agnostic_route_output_experiment.day_edit.result_candidate_ids=['food-0'],
    p=>p.agnostic_route_output_experiment.day_edit.candidate_id='different',
    p=>p.agnostic_route_output_experiment.intake.resolved.confidence='low',
  ];
  for(const [index,change] of changes.entries()) {const p=structuredClone(published);change(p);
    assert.equal(projectPublishedDay({published:p,intent:inputs,privacy:privacy(),language:'en'})===null,true,`empty conjunction ${index}`);}
  assert.equal(projectPublishedDay({published,intent:intent(),privacy:privacy(),language:'en'}),null,'no acknowledged remove-zero');
});

test('URL-valued identities require native exact HTTP(S) attestation too', async () => {
  const published = await publication({}, {eventSupply:async()=>offlineLive()});
  const evidence = privacy(); evidence.publicSourceUrls.add(LIVE_URL);
  assert.ok(projectPublishedDay({published,intent:intent(),privacy:evidence,language:'en'}));
  const row = published.live_events.tonight[0];
  row.id='ftp://sources.example/private-identity';
  assert.equal(projectPublishedDay({published,intent:intent(),privacy:evidence,language:'en'})===null,true,'non-HTTP URL identity refuses');
  row.id='https://sources.example/identity?edition=1#original';
  assert.equal(projectPublishedDay({published,intent:intent(),privacy:evidence,language:'en'})===null,true,'identity is not auto-attested');
  evidence.publicSourceUrls.add(row.id);
  const accepted=projectPublishedDay({published,intent:intent(),privacy:evidence,language:'en'});
  assert.ok(accepted); assert.equal(accepted.result.live_events.tonight[0].id,row.id,'exact path query fragment');
  for(const impostor of [undefined,[],true,{has:()=>true},new Map([[LIVE_URL,true]])]) {
    assert.equal(projectPublishedDay({published,intent:intent(),privacy:{...evidence,publicSourceUrls:impostor},language:'en'})===null,true,'native Set brand');
  }
  const forged=new Set();forged.has=()=>true;
  assert.equal(projectPublishedDay({published,intent:intent(),privacy:{...evidence,publicSourceUrls:forged},language:'en'})===null,true,'overridden has ignored');
  evidence.publicSourceUrls.has=()=>false;
  assert.ok(projectPublishedDay({published,intent:intent(),privacy:evidence,language:'en'}),'native membership ignores override');
  const invalid='https://user:password@sources.example/'; // controlled sentinel, not credentials
  row.source_url=invalid; evidence.publicSourceUrls.add(invalid);
  assert.equal(projectPublishedDay({published,intent:intent(),privacy:evidence,language:'en'})===null,true,'attestation cannot legalize userinfo');
});

test('malformed selected hours and impossible correlated facts refuse rather than become certainty', async () => {
  const published = await publication({}, {eventSupply:async()=>offlineLive()});
  const evidence=privacy();evidence.publicSourceUrls.add(LIVE_URL);
  const invalid=structuredClone(published);
  invalid.days[0].primary_route.main_stops[0].selected_day_hours={status:'unknown',all_day:false,windows:[]};
  assert.equal(projectPublishedDay({published:invalid,intent:intent(),privacy:evidence,language:'en'})===null,true,'unknown hours require complete original conditional evidence');
  const changes=[
    p=>p.live_events.selected_date='2026-05-26',
    p=>p.live_events.acquisition.source_health.surfaced_event_count++,
    p=>p.live_events.browse.tonight.more_count++,
    p=>p.live_events.browse.tonight.highlight_count++,
    p=>p.live_events.tonight[0].ends_at='2026-05-01T00:00:00Z',
    p=>p.live_events.tonight[0].starts_at='2026-05-25T24:00:00Z',
    p=>p.live_events.tonight[0].lat=null,
    p=>p.days[0].primary_route.main_stops[0].id=p.days[0].primary_route.main_stops[1].id,
    p=>p.days[0].primary_route.map_route_points.reverse(),
    p=>p.agnostic_route_output_experiment.constraint_negotiation.route_present=false,
    p=>p.agnostic_route_output_experiment.constraint_negotiation.preference_coverage.missing_preferences=['food'],
  ];
  for(const [index,change] of changes.entries()) {const p=structuredClone(published);change(p);
    assert.equal(projectPublishedDay({published:p,intent:intent(),privacy:evidence,language:'en'})===null,true,`correlation ${index}`);}
  const zero=structuredClone(published);zero.days[0].primary_route.main_stops[0].lat=0;zero.days[0].primary_route.main_stops[0].lng=0;
  zero.days[0].primary_route.map_route_points[0].lat=0;zero.days[0].primary_route.map_route_points[0].lng=0;
  assert.ok(projectPublishedDay({published:zero,intent:intent(),privacy:evidence,language:'en'}),'real numeric zero is not missing geometry');
  for(const bad of [null,false,[], '',NaN,Infinity,91]) {const p=structuredClone(published);p.days[0].primary_route.main_stops[0].lat=bad;
    assert.equal(projectPublishedDay({published:p,intent:intent(),privacy:evidence,language:'en'}),null);}
});

test('actual source recurrence strings and labeled uncertain temporal facts are not replaced or lost', async () => {
  const { normalizeTimeSensitiveSourceEvent } = require('../server/pulse-sources/time-sensitive-event');
  const { toEventView,rankCollectedEventsForPreferences }=require('../server/place-candidates/agnostic-event-supply');
  const feed={id:'offline-calendar',label:'Offline calendar',timezone:'Europe/Rome'};
  const raw={id:'recurring',title:'Source recurring programme',source_url:LIVE_URL,source_label:'Offline calendar',
    starts_on:DATE,ends_on:'2026-05-30',timezone:'Europe/Rome',lat:41.9,lng:12.49,
    recurrence:'FREQ=WEEKLY',time_window:{kind:'period',label:'Source range; sessions unconfirmed',starts_on:DATE,ends_on:'2026-05-30'}};
  const first=normalizeTimeSensitiveSourceEvent(raw,{now:new Date(`${DATE}T10:00:00Z`)});
  assert.ok(first);assert.equal(first.recurrence,'FREQ=WEEKLY');
  const second=normalizeTimeSensitiveSourceEvent({...raw,id:'recurrence-object',title:'Other programme',
    recurrence:{rule:'FREQ=WEEKLY',label:'Publisher schedule',timezone:'Europe/Rome',occurrence_status:'unconfirmed'}},{now:new Date(`${DATE}T10:00:00Z`)});
  const live=rankCollectedEventsForPreferences({selected_date:DATE,coverage:'covered',feed,
    tonight:[toEventView(first,feed,{routeEligible:false}),toEventView(second,feed,{routeEligible:false})],this_week:[],
    acquisition:{source_health:{status:'healthy',result:'events_found',selected_source_count:1,responding_source_count:1,accepted_event_count:2}}},[]);
  const published=await publication({}, {eventSupply:async()=>live});
  const evidence=privacy();evidence.publicSourceUrls.add(LIVE_URL);
  const projected=projectPublishedDay({published,intent:intent(),privacy:evidence,language:'en'});
  assert.ok(projected,'source-supported primitive recurrence is not malformed');
  assert.deepEqual(projected.result.live_events.tonight.map(e=>({recurrence:e.recurrence,time_window:e.time_window})),
    published.live_events.tonight.map(e=>({recurrence:e.recurrence,time_window:e.time_window})));
});

test('uses the actual publisher strong-confidence rule without changing its source string', async () => {
  const published=await publication({}, {placeResolver:async()=>[{label:'Ångström 港, Testland',lat:41.9,lng:12.49,confidence:'HIGH',
    provenance:'offline_fixture',timezone:'Europe/Rome',osm_class:'boundary',osm_ref:'relation/123456'}]});
  assert.equal(published.agnostic_route_output_experiment.promotion.promote,true,'real publisher accepts strong case-insensitive labels');
  const projected=projectPublishedDay({published,intent:intent(),privacy:privacy(),language:'en'});
  assert.ok(projected,'same strong conjunction as final publisher');
  assert.equal(projected.result.agnostic_route_output_experiment.intake.resolved.confidence,'HIGH');
  assert.equal(projected.intent.place,'Ångström 港, Testland');
});

test('the 1 MiB limit counts the aggregate UTF-8 projection, not the larger original command twice', async () => {
  const { normalizeDayEdit }=require('../shared/planner-intent.mjs');
  const command=normalizeDayEdit({version:1,action:'remove',candidate_id:'obsolete',retained_candidate_ids:
    Array.from({length:6},(_,i)=>`old-${i}-${'x'.repeat(150)}`),target_stop_count:6,slot_index:0,
    replacement_preference:null,removed_candidate_ids:[],preserve_retained:false});
  const published=await publication({day_edit:command});
  assert.equal(published.agnostic_route_output_experiment.day_edit.status,'applied');
  assert.equal(published.agnostic_route_output_experiment.promotion.promote,true);
  const inputs={...intent(),dayEdit:command,excludedCandidateIds:['obsolete']};
  published.days[0].primary_route.caveats=[''];
  const base=projectPublishedDay({published,intent:inputs,privacy:privacy(),language:'en'});
  assert.ok(base);
  const available=1048576-Buffer.byteLength(JSON.stringify(base),'utf8');
  published.days[0].primary_route.caveats[0]='a'.repeat(available);
  const exact=projectPublishedDay({published,intent:inputs,privacy:privacy(),language:'en'});
  assert.ok(exact,'a projection exactly at 1 MiB must not double-count the unapplied request shape');
  assert.equal(Buffer.byteLength(JSON.stringify(exact),'utf8'),1048576);
  published.days[0].primary_route.caveats[0]+='a';
  assert.equal(projectPublishedDay({published,intent:inputs,privacy:privacy(),language:'en'}),null,'one byte over refuses whole');
  published.days[0].primary_route.caveats[0]='漢'.repeat(Math.floor(available/3))+ 'a'.repeat(available%3);
  const unicode=projectPublishedDay({published,intent:inputs,privacy:privacy(),language:'en'});
  assert.ok(unicode);assert.equal(Buffer.byteLength(JSON.stringify(unicode),'utf8'),1048576);
  published.days[0].primary_route.caveats[0]+='漢';
  assert.equal(projectPublishedDay({published,intent:inputs,privacy:privacy(),language:'en'}),null,'UTF-8 not character count');
});

test('pure closed copies never visit private graphs or retain producer object references', async () => {
  const published=await publication({}, {eventSupply:async()=>offlineLive()});
  const evidence=privacy();evidence.publicSourceUrls.add(LIVE_URL);
  const input=intent();
  const expected=projectPublishedDay({published,intent:input,privacy:evidence,language:'en'});assert.ok(expected);
  published.live_completion={};Object.defineProperty(published.live_completion,'token',{get(){throw Error('private bearer visited');}});
  const cycle={};cycle.self=cycle;published.private_graph=cycle;
  plantPrivate(published);plantPrivate(input);
  const originals=new WeakSet();
  function freeze(value) {if(!value||typeof value!=='object'||originals.has(value))return;originals.add(value);
    for(const d of Object.values(Object.getOwnPropertyDescriptors(value)))if(Object.hasOwn(d,'value'))freeze(d.value);Object.freeze(value);}
  freeze(published);freeze(input);freeze(evidence);
  const actual=projectPublishedDay({published,intent:input,privacy:evidence,language:'en'});
  assert.deepEqual(actual,expected);
  function detached(value){if(!value||typeof value!=='object')return;assert.equal(originals.has(value),false);
    for(const child of Object.values(value))detached(child);}
  detached(actual);
  const diagnostic=structuredClone(expected.result);diagnostic.agnostic_route_output_experiment.experimental_route={main_stops:[{id:'UNPUBLISHED_TRIAL'}],map_path_points:[{lat:89,lng:179}]};
  assert.deepEqual(projectPublishedDay({published:diagnostic,intent:input,privacy:evidence,language:'en'}),expected,'trial cannot substitute the final route');
});

test('source ages, null ages, independent primary error and completed background health never renew', async () => {
  for(const age of [0,null,87654]) {
    const loader=async()=>Object.assign(records(),{loader_error:'primary_failed',loader_metadata:{
      cache:{served_stale:true,stale_age_seconds:age,refresh_reason:'refresh_failed'},
      source_completion:{status:'complete',reason:'background_complete',pending:0,completed:2,failed:1},
      primary_collection:'neighbouring_budget_cache',primary_collection_reason:'primary_failed'}});
    const published=await publication({}, {openDataLoader:loader});
    assert.equal(published.agnostic_route_output_experiment.promotion.promote,true);
    const source=published.agnostic_route_output_experiment.source_status;
    assert.equal(source.collection.cache.stale_age_seconds,age);
    const projected=projectPublishedDay({published,intent:intent(),privacy:privacy(),language:'en'});assert.ok(projected);
    assert.deepEqual(projected.result.agnostic_route_output_experiment.source_status.collection.cache,source.collection.cache);
    assert.deepEqual(projected.result.agnostic_route_output_experiment.source_status.collection.source_completion,source.collection.source_completion);
    assert.equal(projected.result.agnostic_route_output_experiment.source_status.error,'primary_failed');
    const now=Date.now;try {Date.now=()=>{throw Error('clock read');};
      assert.deepEqual(projectPublishedDay({published,intent:intent(),privacy:privacy(),language:'en'}),projected);
    } finally {Date.now=now;}
    const corrupt=structuredClone(published);corrupt.agnostic_route_output_experiment.source_status.error='raw diagnostic message';
    assert.equal(projectPublishedDay({published:corrupt,intent:intent(),privacy:privacy(),language:'en'}),null);
  }
});

test('actual empty, rejected-empty, partial, pending and failed Live remain distinct historical facts', async () => {
  const {buildAnchorEventSourceHealth,summarizeRejections}=require('../server/place-candidates/anchor-event-acquisition');
  const {rankCollectedEventsForPreferences}=require('../server/place-candidates/agnostic-event-supply');
  const rejected=[{reason:'invalid_geometry'}];
  const cases=[
    {health:buildAnchorEventSourceHealth([{status:'empty',raw:[]}]),coverage:'covered'},
    {health:buildAnchorEventSourceHealth([{status:'ok',raw:[{}]}],{normalizedEventCount:1,rejected}),rejections:summarizeRejections(rejected),coverage:'covered'},
    {health:buildAnchorEventSourceHealth([{status:'empty',raw:[]},{status:'failed',raw:[]}]),coverage:'covered'},
    {health:buildAnchorEventSourceHealth([{status:'failed',raw:[]}]),coverage:'covered'},
    {health:buildAnchorEventSourceHealth([]),coverage:'uncovered'},
  ];
  cases.push({coverage:'covered',pending:true,health:{...buildAnchorEventSourceHealth([]),status:'pending',result:'pending',reasons:['background_refresh_pending']}});
  for(const spec of cases) {
    const live=rankCollectedEventsForPreferences({selected_date:DATE,coverage:spec.coverage,...(spec.pending?{pending:true}:{}),feed:null,
      tonight:[],this_week:[],acquisition:{source_health:spec.health,...(spec.rejections?{rejection_summary:spec.rejections}:{})}},[]);
    const published=await publication({}, {eventSupply:async()=>live});
    const projected=projectPublishedDay({published,intent:intent(),privacy:privacy(),language:'en'});assert.ok(projected);
    assert.deepEqual(projected.result.live_events,published.live_events);
    assert.equal(Object.hasOwn(projected.result,'live_completion'),false);
  }
});

test('an actual kept occurrence survives applied removal as part of the entire durable final chain', async () => {
  const kept=keepLive(),choices=[{occurrence_id:kept.id,action:'keep'}];
  const initial=await publication({live_event_choices:choices},{eventSupply:async()=>kept.live});
  assert.equal(initial.agnostic_route_output_experiment.promotion.promote,true);
  const stops=initial.days[0].primary_route.main_stops;
  const live=stops.find(s=>s.is_live_event&&s.live_occurrence_id===kept.id);assert.ok(live,'real final weave contains kept occurrence');
  const removed=stops.find(s=>!s.is_live_event);
  const {normalizeDayEdit}=require('../shared/planner-intent.mjs');
  const command=normalizeDayEdit({version:1,action:'remove',candidate_id:removed.id,
    retained_candidate_ids:stops.filter(s=>s.id!==removed.id).map(s=>s.id),target_stop_count:stops.length-1,
    slot_index:0,replacement_preference:null,removed_candidate_ids:[]});
  const published=await publication({day_edit:command,live_event_choices:choices},{eventSupply:async()=>kept.live});
  assert.equal(published.agnostic_route_output_experiment.day_edit.status,'applied','real combined publisher accepts Keep + removal');
  const inputs={...intent(),dayEdit:command,excludedCandidateIds:[removed.id],liveEventChoices:choices};
  const evidence=privacy();evidence.publicSourceUrls.add(LIVE_URL);
  const projected=projectPublishedDay({published,intent:inputs,privacy:evidence,language:'en'});assert.ok(projected);
  assert.deepEqual(projected.intent.dayEdit.retained_candidate_ids,published.days[0].primary_route.main_stops.map(s=>s.id));
  assert.ok(projected.intent.dayEdit.retained_candidate_ids.includes(live.id));
  captureEvidence('kept-live-applied-removal',published,projected,inputs,evidence);
  assert.equal(projected.intent.dayEdit.target_stop_count,published.days[0].primary_route.main_stops.length);
  const {readCommitmentSnapshot}=require('../frontend/src/lib/commitment-snapshot.mjs');
  const {savedEntryId}=require('../frontend/src/lib/anywhere-storage.mjs');
  const snapshot=snapshotOf(projected);
  assert.equal(readCommitmentSnapshot(snapshot,{anchorKey:snapshot.anchorKey,dayKey:savedEntryId({...projected.intent,dayEdit:null})}).applies,false);
  const impossible=await publication({live_event_choices:[...choices,{occurrence_id:liveId(DATE,'f'),action:'remove'}]},{eventSupply:async()=>kept.live});
  assert.equal(impossible.agnostic_route_output_experiment.promotion.promote,false,'real global Remove cannot preserve Keep');
  assert.equal(projectPublishedDay({published:impossible,intent:{...intent(),liveEventChoices:[...choices,{occurrence_id:liveId(DATE,'f'),action:'remove'}]},privacy:evidence,language:'en'}),null);
});

test('actual stable refusal and Live remove preserve their distinct reasons and actions', async () => {
  const choices=[{occurrence_id:liveId(DATE,'e'),action:'remove'}],pins=['missing-source-place'];
  const published=await publication({pinned_candidate_ids:pins,live_event_choices:choices});
  assert.equal(published.agnostic_route_output_experiment.promotion.promote,true);
  const projected=projectPublishedDay({published,intent:{...intent(),pinnedCandidateIds:pins,liveEventChoices:choices},privacy:privacy(),language:'en'});assert.ok(projected);
  const source=published.agnostic_route_output_experiment.pinned_candidates;
  assert.ok(source.unhonored[0].reason,'real finalizer gives a specific refusal');
  assert.deepEqual(projected.result.agnostic_route_output_experiment.pinned_candidates,source);
  const snapshot=snapshotOf(projected);
  assert.deepEqual(snapshot.refusals,source.unhonored);
  assert.equal(snapshot.appliedPins.length,1,'unhonored still answered');
  assert.equal(snapshot.entries[choices[0].occurrence_id].liveAction,'remove');
  const unknown=structuredClone(published);unknown.agnostic_route_output_experiment.pinned_candidates.unhonored[0].reason=null;
  const unknownProjection=projectPublishedDay({published:unknown,intent:{...intent(),pinnedCandidateIds:pins,liveEventChoices:choices},privacy:privacy(),language:'en'});
  assert.ok(unknownProjection);assert.equal(unknownProjection.result.agnostic_route_output_experiment.pinned_candidates.unhonored[0].reason,null);
});

test('route and occurrence cardinality are not sliced; defensive graph limits refuse as a unit', async () => {
  const original=await publication({}, {eventSupply:async()=>offlineLive()});
  const evidence=privacy();evidence.publicSourceUrls.add(LIVE_URL);
  const published=structuredClone(original);
  const route=published.days[0].primary_route;
  const stop=route.main_stops[0];
  // Controlled policy probe over real stop facts; not a claim this enlarged
  // chain passed the actual planner's ranking/publication gates.
  route.main_stops=Array.from({length:9},(_,i)=>({...structuredClone(stop),id:`policy-stop-${i}`,label:`Policy stop ${i}`}));
  published.days[0].primary_route=require('../server/planner/route-public-geometry').projectRouteToSelectedStopChain(route);
  const projected=projectPublishedDay({published,intent:intent(),privacy:evidence,language:'en'});assert.ok(projected);
  assert.equal(projected.result.days[0].primary_route.main_stops.length,9);
  assert.equal(projected.result.days[0].primary_route.map_route_points.length,9);
  const cyclic=structuredClone(original);cyclic.live_events.tonight[0].occurrences=[cyclic.live_events.tonight[0]];
  assert.equal(projectPublishedDay({published:cyclic,intent:intent(),privacy:evidence,language:'en'}),null);
  const deep=structuredClone(original);let current=deep.live_events.tonight[0];
  for(let i=0;i<80;i++){const child={id:`nested-${i}`,title:'Nested source occurrence'};current.occurrences=[child];current=child;}
  assert.equal(projectPublishedDay({published:deep,intent:intent(),privacy:evidence,language:'en'}),null);
  const wide=structuredClone(original);wide.days[0].primary_route.map_path_points=new Array(200000).fill({lat:0,lng:0});
  assert.equal(projectPublishedDay({published:wide,intent:intent(),privacy:evidence,language:'en'}),null);
  const oversized=structuredClone(original);oversized.live_events.tonight[0].occurrences=Array.from({length:1000},(_,i)=>({id:`source-${i}`,title:'漢'.repeat(500)}));
  assert.equal(projectPublishedDay({published:oversized,intent:intent(),privacy:evidence,language:'en'}),null);
});

test('correlated publication verdicts cannot be relabeled as a different answered preference set', async () => {
  const published=await publication();
  assert.equal(projectPublishedDay({published,intent:{...intent(),preferences:['green']},privacy:privacy(),language:'en'})===null,true,'source requested coverage binds the original intent');
  for(const mutate of [
    p=>p.agnostic_route_output_experiment.promotion.readiness='non_promotable',
    p=>p.agnostic_route_output_experiment.promotion.disqualifying_caps=['capped_by_non_promotable'],
    p=>p.agnostic_route_output_experiment.promotion.blocked_caps=['capped_by_non_promotable'],
    p=>p.agnostic_route_output_experiment.eligibility.blockers=['live_keep_not_preserved'],
  ]){const p=structuredClone(published);mutate(p);
    assert.equal(projectPublishedDay({published:p,intent:intent(),privacy:privacy(),language:'en'})===null,true,'inconsistent final verdict');}
  assert.equal(projectPublishedDay({published,intent:{...intent(),excludedCandidateIds:[published.days[0].primary_route.main_stops[0].id]},privacy:privacy(),language:'en'})===null,true,'excluded identity cannot be in final route');
});

test('malformed API arguments and accessors refuse without executing caller code', async () => {
  assert.doesNotThrow(()=>assert.equal(projectPublishedDay(null),null));
  const published=await publication();let reads=0;
  const accessor={intent:intent(),privacy:privacy(),language:'en'};
  Object.defineProperty(accessor,'published',{get(){reads++;return published;}});
  assert.equal(projectPublishedDay(accessor),null);assert.equal(reads,0,'known getters are not evaluated');
  const proxy=new Proxy(published,{getOwnPropertyDescriptor(){reads++;throw Error('proxy descriptor trap');}});
  assert.equal(projectPublishedDay({published:proxy,intent:intent(),privacy:privacy(),language:'en'}),null);assert.equal(reads,0,'known proxies are not traversed');
  const setAccessor=privacy(),attested=setAccessor.publicSourceUrls;
  Object.defineProperty(setAccessor,'publicSourceUrls',{get(){reads++;return attested;}});
  assert.equal(projectPublishedDay({published,intent:intent(),privacy:setAccessor,language:'en'}),null);
  assert.equal(reads,0,'private attestation getters are not evaluated');
  const permitted=structuredClone(published);permitted.private_graph=proxy;
  assert.ok(projectPublishedDay({published:permitted,intent:intent(),privacy:privacy(),language:'en'}),'unknown private proxies are not inspected at all');
});

test('server projector loads with the existing runtime COPY surface, without frontend source modules', () => {
  // Dependency-membership probe only, NOT an image build or runtime acceptance.
  // Dockerfile copies server/, shared/ and the shared classifier, but only
  // frontend/dist, not frontend/src. Do not borrow omitted host-only helpers.
  const {spawnSync}=require('node:child_process');
  const script=`const Module=require('node:module');const resolve=Module._resolveFilename;
    Module._resolveFilename=function(...args){const filename=resolve.apply(this,args);
      if(filename.includes('/frontend/src/'))throw Error('outside runtime COPY surface: '+filename);return filename;};
    const api=require('./server/planner/published-day-projection');if(typeof api.projectPublishedDay!=='function')process.exit(2);`;
  const child=spawnSync(process.execPath,['-e',script],{cwd:require('node:path').resolve(__dirname,'..'),encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr);
});

test('aggregate pin overflow is checked even when the canonical verdict itself is coherent', async () => {
  const kept=keepLive(),choices=[{occurrence_id:kept.id,action:'keep'}];
  const published=await publication({live_event_choices:choices},{eventSupply:async()=>kept.live});
  const evidence=privacy();evidence.publicSourceUrls.add(LIVE_URL);
  assert.ok(projectPublishedDay({published,intent:{...intent(),liveEventChoices:choices},privacy:evidence,language:'en'}));
  // Controlled NEGATIVE policy probe: make only the pin summary coherent for
  // the over-budget input using the actual helper. This is not a claim that
  // the current publisher would promote twelve missing stable pins + Keep.
  const pins=Array.from({length:12},(_,i)=>`over-budget-pin-${i}`);
  const {summarizePinnedOutcome}=require('../server/planner/pinned-candidates');
  published.agnostic_route_output_experiment.pinned_candidates=summarizePinnedOutcome(pins,published.days[0].primary_route.main_stops);
  assert.equal(published.agnostic_route_output_experiment.pinned_candidates.requested_count,12);
  assert.equal(projectPublishedDay({published,intent:{...intent(),pinnedCandidateIds:pins,liveEventChoices:choices},privacy:evidence,language:'en'}),null,'13 aggregate pins never silently becomes 12');
});

test('all 52 acknowledged other-date Live choices survive without borrowing the active ledger', async () => {
  const choices=Array.from({length:52},(_,i)=>({occurrence_id:`live:2026-05-26:${i.toString(16).padStart(32,'0')}`,action:'keep'}));
  const published=await publication({live_event_choices:choices});
  assert.equal(published.agnostic_route_output_experiment.promotion.promote,true);
  const projected=projectPublishedDay({published,intent:{...intent(),liveEventChoices:choices},privacy:privacy(),language:'en'});assert.ok(projected);
  assert.deepEqual(projected.intent.liveEventChoices,choices);
  assert.equal(projected.result.agnostic_route_output_experiment.live_event_choices.ignored_other_day_count,52);
  assert.equal(snapshotOf(projected),null);
  const tooMany=[...choices,{occurrence_id:liveId('2026-05-26','f'),action:'keep'}];
  assert.equal(projectPublishedDay({published,intent:{...intent(),liveEventChoices:tooMany},privacy:privacy(),language:'en'}),null);
});

test('escaped strings and surrogate pairs use exact serialized UTF-8 accounting', async () => {
  const published=await publication();published.days[0].primary_route.caveats=[''];
  const baseline=projectPublishedDay({published,intent:intent(),privacy:privacy(),language:'en'});assert.ok(baseline);
  const available=1048576-Buffer.byteLength(JSON.stringify(baseline),'utf8');
  // Controlled byte-policy probes, not source claims or source freshness.
  for(const [character,bytes] of [['"',2],['\u0000',6],['\ud800',6],['😀',4]]) {
    const padding=character.repeat(Math.floor(available/bytes))+'a'.repeat(available%bytes);
    published.days[0].primary_route.caveats[0]=padding;
    const projected=projectPublishedDay({published,intent:intent(),privacy:privacy(),language:'en'});assert.ok(projected);
    assert.equal(Buffer.byteLength(JSON.stringify(projected),'utf8'),1048576);
    published.days[0].primary_route.caveats[0]+='a';
    assert.equal(projectPublishedDay({published,intent:intent(),privacy:privacy(),language:'en'}),null);
  }
});

test('a source-plan default of four is not a universal final feed cardinality cap', async () => {
  const live=offlineLive();
  live.feeds=Array.from({length:5},(_,i)=>({id:`source-${i}`,label:`Calendar ${i}`,license:'CC-BY',status:i===4?'failed':'ok'}));
  live.acquisition.source_health.selected_source_count=5;
  live.acquisition.source_health.responding_source_count=4;
  const published=await publication({}, {eventSupply:async()=>live});
  assert.equal(published.live_events.feeds.length,5,'actual final shaper forwards the complete source list');
  const evidence=privacy();evidence.publicSourceUrls.add(LIVE_URL);
  const projected=projectPublishedDay({published,intent:intent(),privacy:evidence,language:'en'});
  assert.ok(projected,'bounded complete feed facts are not cut at a default acquisition count');
  assert.deepEqual(projected.result.live_events.feeds,published.live_events.feeds.map(f=>({label:f.label,license:f.license,status:f.status})));
});

test('unknown requested source preference facts cannot disappear during intent correlation', async () => {
  const published=await publication();
  const coverage=published.agnostic_route_output_experiment.constraint_negotiation.preference_coverage;
  coverage.requested_preferences.push('not_a_modern_preference');
  coverage.missing_preferences.push('not_a_modern_preference');
  assert.equal(projectPublishedDay({published,intent:intent(),privacy:privacy(),language:'en'})===null,true,
    'normalizing correlation must not silently drop an extra requested source fact');
});

for (const kind of ['daily', 'occurrences']) {
  test(`canonical selected-day ${kind} Live identity preserves original source facts`, async () => {
    const { normalizeTimeSensitiveSourceEvent } = require('../server/pulse-sources/time-sensitive-event');
    const { toEventView, rankCollectedEventsForPreferences } = require('../server/place-candidates/agnostic-event-supply');
    const { eventOccurrenceForDate } = require('../server/candidates/evening-event-weave');
    const { liveOccurrenceId } = require('../server/planner/live-occurrence-choice');
    const feed = { id: 'offline-calendar', label: 'Offline calendar', license: 'CC-BY', timezone: 'Europe/Rome' };
    const raw = {
      id: `source-session-${kind}`, title: `Public concert ${kind}`, source_url: LIVE_URL,
      source_label: feed.label, lat: 41.9005, lng: 12.4905, tags: ['concert', 'culture'], confidence: 'high',
      starts_on: DATE, ends_on: '2026-05-30',
      time_window: { kind, starts_on: DATE, ends_on: '2026-05-30', local_start: '19:00', local_end: '22:00',
        ...(kind === 'occurrences' ? { dates: [DATE, '2026-05-30'] } : {}) },
    };
    const normalized = normalizeTimeSensitiveSourceEvent(raw, { timezone: feed.timezone, now: new Date(`${DATE}T10:00:00Z`) });
    assert.ok(normalized, 'the real source normalizer admits this local session');
    const view = toEventView(normalized, feed, { routeEligible: true });
    const live = rankCollectedEventsForPreferences({
      selected_date: DATE, coverage: 'covered', feed, tonight: [view], this_week: [],
      acquisition: { source_health: { status: 'healthy', result: 'events_found', selected_source_count: 1,
        responding_source_count: 1, event_bearing_source_count: 1, raw_event_count: 1,
        normalized_event_count: 1, accepted_event_count: 1 } },
    }, intent().preferences);
    const published = await publication({}, { eventSupply: async () => live });
    assert.equal(published.agnostic_route_output_experiment.promotion.promote, true,
      'the actual controlled publisher accepts this day');
    const row = published.live_events.tonight.find(event => event.id === view.id);
    assert.ok(row, 'the final public Live panel contains the original source row');
    assert.equal(row.live_choice_eligible, true, 'the actual final shaper issued an eligible choice');
    assert.equal(row.starts_at, null, 'the source row retains its original unmaterialized time');
    const session = eventOccurrenceForDate(row, DATE);
    assert.ok(session, 'the canonical selected-day session exists');
    assert.equal(typeof session.starts_at, 'string');
    assert.equal(liveOccurrenceId(session), row.live_occurrence_id,
      'the source-issued ID binds to that canonical session, not the original null start');
    const before = JSON.stringify(row);
    const evidence = privacy();
    evidence.publicSourceUrls.add(LIVE_URL); // Controlled input policy, not real-source URL attestation.
    const projected = projectPublishedDay({ published, intent: intent(), privacy: evidence, language: 'en' });
    assert.ok(projected, `source-issued ${kind} session must project without changing its published facts`);
    const copied = projected.result.live_events.tonight.find(event => event.id === row.id);
    const facts = event => Object.fromEntries([
      'id', 'title', 'starts_at', 'ends_at', 'starts_on', 'ends_on', 'time_window', 'timezone',
      'occurrence_date', 'live_occurrence_id', 'live_choice_eligible', 'source_url', 'source_provider_id',
    ].filter(key => Object.hasOwn(event, key)).map(key => [key, event[key]]));
    assert.deepEqual(facts(copied), facts(row), 'materialization validates identity only, never rewrites source facts');
    assert.equal(JSON.stringify(row), before, 'the original source row is not mutated');
    captureEvidence(`eligible-${kind}`, published, projected, intent(), evidence);

    const mismatched = structuredClone(published);
    mismatched.live_events.tonight.find(event => event.id === row.id).live_occurrence_id = liveId(DATE, 'f');
    assert.notEqual(row.live_occurrence_id, liveId(DATE, 'f'), 'the negative actually changes the ID');
    assert.equal(projectPublishedDay({ published: mismatched, intent: intent(), privacy: evidence, language: 'en' }), null,
      'materialization must not legalize a mismatched source-issued ID');

    const changedStart = structuredClone(published);
    changedStart.live_events.tonight.find(event => event.id === row.id).time_window.local_start = '20:00';
    assert.equal(projectPublishedDay({ published: changedStart, intent: intent(), privacy: evidence, language: 'en' }), null,
      'a different local start cannot keep the old occurrence identity');

    const changedDate = structuredClone(published);
    changedDate.live_events.tonight.find(event => event.id === row.id).occurrence_date = '2026-05-26';
    assert.equal(projectPublishedDay({ published: changedDate, intent: intent(), privacy: evidence, language: 'en' }), null,
      'a different occurrence date cannot keep the old occurrence identity');
  });
}
