import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPlanner} from './helpers/planner-harness.mjs';
import {LAST_KEY,buildSavedEntry} from '../src/lib/anywhere-storage.mjs';

const points=[{lat:55.68,lng:12.57},{lat:55.681,lng:12.58},{lat:55.682,lng:12.59}];
function day(date){return {days:[{date,experimental_agnostic_route_applied:true,primary_route:{id:'__agnostic_compose__',title:'Published day',estimated_km:2,
 main_stops:points.map((p,i)=>({...p,id:String(i),label:'Published stop '+(i+1),type:'museum'})),legs:[],map_path_points:[]},alternatives:[]}],
 agnostic_route_output_experiment:{promotion:{promote:true}}};}
function position(index=0,overrides={}){const p=points[index];return {coords:{latitude:p.lat,longitude:p.lng,accuracy:10,...overrides.coords},timestamp:Date.now(),...overrides};}
const button=(h,name)=>[...h.container.querySelectorAll('button')].find(b=>b.textContent.trim()===name);
async function click(h,name){const b=button(h,name);assert.ok(b,name);await h.act(()=>b.click());}
async function setup(t){
 t.mock.timers.enable({apis:['Date'],now:new Date(2026,10,6,12).getTime()});
 const watches=[],clears=[];
 const geolocation={watchPosition(ok,error,options){watches.push({ok,error,options});return watches.length;},clearWatch(id){clears.push(id);}};
 const h=await mountPlanner({url:'http://localhost/anywhere?place=Testville&lang=en',geolocation,visibilityState:'visible'});t.after(()=>h.unmount());
 await h.clock.advance(500);const first=h.fetchMock.pending()[0];await h.fetchMock.respond(first,day(first.body.dates[0]));await h.clock.advance(50);
 return {h,watches,clears,fix:async(value,i=watches.length-1)=>h.act(()=>watches[i].ok(value))};
}

test('position is opt-in and display-only; the accepted day, storage and Maps links do not change',async t=>{
 const {h,watches,fix}=await setup(t),saved=structuredClone(h.readStorage(LAST_KEY)),calls=h.fetchMock.calls.length;
 const links=()=>[...h.container.querySelectorAll('a[href*="google.com/maps/dir"]')].map(a=>a.href);const before=links();
 assert.equal(watches.length,0);await click(h,'Follow the day');await fix(position());
 assert.equal(watches.length,1);assert.match(h.text(),/You're at Published stop 1/);
 assert.deepEqual(h.readStorage(LAST_KEY),saved);assert.deepEqual(links(),before);assert.equal(h.fetchMock.calls.length,calls);
});

test('a late fix from an old session cannot replace the new session',async t=>{
 const {h,watches,fix,clears}=await setup(t);await click(h,'Follow the day');await fix(position(0));
 await click(h,'Stop following');await click(h,'Follow the day');await fix(position(1));
 await fix(position(2),0);assert.match(h.text(),/You're at Published stop 2/);assert.doesNotMatch(h.text(),/You're at Published stop 3/);
 assert.deepEqual(clears,[1]);assert.equal(watches.length,2);
});

for(const [name,value] of [
 ['old fix',()=>position(0,{timestamp:Date.now()-60001})],
 ['future fix',()=>position(0,{timestamp:Date.now()+5001})],
 ['invalid latitude',()=>position(0,{coords:{latitude:91,longitude:12.57,accuracy:10}})],
 ['invalid longitude',()=>position(0,{coords:{latitude:55.68,longitude:181,accuracy:10}})],
 ['invalid accuracy',()=>position(0,{coords:{latitude:55.68,longitude:12.57,accuracy:-1}})],
])test(`${name} is not presented as current position`,async t=>{
 const {h,fix}=await setup(t);await click(h,'Follow the day');await fix(value());
 assert.doesNotMatch(h.text(),/You're at Published stop/);assert.match(h.text(),/position couldn't be found/i);
});

test('coarse GPS does not claim arrival at a stop',async t=>{
 const {h,fix}=await setup(t);await click(h,'Follow the day');await fix(position(0,{coords:{latitude:55.68,longitude:12.57,accuracy:500}}));
 assert.doesNotMatch(h.text(),/You're at Published stop/);assert.match(h.text(),/approximate/i);
});

test('a denied watch is released, and a late successful callback cannot turn it into tracking',async t=>{
 const {h,watches,fix,clears}=await setup(t);await click(h,'Follow the day');await h.act(()=>watches[0].error({code:1}));
 await fix(position());assert.match(h.text(),/Location was blocked/);assert.doesNotMatch(h.text(),/You're at/);assert.deepEqual(clears,[1]);
});

test('hidden pages release the watch and resume with a new fresh read',async t=>{
 const {h,watches,fix,clears}=await setup(t);await click(h,'Follow the day');await fix(position());
 await h.act(()=>{Object.defineProperty(h.document,'visibilityState',{value:'hidden',configurable:true});h.document.dispatchEvent(new h.window.Event('visibilitychange'));});
 assert.deepEqual(clears,[1]);assert.doesNotMatch(h.text(),/You're at/);await fix(position(2),0);assert.doesNotMatch(h.text(),/You're at/);
 await h.act(()=>{Object.defineProperty(h.document,'visibilityState',{value:'visible',configurable:true});h.document.dispatchEvent(new h.window.Event('visibilitychange'));});
 assert.equal(watches.length,2);assert.match(h.text(),/Finding your position/);await fix(position(1));assert.match(h.text(),/You're at Published stop 2/);
});

test('a fix expires instead of remaining a current position indefinitely',async t=>{
 const {h,fix}=await setup(t);await click(h,'Follow the day');await fix(position());
 t.mock.timers.tick(60001);await h.clock.advance(60001);
 assert.doesNotMatch(h.text(),/You're at/);assert.match(h.text(),/position couldn't be found/i);
});

test('an undated restored day does not offer today progress based only on default controls',async t=>{
 const response=day(undefined);
 const entry=buildSavedEntry({place:'Testville',safeResponse:response,dateIso:null,classification:{status:'composed_limited',placeLabel:'Testville',limitations:[]},
  inputs:{place:'Testville',mode:'typed',walkKey:'balanced',selected:[],dayOffset:0}});
 const h=await mountPlanner({url:'http://localhost/anywhere?restore=last&lang=en',storage:{[LAST_KEY]:entry},
  geolocation:{watchPosition(){throw new Error('must not start');},clearWatch(){}},visibilityState:'visible'});t.after(()=>h.unmount());
 assert.equal(Boolean(button(h,'Follow the day')),false,'an unknown day is not attested as today');
});
