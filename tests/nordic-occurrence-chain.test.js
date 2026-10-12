"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const {collectAnchorEvents}=require("../server/place-candidates/agnostic-event-supply");
const {shapeCollectedLiveEvents}=require("../server/place-candidates/live-event-query");
const {nuxtPage}=require("./helpers/devalue-fixture");
const {createMappedEventSourceProvider}=require("../server/pulse-sources/mapped-event-source-provider");
const anchor={lat:57.704,lng:11.975};
const feed={id:"series-fixture",endpoint:"https://calendar.example/events",adapter:"mapped_events",wire_profile:"nuxt_wordpress_acf_events_v1",
  bbox:[11.9,57.6,12.1,57.8],timezone:"Europe/Stockholm",source_language:"sv",pulse_only:true,status:"active"};
function event(id,dates){return{id,type:"event",link:`https://calendar.example/event/${id}`,title:{rendered:`Concert ${id}`},
  information:{dates,place:{title:"Source venue"},contact:{location:{lat:anchor.lat,lng:anchor.lng,street_name:"Fixture road",street_number:"1"}}}};}
async function collect(records){return collectAnchorEvents({anchor,registry:[feed],now:"2026-10-12T20:00:00Z",selectedDate:"2026-10-13",
  fetcher:async()=>({ok:true,status:200,text:async()=>nuxtPage({events:records})})});}

test("a source series occupies one Live row while all accepted source occurrences and URLs survive",async()=>{
  const result=await collect([event("a",[{start:"2026-10-13T00:30",end:"2026-10-13T01:30"},{start:"2026-10-13T18:00",end:"2026-10-13T20:00"}]),
    event("b",[{start:"2026-10-13T19:00"}])]);
  const wire=shapeCollectedLiveEvents(result);
  assert.equal(result.acquisition.source_health.accepted_event_count,3);
  assert.equal(wire.tonight.length,2,"one row per explicit source series, rather than repeating its title");
  const group=wire.tonight.find(e=>e.title==="Concert a");
  assert.equal(group.occurrences.length,2);
  assert.deepEqual(group.occurrences.map(e=>e.starts_at).sort(),["2026-10-12T22:30:00.000Z","2026-10-13T16:00:00.000Z"]);
  assert.ok(group.occurrences.every(e=>e.source_url==="https://calendar.example/event/a"&&e.route_eligible===false));
  assert.equal(new Set(group.occurrences.map(e=>e.id)).size,2);
});

test("midnight offset and long out-of-window occurrence lists preserve the selected local day",async()=>{
  const result=await collect([event("midnight",[
    {start:"2025-01-01T00:30"},{start:"2026-10-12T23:30"},{start:"2026-10-13T00:30"},
    {start:"2026-10-13T23:30"},{start:"2026-10-14T00:30"},{start:"2027-01-01T00:30"}])]);
  const all=[...result.tonight,...result.this_week];
  const slots=all.flatMap(e=>e.occurrences||[e]);
  assert.equal(slots.length,3);
  assert.deepEqual(result.tonight.flatMap(e=>e.occurrences||[e]).map(e=>e.starts_at).sort(),
    ["2026-10-12T22:30:00.000Z","2026-10-13T21:30:00.000Z"]);
  assert.equal(result.this_week.flatMap(e=>e.occurrences||[e])[0].starts_at,"2026-10-13T22:30:00.000Z");
});

test("past source slots do not exhaust the occurrence budget before dates are filtered",async()=>{
  const past=Array.from({length:450},()=>({start:"2025-01-01T12:00"}));
  const result=await collect([event("long-series",[...past,{start:"2026-10-13T00:30"},{start:"2026-10-13T18:00"}])]);
  assert.equal(result.tonight.length,1);
  assert.equal(result.tonight[0].occurrences.length,2);
  assert.equal(result.acquisition.source_health.accepted_event_count,2);
});

test("written dates two days away can still be the selected local day across extreme offsets",async()=>{
  const records=[{uuid:"offset-midnight",title:"Published midnight event",url:"https://calendar.example/midnight",
    date_time:{start:"2026-10-11T23:30:00-12:00"},state:"Active",address:{locationType:"physical"}}];
  const result=await createMappedEventSourceProvider({endpoint:"https://calendar.example/events",wireProfile:"dpl_cms_events_v1",
    timezone:"Pacific/Kiritimati",fetcher:async()=>({ok:true,status:200,text:async()=>JSON.stringify(records)})}).create().collect({date:"2026-10-13"});
  assert.equal(result.time_sensitive_events.length,1);
  assert.equal(result.time_sensitive_events[0].starts_on,"2026-10-13");
});
