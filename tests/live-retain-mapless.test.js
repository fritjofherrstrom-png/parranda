'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {collectAnchorEvents,resolveEventFeedRegistry}=require('../server/place-candidates/agnostic-event-supply');
const {buildAnchorEventSourceHealth}=require('../server/place-candidates/anchor-event-acquisition');
test('a truncated source counts as responding but remains visibly partial',()=>{
 const health=buildAnchorEventSourceHealth([{status:'ok',reason:'source_collection_truncated',raw:[{id:'one'}]}],{acceptedEventCount:1});
 assert.equal(health.responding_source_count,1);assert.equal(health.status,'partial');assert.ok(health.reasons.includes('source_collection_truncated'));
});
test('reviewed geographic calendar retains mapless dated event as labelled source-area evidence, never route geometry',async()=>{
 const registry=resolveEventFeedRegistry({PARRANDA_EVENT_FEEDS_FILE:path.resolve(__dirname,'../config/reviewed-event-feeds.json')});
 const feed=registry.find(f=>f.adapter==='tourism_listing');
 const html='<div class="views-row"><div class="news_titolo"><a href="/en/event/date">Verified calendar event</a></div><span class="date-display-start">08/10/2026</span><span class="date-display-end">08/10/2026</span><div class="news_sedi"><div class="field-content">Source Hall</div></div>';
 const result=await collectAnchorEvents({anchor:{lat:41.9,lng:12.5},registry:[feed],selectedDate:'2026-10-08',now:'2026-10-08T08:00:00Z',fetcher:async()=>({ok:true,text:async()=>html})});
 const event=result.tonight.find(e=>e.title==='Verified calendar event');
 assert.ok(event,JSON.stringify(result.acquisition));assert.equal(event.route_eligible,false);assert.equal(event.lat,null);assert.equal(event.lng,null);assert.equal(event.geographic_relevance,'source_scope');assert.equal(event.source_scope_verified,true);
 const {filterEventsForLiveScope}=require('../server/place-candidates/live-event-query');
 assert.equal(filterEventsForLiveScope([event],{kind:'near_me',anchor:{lat:41.9,lng:12.5},radius_m:3000}).length,0);
 assert.equal(filterEventsForLiveScope([event],{kind:'near_route',points:[{lat:41.9,lng:12.5},{lat:41.91,lng:12.51}],radius_m:3000}).length,0);
 assert.equal(filterEventsForLiveScope([event],{kind:'around_place',anchor:{lat:41.9,lng:12.5},radius_m:3000}).length,1);
});
test('source-area display requires reviewed geographic publisher metadata, not a tourism-looking label',()=>{
 const fs=require('fs');const rows=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../config/reviewed-event-feeds.json'),'utf8'));
 const trusted=rows.find(f=>f.adapter==='tourism_listing');
 for(const unsafe of [{...trusted,reviewed_at:null},{...trusted,source_tier:'unknown'},{...trusted,bbox:null},{...trusted,bbox:[12,42,11,41]},{...trusted,source_family:'unknown'}]){
   const [feed]=resolveEventFeedRegistry({PARRANDA_EVENT_FEEDS:JSON.stringify([unsafe])});
   assert.ok(!feed || feed.source_scoped_pulse!==true);
 }
});
