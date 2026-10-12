"use strict";
const assert=require("node:assert/strict"),test=require("node:test"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {resolveDefaultEventSupply,collectAnchorEvents}=require("../server/place-candidates/agnostic-event-supply");
const {createRequestTimeEventDiscovery}=require("../server/pulse-sources/request-time-event-discovery");
const {LIVE_COLLECTION_READ,createLiveCompletionStore}=require("../server/planner/live-completion");
const {createLocalEventProvider}=require("../server/place-candidates/agnostic-event-supply");

test("actual mapped provider binding cannot borrow a branch point reviewed for another source",async()=>{
  const feed={id:"unrelated-publisher",adapter:"mapped_events",wire_profile:"dpl_cms_events_v1",timezone:"Europe/Copenhagen",endpoint:"https://other.example/events"};
  const provider=createLocalEventProvider(feed,{fetcher:async()=>({ok:true,status:200,text:async()=>JSON.stringify([{uuid:"wrong-source",title:"Published event",
    date_time:{start:"2026-10-13T18:00:00+02:00"},address:{country:"DK",zip_code:1172,street:"Krystalgade 15",locationType:"physical"}}])})});
  const result=await provider.create().collect({date:"2026-10-13"});
  assert.equal(result.time_sensitive_events.length,1);
  assert.equal(result.time_sensitive_events[0].lat,undefined);
  assert.equal(result.time_sensitive_events[0].venue_resolution,undefined);
});

test("mapped source, partial health, branch lookup, completion and persisted cache share one real supply chain",async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"parranda-nordic-cache-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const feed=JSON.parse(fs.readFileSync(path.join(__dirname,"../config/reviewed-event-feeds.json"))).find(f=>f.id==="dpl-copenhagen-libraries");
  const failed={...feed,id:"calendar-failure",adapter:"ical",endpoint:"https://broken.example/events.ics"};
  let fetches=0,discoveries=0;
  const fetcher=async url=>{
    fetches++;
    if(url===failed.endpoint)return{ok:false,status:503};
    assert.equal(url,feed.endpoint);
    return{ok:true,status:200,text:async()=>JSON.stringify([{uuid:"cache-event",title:"Published library workshop",url:"https://bibliotek.kk.dk/event/cache-fixture",
      date_time:{start:"2026-10-13T18:00:00+02:00",end:"2026-10-13T19:00:00+02:00"},state:"Active",branches:["Hovedbiblioteket"],
      address:{country:"DK",zip_code:1172,street:"Krystalgade 15",city:"København K",locationType:"physical"}}])};
  };
  const discovery=createRequestTimeEventDiscovery({sourceSearch:async()=>assert.fail("approved mapped source must not search")});
  const env={PARRANDA_AGNOSTIC_EVENTS:"enabled",PARRANDA_CACHE_DIR:dir,PARRANDA_EVENT_FEEDS:JSON.stringify([feed,failed])};
  const make=()=>resolveDefaultEventSupply(env,{eventReader:null,requestTimeDiscovery:async args=>{discoveries++;return discovery(args);},
    collectEvents:args=>collectAnchorEvents({...args,fetcher,venueResolver:async()=>assert.fail("reviewed address cannot spend live place-lookup budget")})});
  const input={anchor:{lat:55.680876,lng:12.573653},now:"2026-10-13T08:00:00Z",selectedDate:"2026-10-13"};
  const pending=await make()(input),store=createLiveCompletionStore(),receipt=store.issue(pending);
  assert.equal(pending.pending,true);
  for(let n=0;n<100&&pending[LIVE_COLLECTION_READ]()?.pending;n++)await new Promise(r=>setImmediate(r));
  const completed=store.read(receipt.token);
  assert.equal(completed.status,200);
  assert.equal(completed.body.live_events.acquisition.source_health.status,"partial");
  assert.equal(completed.body.live_events.tonight[0].venue_resolution.source,"reviewed_venue_registry");
  assert.equal(completed.body.live_events.tonight[0].venue_resolution.license,"ODbL");
  const afterRestart=await make()(input);
  assert.equal(afterRestart.pending,undefined);
  assert.equal(afterRestart.acquisition.source_health.status,"partial");
  assert.equal(afterRestart.tonight[0].venue_resolution.license,"ODbL");
  assert.equal(fetches,2,"one successful mapped fetch and one failing calendar; persisted useful partial skips both on restart");
  assert.equal(discoveries,0);
});
