import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnywherePayload } from '../src/lib/anywhere-payload.mjs';
import { buildLiveEventQueryPayload } from '../src/lib/live-event-query.mjs';
import { buildSavedEntry } from '../src/lib/anywhere-storage.mjs';
import { anchorKey } from '../src/lib/recompose-retention.mjs';
import { mountPlanner } from './helpers/planner-harness.mjs';
const selected = { label:'Harbour, Second City, Country',lat:51.5,lng:2.32,selection_id:'selected-token' };
const response={days:[],agnostic_route_output_experiment:{intake:{query:'Harbour',status:'resolved',resolved:selected},source_status:{anchor:{lat:51.5,lng:2.32},status:'healthy_empty'}}};
const ambiguous={days:[],agnostic_route_output_experiment:{intake:{query:'Harbour',status:'unresolved',resolved:null,blockers:['ambiguous_place'],candidates:[{label:'Harbour, First City, Country',selection_id:'first-token'},{label:selected.label,selection_id:'selected-token'}]},source_status:{status:'no_anchor'}}};
const composed={...response,days:[{date:'2026-10-07',experimental_agnostic_route_applied:true,primary_route:{id:'__agnostic_compose__',main_stops:[{id:'a',label:'Place A',lat:51.5,lng:2.32,type:'museum'},{id:'b',label:'Place B',lat:51.501,lng:2.32,type:'restaurant'}],estimated_km:1,legs:[],map_route_points:[],map_path_points:[],confidence:'low'},alternatives:[]}]};
const button=(h,text)=>[...h.container.querySelectorAll('button')].find(x=>x.textContent.includes(text));
const click=(h,element)=>h.act(()=>element.dispatchEvent(new h.window.MouseEvent('click',{bubbles:true,cancelable:true,button:0})));

test('choice and advisory coordinates reach only typed-place requests',()=>{
 const typed=buildAnywherePayload({place:'Harbour',placeSelection:'selected-token',placeBias:{lat:51.5,lng:2.32}});
 assert.equal(typed.place_selection,'selected-token');assert.deepEqual(typed.place_bias,{lat:51.5,lng:2.32});
 const gps=buildAnywherePayload({place:'Harbour',coords:{lat:10,lng:20},placeSelection:'selected-token',placeBias:{lat:51.5,lng:2.32}});
 assert.equal(gps.place_selection,undefined);assert.equal(gps.place_bias,undefined);
});
test('Live keeps selected identity for place scopes and excludes it for position scopes',()=>{
 assert.equal(buildLiveEventQueryPayload({scope:'in_place',response}).place_selection,'selected-token');
 assert.equal(buildLiveEventQueryPayload({scope:'near_me',response,nearMeCoords:{lat:10,lng:20}}).place_selection,undefined);
});
test('saved days and commitment anchors distinguish same-name geographic choices',()=>{
 const a={place:'Harbour',placeLabel:'Harbour, First City',dateIso:'2026-10-07',inputs:{place:'Harbour',placeLabel:'Harbour, First City'}};
 const b={...a,placeLabel:selected.label,inputs:{...a.inputs,placeLabel:selected.label,placeSelection:'selected-token'}};
 assert.notEqual(buildSavedEntry(a).id,buildSavedEntry(b).id);
 assert.notEqual(anchorKey({place:'Harbour',selectionLabel:a.placeLabel}),anchorKey({place:'Harbour',selectionLabel:selected.label}));
});

test('ambiguous place offers choices, then retains selected identity for an adjustment',async t=>{
 const h=await mountPlanner({url:'http://localhost/anywhere?place=Harbour&lang=en'});t.after(()=>h.unmount());
 await h.clock.advance(500);
 await h.fetchMock.respond(h.fetchMock.pending()[0],ambiguous);await h.clock.advance(30);
 assert.match(h.text(),/Which place/);assert.ok(button(h,'Harbour, Second City'));
 await click(h,button(h,'Harbour, Second City'));
 const chosen=h.fetchMock.pending().find(x=>x.url.startsWith('/api/route-recommendations'));
 assert.equal(chosen.body.place,'Harbour');assert.equal(chosen.body.place_selection,'selected-token');
 await h.fetchMock.respond(chosen,response);await h.clock.advance(30);
 const stored=JSON.parse(h.window.localStorage.getItem('parranda:anywhere:last'));
 assert.equal(stored.inputs.placeSelection,'selected-token');
 await click(h,button(h,'Adjust'));await click(h,button(h,'Easy'));await h.clock.advance(500);
 const adjusted=h.fetchMock.pending().find(x=>x.url.startsWith('/api/route-recommendations'));
 assert.equal(adjusted.body.place_selection,'selected-token');
});
test('restored saved day rebuild retains its selected identity',async t=>{
 const entry=buildSavedEntry({place:'Harbour',placeLabel:selected.label,savedAt:'2026-10-07T09:00:00Z',safeResponse:composed,classification:{status:'composed',placeLabel:selected.label},inputs:{place:'Harbour',placeLabel:selected.label,placeSelection:'selected-token',mode:'typed',selected:['food'],walkKey:'balanced',dayOffset:0}});
 const h=await mountPlanner({url:'http://localhost/anywhere?restore=last&lang=en',storage:{'parranda:anywhere:last':entry}});t.after(()=>h.unmount());
 await h.clock.advance(500);
 const rebuild=[...h.container.querySelectorAll('button')].find(x=>/rebuild/i.test(x.textContent));assert.ok(rebuild);
 await click(h,rebuild);await h.clock.advance(30);
 const sent=h.fetchMock.pending().find(x=>x.url.startsWith('/api/route-recommendations'));
 assert.equal(sent.body.place_selection,'selected-token');
});

test('choice handoff is consumed once for language arrival and reused by Blitz', async t => {
 const h=await mountPlanner({url:'http://localhost/anywhere?place=Harbour&lang=en',sessionStorage:{'parranda:place-choice':{place:'Harbour',selection:'selected-token',label:selected.label,at:Date.now()}}});t.after(()=>h.unmount());
 await h.clock.advance(500);
 const arrival=h.fetchMock.pending().find(x=>x.url.startsWith('/api/route-recommendations'));
 assert.equal(arrival.body.place_selection,'selected-token');
 assert.equal(h.window.sessionStorage.getItem('parranda:place-choice'),null);
 await h.fetchMock.respond(arrival,response);await h.clock.advance(30);
 await click(h,button(h,'Blitz right now'));
 assert.equal(h.fetchMock.pending().find(x=>x.url.startsWith('/api/blitz')).body.place_selection,'selected-token');
});

test('search narrowing asks only on consent and keeps a typed anchor', async t => {
 const h=await mountPlanner({url:'http://localhost/anywhere?place=Harbour&lang=en'});t.after(()=>h.unmount());
 let count=0;Object.defineProperty(h.window.navigator,'geolocation',{configurable:true,value:{getCurrentPosition(ok){count++;ok({coords:{latitude:51.5,longitude:2.32}});}}});
 await h.clock.advance(500);await h.fetchMock.respond(h.fetchMock.pending()[0],ambiguous);await h.clock.advance(30);
 assert.equal(count,0);await click(h,button(h,'Use my location to narrow'));
 const narrowed=h.fetchMock.pending().find(x=>x.url.startsWith('/api/route-recommendations'));
 assert.equal(count,1);assert.equal(narrowed.body.place,'Harbour');assert.deepEqual(narrowed.body.place_bias,{lat:51.5,lng:2.32});
 assert.equal(narrowed.body.lat,undefined);assert.equal(narrowed.body.lng,undefined);
});

test('delayed consent after navigation cannot start a place request', async t => {
 const h=await mountPlanner({url:'http://localhost/anywhere?place=Harbour&lang=en'});t.after(()=>h.unmount());
 let answer;Object.defineProperty(h.window.navigator,'geolocation',{configurable:true,value:{getCurrentPosition(ok){answer=ok;}}});
 await h.clock.advance(500);await h.fetchMock.respond(h.fetchMock.pending()[0],ambiguous);await h.clock.advance(30);
 await click(h,button(h,'Use my location to narrow'));
 const count=h.fetchMock.calls.length;
 await h.act(()=>h.window.dispatchEvent(new h.window.Event('pagehide')));
 await h.act(()=>answer({coords:{latitude:51.5,longitude:2.32}}));await h.clock.advance(500);
 assert.equal(h.fetchMock.calls.length,count);
});

test('expired stored choice asks for confirmation before selecting a fresh candidate', async t => {
 const h=await mountPlanner({url:'http://localhost/anywhere?place=Harbour&lang=en'});t.after(()=>h.unmount());
 await h.clock.advance(500);
 await h.fetchMock.respond(h.fetchMock.pending()[0],{...ambiguous,agnostic_route_output_experiment:{...ambiguous.agnostic_route_output_experiment,intake:{...ambiguous.agnostic_route_output_experiment.intake,blockers:['place_selection_invalid']}}});
 await h.clock.advance(30);assert.match(h.text(),/needs confirming again/);
 await click(h,button(h,'Harbour, Second City'));assert.equal(h.fetchMock.pending()[0].body.place_selection,'selected-token');
});

test('choosing a place cancels an older adjustment debounce', async t => {
 const h=await mountPlanner({url:'http://localhost/anywhere?place=Harbour&lang=en'});t.after(()=>h.unmount());
 await h.clock.advance(500);await h.fetchMock.respond(h.fetchMock.pending()[0],ambiguous);await h.clock.advance(30);
 await click(h,button(h,'Adjust'));await click(h,button(h,'Easy'));
 await click(h,button(h,'Harbour, Second City'));await h.clock.advance(500);
 const calls=h.fetchMock.calls.filter(x=>x.url.startsWith('/api/route-recommendations'));
 assert.equal(calls.length,2);assert.equal(calls[1].body.place_selection,'selected-token');assert.equal(calls[1].aborted,false);
});

test('restoring another selected place cancels old Blitz and requests the restored receipt', async t => {
 const entry=buildSavedEntry({place:'Harbour',placeLabel:selected.label,label:'Saved Second City',savedAt:'2026-10-07T09:00:00Z',safeResponse:composed,classification:{status:'composed',placeLabel:selected.label},inputs:{place:'Harbour',placeLabel:selected.label,placeSelection:'selected-token',mode:'typed',selected:['food'],walkKey:'balanced',dayOffset:0}});
 const h=await mountPlanner({url:'http://localhost/anywhere?place=Harbour&lang=en',storage:{'parranda:anywhere:saved':[entry]}});t.after(()=>h.unmount());
 await h.clock.advance(500);
 await h.fetchMock.respond(h.fetchMock.pending()[0],{...response,agnostic_route_output_experiment:{...response.agnostic_route_output_experiment,intake:{query:'Harbour',status:'resolved',resolved:{...selected,label:'Harbour, First City, Country',selection_id:'first-token'}}}});
 await h.clock.advance(30);await click(h,button(h,'Blitz right now'));
 const old=h.fetchMock.pending().find(x=>x.url.startsWith('/api/blitz'));assert.equal(old.body.place_selection,'first-token');
 await click(h,button(h,'Saved Second City'));assert.equal(old.aborted,true);
 await click(h,button(h,'Blitz right now'));
 const fresh=h.fetchMock.pending().find(x=>x.url.startsWith('/api/blitz'));assert.equal(fresh.body.place_selection,'selected-token');
});
