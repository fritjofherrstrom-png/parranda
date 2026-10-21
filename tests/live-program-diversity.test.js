'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { collectAnchorEvents, rankCollectedEventsForPreferences } = require('../server/place-candidates/agnostic-event-supply');
const { withLiveDiscoveryChoices } = require('../server/planner/live-discovery-choices');
const DATE = '2026-10-22', NOW = '2026-10-21T08:00:00Z';
const anchor = { lat: 60.17, lng: 24.94 };
function raw(id, title, start, extra = {}) {
 return { id, name: title, url: 'https://tickets.example/program/shared',
  dates: { start: { dateTime: DATE + 'T' + start + ':00Z' }, timezone: 'Europe/Helsinki', status: { code: 'onsale' } },
  _embedded: { venues: [{ name: 'Published museum', location: { latitude: String(anchor.lat), longitude: String(anchor.lng) } }] }, ...extra };
}
const allRows = r => [...r.tonight, ...(r.browse?.tonight?.more || [])];
async function collect(events) { return collectAnchorEvents({ anchor, now: NOW, selectedDate: DATE, preferences: ['culture'], globalKey: 'fixture-only', registry: [], fetcher: async () => ({ ok: true, json: async () => ({ _embedded: { events } }) }) }); }

// Without display grouping, 30 slots consume both the six highlights and the24-card cap.
test('dense booking times use one program card before caps and preserve every original occurrence', async () => {
 const slots = Array.from({ length: 30 }, (_, i) => raw('slot-' + i, 'Published museum exhibition', `${String(8 + Math.floor(i / 4)).padStart(2,'0')}:${String(i % 4 * 15).padStart(2,'0')}`));
 const others = ['Concert A','Concert B','Concert C'].map((title,i) => raw('other-'+i,title,'19:00',{ url:'https://tickets.example/program/'+i }));
 const result = await collect([...slots,...others]);const rows = allRows(result);
 assert.equal(rows.length,4);assert.equal(result.tonight.length,4);
 const program = rows.find(x => x.title === 'Published museum exhibition');
 assert.equal(program.display_group_kind,'source_program');assert.equal(program.source_series_id,null);
 assert.equal(program.occurrences.length,30);
 assert.deepEqual(program.occurrences.map(x => x.id), slots.map(x => 'tm-'+x.id));
 assert.ok(program.occurrences.every(x => x.route_eligible === true && !x.occurrences));
 assert.equal(result.acquisition.source_health.accepted_event_count,33,'accepted occurrences are not relabelled as fewer source facts');
});

test('display grouping never crosses venue, publisher URL, title, zone or unknown-clock evidence', () => {
 const base = { id:'a', source_provider_id:'published-feed', source_occurrence_id:'a', title:'Museum concert', place:'Published venue', lat:60.17,lng:24.94,timezone:'Europe/Helsinki', source_url:'https://tickets.example/program/a', starts_at:DATE+'T18:00:00Z',salience_score:5 };
 const variants = [
  {id:'b',source_occurrence_id:'b',starts_at:DATE+'T19:00:00Z'},
  {id:'venue',place:'Different venue',starts_at:DATE+'T19:01:00Z'},
  {id:'publisher',source_provider_id:'different-feed',starts_at:DATE+'T19:02:00Z'},
  {id:'url',source_url:'https://tickets.example/program/b',starts_at:DATE+'T19:03:00Z'},
  {id:'title',title:'Different concert',starts_at:DATE+'T19:04:00Z'},
  {id:'zone',timezone:'Europe/Stockholm',starts_at:DATE+'T19:05:00Z'},
  {id:'unknown',source_occurrence_id:'unknown',starts_at:null,starts_on:DATE},
 ].map(x=>({...base,...x,source_occurrence_id:x.id}));
 const result=rankCollectedEventsForPreferences({_rankable_events:{tonight:[base,...variants],this_week:[]}},['culture']);
 const rows=allRows(result),group=rows.find(x=>x.id==='a');assert.ok(Array.isArray(group.occurrences),'compatible supplied slots become a display group');assert.equal(group.occurrences.length,2);
 assert.deepEqual(group.occurrences.map(x=>x.id),['a','b']);
 assert.equal(rows.length,7);
 assert.ok(rows.find(x=>x.id==='unknown'));
});

test('group containers cannot be planned while every eligible source slot retains its own choice identity', async () => {
 const result = await collect([raw('early','Museum concert','17:00'),raw('later','Museum concert','18:00')]);
 const admitted = withLiveDiscoveryChoices(result), group = admitted.tonight[0];
 assert.equal(group.display_group_kind,'source_program');assert.equal(group.live_occurrence_id,undefined);
 assert.equal(group.occurrences.length,2);assert.ok(group.occurrences.every(x=>x.live_choice_eligible===true));
 assert.notEqual(group.occurrences[0].live_occurrence_id,group.occurrences[1].live_occurrence_id);
 assert.ok(group.occurrences.every(x=>x.occurrence_date===DATE));
});

function view(id, publisher, score, extra = {}) {return {id,title:'Concert '+id,place:'Venue '+id,source_provider_id:publisher,source_url:'https://'+publisher+'.example/event/'+id,starts_at:DATE+'T18:00:00Z',timezone:'Europe/Helsinki',salience_score:score,...extra};}

test('an answering local publisher is not hidden behind one denser publisher of equally relevant programs', () => {
 const dense = Array.from({length:30},(_,i)=>view('dense-'+i,'large-listing',8));
 const local=view('local','municipal-calendar',7);
 const result=rankCollectedEventsForPreferences({_rankable_events:{tonight:[...dense,local],this_week:[]}},['culture']);
 assert.equal(result.tonight.length,6);assert.ok(result.tonight.some(x=>x.id==='local'),'a relevant accepted local program gets a highlight');
 assert.equal(allRows(result).length,24);assert.equal(new Set(allRows(result).map(x=>x.id)).size,24);
});

test('source variation cannot promote a weaker preference fit ahead of six relevant programs', () => {
 const matches=Array.from({length:6},(_,i)=>view('match-'+i,'large-listing',8));
 const partial=view('local-talk','municipal-calendar',7,{title:'Architecture lecture'});
 const result=rankCollectedEventsForPreferences({_rankable_events:{tonight:[...matches,partial],this_week:[]}},['culture']);
 assert.ok(!result.tonight.some(x=>x.id==='local-talk'));assert.ok(result.browse.tonight.more.some(x=>x.id==='local-talk'));
});

// A fused municipal-primary record may also carry the already represented
// commercial publisher; the new independent publisher still needs room.
test('publisher variation preserves an equally relevant corroborated local program', () => {
 const commercial = Array.from({length:6},(_,i)=>view('global-'+i,'global-listing',8,{
  sources:[{identity:'tickets.example',provider_id:'global-listing'}],
 }));
 const local = view('local-corroborated','municipal-calendar',7,{
  sources:[{identity:'municipality.example',provider_id:'municipal-calendar'},
   {identity:'tickets.example',provider_id:'global-listing'}],fusion_status:'corroborated',source_count:2,independent_source_count:2,
 });
 const result=rankCollectedEventsForPreferences({_rankable_events:{tonight:[...commercial,local],this_week:[]}},['culture']);
 assert.ok(result.tonight.some(row=>row.id==='local-corroborated'));
 assert.equal(result.tonight.length,6);assert.equal(allRows(result).length,7);
 assert.equal(result.tonight.find(row=>row.id==='local-corroborated').independent_source_count,2);
});

const { weaveEveningEvent } = require('../server/candidates/evening-event-weave');
const structure = { district_day:{ areas:[{center:anchor}] } };
const evening = extra => ({...anchor,ends_at:DATE+'T22:00:00Z',route_eligible:true,cultural_tier:'cultural',...extra});
const selectedAnchor = r => weaveEveningEvent(structure,{coverage:'covered',selected_date:DATE,...r},{selectedDate:DATE}).district_day.evening_event;

test('publisher display variation cannot change the automatic evening route anchor', () => {
 const dense=Array.from({length:6},(_,i)=>view('dense-'+i,'large-listing',8.5,evening({route_eligible:i===5})));
 const local=view('local','municipal-calendar',7,evening({}));
 const published=rankCollectedEventsForPreferences({_rankable_events:{tonight:[...dense,local],this_week:[]}},['culture']);
 assert.ok(published.tonight.some(x=>x.id==='local'),'the local publisher still has a visible highlight');
 assert.equal(selectedAnchor(published).id,'dense-5','automatic route follows source evidence rank before display promotion');
});

test('a display group cannot move its later slot ahead of a better-ranked intervening program for the route', () => {
 const early=view('early','listing',8,evening({title:'Museum concert',place:'Same venue',source_url:'https://listing.example/program/a',source_occurrence_id:'early',starts_at:DATE+'T13:00:00Z',route_eligible:false}));
 const other=view('other','listing',8,evening({starts_at:DATE+'T18:00:00Z'}));
 const late={...early,id:'late',source_occurrence_id:'late',starts_at:DATE+'T19:00:00Z',route_eligible:true};
 const published=rankCollectedEventsForPreferences({_rankable_events:{tonight:[early,other,late],this_week:[]}},['culture']);
 assert.equal(published.tonight.length,2);
 assert.equal(selectedAnchor(published).id,'other','a grouped display is not a new route-priority rule');
});
