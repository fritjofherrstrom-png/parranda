'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveEventFeedRegistry, createLocalEventProvider, collectAnchorEvents, resolveEventFeedsForAnchor } = require('../server/place-candidates/agnostic-event-supply');
const { extractHtmlVenueEventDetail, extractHtmlVenueCalendarEvents } = require('../server/pulse-sources/html-venue-calendar-provider');
const registry = () => resolveEventFeedRegistry({ PARRANDA_EVENT_FEEDS_FILE: path.join(__dirname, '../config/reviewed-event-feeds.json') });
const anchors = { rome: {lat:41.9,lng:12.5}, barcelona: {lat:41.38,lng:2.17}, athens: {lat:37.98,lng:23.73} };
for (const [city, anchor] of Object.entries(anchors)) test(`${city} retains its existing Live source through geographic feed selection`, () => {
  const feeds = resolveEventFeedsForAnchor(anchor, registry());
  assert.ok(feeds.length, `${city} must retain configured Live supply`);
  assert.ok(feeds.every(feed => !feed.city));
  assert.ok(feeds.every(feed => !resolveEventFeedsForAnchor({lat:59.33,lng:18.06}, [feed]).length));
});
const response = body => ({ok:true, text:async()=>typeof body === 'string' ? body : JSON.stringify(body)});
test('BCN shared source uses a bounded selected-date CKAN query and preserves date-only/provider geometry', async () => {
  const feed = registry().find(f=>f.adapter==='ckan_agenda');
  assert.ok(feed);
  const calls=[];
  const provider=createLocalEventProvider(feed, {fetcher:async url=>{
    calls.push(String(url)); return response({success:true,result:{records:[{register_id:'gig',name:'Concert',start_date:'2026-10-08',end_date:'2026-10-09',addresses_road_name:'Venue Road',geo_epgs_4326_lat:'41.381',geo_epgs_4326_lon:'2.171'}]}});
  }});
  const result=await provider.create().collect({date:'2026-10-08'});
  const sql=new URL(calls[0]).searchParams.get('sql');
  assert.match(sql,/end_date >= '2026-10-08'/); assert.match(sql,/start_date <= '2026-10-15'/); assert.match(sql,/LIMIT 300$/);
  assert.equal(result.time_sensitive_events.length,1);
  const event=result.time_sensitive_events[0];
  assert.equal(event.starts_on,'2026-10-08'); assert.equal(event.ends_on,'2026-10-09'); assert.equal(event.time_window.kind,'period');
  assert.equal(event.starts_at,undefined); assert.equal(event.lat,41.381); assert.equal(event.lng,2.171);
  assert.match(event.source_url,/guia.barcelona.cat/); assert.equal(event.summary,undefined); assert.equal(event.image_url,undefined);
});
const romeHtml='<div class="views-row"><div class="news_titolo"><a href="/en/event/concert">Concert</a></div><span class="date-display-start">08/10/2026</span><span class="date-display-end">09/10/2026</span><div class="news_sedi"><div class="field-content">Real Hall</div></div><div class="news_indirizzo">Via Roma 1</div>';
test('Rome shared source preserves genuine range and venue without legacy first-match geocoding', async () => {
  const feed=registry().find(f=>f.adapter==='tourism_listing'); assert.ok(feed);
  const calls=[];
  const result=await createLocalEventProvider(feed,{fetcher:async url=>{calls.push(String(url));return response(romeHtml);}}).create().collect({date:'2026-10-08'});
  assert.equal(calls.length,1); const event=result.time_sensitive_events[0];
  assert.equal(event.starts_on,'2026-10-08'); assert.equal(event.time_window.kind,'period'); assert.equal(event.place_context,'Real Hall');
  assert.equal(event.starts_at,undefined); assert.equal(event.lat,undefined); assert.equal(event.lng,undefined);
});
test('date-only source supply still passes through shared geometry and duration gates', async () => {
  const feed=registry().find(f=>f.adapter==='ckan_agenda'); assert.ok(feed);
  const result=await collectAnchorEvents({anchor:anchors.barcelona,registry:[feed],now:'2026-10-08T08:00:00Z',selectedDate:'2026-10-08',fetcher:async()=>response({success:true,result:{records:[
    {register_id:'far',name:'Far concert',start_date:'2026-10-08',end_date:'2026-10-08',addresses_road_name:'Far venue',geo_epgs_4326_lat:'59.33',geo_epgs_4326_lon:'18.06'},
    {register_id:'forever',name:'Permanent exhibition',start_date:'2001-01-01',end_date:'2030-01-01',addresses_road_name:'Venue',geo_epgs_4326_lat:'41.381',geo_epgs_4326_lon:'2.171'},
  ]}})});
  assert.equal(result.tonight.length,0); assert.equal(result.this_week.length,0); assert.equal(result.feeds[0].event_rows,2);
});
test('Athens venue clock uses IANA winter/summer offsets and retains local listing date', () => {
  for (const [month,utcHour] of [['01','19'],['07','18']]) {
    const date=`2026-${month}-08`;
    const detail=extractHtmlVenueEventDetail(`<h2>8.${Number(month)}.2026, 21:00</h2>`, {timezone:'Europe/Athens',expectedDate:date});
    assert.equal(detail.starts_at,`${date}T${utcHour}:00:00.000Z`);
    const events=extractHtmlVenueCalendarEvents(`<div class="date-container"><h2>8.${Number(month)}.2026</h2><ul><li><div class="tease--event-calendar" data-date="8 ${month} 2026"><a href="/concert" title="Concert link"></a></div></li></ul></div>`,{timezone:'Europe/Athens',date,baseUrl:'https://www.megaron.gr/'});
    assert.equal(events[0].listing_date,date); assert.equal(events[0].starts_at,undefined);
  }
});

test('BCN dated event reaches the shared Live API while staying ineligible as an attendance commitment', async t => {
  const {buildApp}=require('../server/app');
  const {requestJson}=require('./helpers/planner-reservoir-compare');
  const {resolveDefaultEventSupply}=require('../server/place-candidates/agnostic-event-supply');
  let calls=0, cached=null, refresh;
  const supply=resolveDefaultEventSupply({PARRANDA_AGNOSTIC_EVENTS:'enabled',PARRANDA_EVENT_FEEDS_FILE:path.join(__dirname,'../config/reviewed-event-feeds.json')},{
    eventCache:{peek:()=>cached,warm:(_key,load)=>{refresh=load().then(value=>{cached=value;});}},
    collectEvents:opts=>collectAnchorEvents({...opts,fetcher:async url=>{
      calls++; assert.equal(new URL(url).hostname,'opendata-ajuntament.barcelona.cat');
      const sql=new URL(url).searchParams.get('sql');
      assert.match(sql,/end_date >= '2026-10-08'/); assert.match(sql,/start_date <= '2026-10-15'/);
      return response({success:true,result:{records:[{register_id:'one',name:'Concert',start_date:'2026-10-08',end_date:'2026-10-08',addresses_road_name:'Venue Road',geo_epgs_4326_lat:'41.381',geo_epgs_4326_lon:'2.171'}]}});
    }}),
  });
  const server=buildApp({clock:{now:()=> '2026-10-07T08:00:00Z'},eventSupply:supply,openDataLoader:null,reviewedPlaceSource:null,placeResolver:async()=>[{...anchors.barcelona,label:'Barcelona',confidence:'medium',provenance:'fixture_resolver'}]}).listen(0);
  t.after(()=>{server.close();server.closeAllConnections();});
  const request={path:'/api/live-events?lang=en',body:{place_query:'Barcelona',anchor:anchors.barcelona,selected_date:'2026-10-08',time:'this_week',scope:'around_place'}};
  const cold=await requestJson(server,request); assert.equal(cold.body.live_events.pending,true);
  await refresh;
  const {status,body}=await requestJson(server,request);
  assert.equal(status,200); assert.ok(calls>0);
  const live=body.live_events;
  const events=[...live.tonight,...live.this_week];
  assert.ok(events.some(event=>event.title==='Concert'),JSON.stringify(body));
  const event=events.find(event=>event.title==='Concert');
  assert.equal(event.route_eligible,false); assert.equal(event.time_window.kind,'occurrences');
  assert.deepEqual(event.time_window.dates,['2026-10-08']);
  assert.equal(event.starts_at,null);
});
for (const adapter of ['ckan_agenda','tourism_listing']) test(`${adapter} collection fails visibly on HTTP/malformed/oversized payloads`, async () => {
  const feed=registry().find(f=>f.adapter===adapter);
  const badPayloads=adapter==='ckan_agenda' ? [response({success:false}),response('x'.repeat(1024*1024+1))] : [response('x'.repeat(1024*1024+1))];
  for (const value of [{ok:false,status:503},...badPayloads]) {
    await assert.rejects(createLocalEventProvider(feed,{fetcher:async()=>value}).create().collect({date:'2026-10-08'}));
  }
});


test('Rome pagination shares one acquisition deadline across every page', async () => {
  const feed=registry().find(f=>f.adapter==='tourism_listing');
  let calls=0;
  const provider=createLocalEventProvider(feed,{timeoutMs:1000,fetcher:async (_url,{signal})=>{
    calls++;
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(resolve,600);
      signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});
    });
    return response(romeHtml+'<a href="/en/romalive?page=2">Next</a>');
  }});
  await assert.rejects(provider.create().collect({date:'2026-10-08'}));
  assert.equal(calls,2,'a third page must not receive a fresh timeout');
});
