'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createOpenDataLoader}=require('../server/place-candidates/open-data-loader');
const {composeAgnosticRouteOutput}=require('../server/planner/agnostic-route-output');
const {buildAnywhereBlitzDecision}=require('../server/blitz-anywhere');
const {resolveAgnosticCandidateReachPolicy}=require('../server/planner/candidate-reach-policy');
const anchor={lat:59.33,lng:18.07};
function node(id,offset,amenity,hours){return {type:'node',id,lat:anchor.lat+offset,lon:anchor.lng,tags:{name:`Test place ${id}`,amenity,opening_hours:hours,wikidata:`Q${10000+id}`}};}
function response(elements){return {ok:true,json:async()=>({elements})};}
const rich=Array.from({length:25},(_,i)=>node(i+1,i*.0001,['restaurant','cafe','bar','pub'][i%4],'24/7'));
function radius(options){return Number(decodeURIComponent(options.body).match(/around:(\d+)/)[1]);}

test('same rich anchor acquires wider evidence for Full than Easy without a kilometer target',async()=>{
 const radii=[];const loader=createOpenDataLoader({endpoint:'https://fixture.test',fetcher:async(_url,options)=>{radii.push(radius(options));return response(rich);}});
 await loader({...anchor,requestedIntents:['food'],anchorMode:'place',dayRhythm:'calm'});
 await loader({...anchor,requestedIntents:['food'],anchorMode:'place',dayRhythm:'full'});
 assert.ok(radii.at(-1)>radii[0],JSON.stringify(radii));
});

test('Planner forwards the actual rhythm into trusted acquisition',async()=>{
 let request;
 await composeAgnosticRouteOutput({coords:anchor,baselineResult:{days:[]},externalRequested:true,
  openDataLoader:async r=>{request=r;return [];},date:'2026-10-08',
  dayRhythm:'full',walkingKmTarget:null,anchorMode:'place',preferences:['food']});
 assert.equal(request.dayRhythm,'full');
 assert.equal(request.walkingTargetBand,null);
});

test('01:00 nightlife discovers an open farther bar despite a rich nearby closed pool',async()=>{
 const near=rich.map(e=>({...e,tags:{...e.tags,opening_hours:'Mo-Su 10:00-22:00'}}));
 const far=node(999,.033,'bar','Mo-Su 20:00-03:00');const radii=[];
 const loader=createOpenDataLoader({endpoint:'https://fixture.test',fetcher:async(_url,options)=>{const r=radius(options);radii.push(r);return response(r<=1500?near:[...near,far]);}});
 const rows=await loader({...anchor,anchorMode:'place',requestedIntents:['nightlife'],availabilityWindow:{weekday:3,startMinute:60,endMinute:61}});
 assert.deepEqual(radii,[1500,5000]);
 assert.ok(rows.some(r=>r.id==='osm-node-999'),'farther open bar must survive the candidate cut');
});

test('07:00 coffee next move uses trusted local clock to find an open cafe beyond closed nearest places',async()=>{
 const near=rich.map(e=>({...e,tags:{...e.tags,opening_hours:'Mo-Su 10:00-22:00'}}));
 const far=node(999,.026,'cafe','Mo-Su 06:30-09:00');let lastRequest;
 const source=createOpenDataLoader({endpoint:'https://fixture.test',fetcher:async(_url,options)=>response(radius(options)<=1500?near:[...near,far])});
 const result=await buildAnywhereBlitzDecision({placeQuery:'Test town',placeResolver:async()=>[{label:'Test town',...anchor,confidence:'medium',provenance:'test_resolver',timezone:'Europe/Stockholm'}],preferences:['fika'],clock:()=>new Date('2026-10-07T05:00:00Z'),weatherProvider:async()=>null,
  openDataLoader:async r=>{lastRequest=r;return source(r);}});
 assert.deepEqual(lastRequest.availabilityWindow,{weekday:3,startMinute:420,endMinute:421});
 assert.equal(result.best_move?.candidate_id,'osm-node-999',JSON.stringify(result));
});

test('Full and free let mixed preferences reach farther than the Easy local day',()=>{
 const input={anchorMode:'place',preferences:['food','nightlife']};
 const easy=resolveAgnosticCandidateReachPolicy({...input,dayRhythm:'calm'});
 for(const dayRhythm of ['full','free']){
  const reach=resolveAgnosticCandidateReachPolicy({...input,dayRhythm});
  assert.ok(reach.max_origin_distance_km>easy.max_origin_distance_km);
 }
});

test('Parranda chooses a light published day for sparse focused supply instead of always Full',async()=>{
 const {mapOsmElement}=require('../server/place-candidates/open-data-loader');
 const rows=[node(401,.001,'cafe','24/7'),node(402,.004,'cafe','24/7')].map(mapOsmElement);
 const out=await composeAgnosticRouteOutput({coords:anchor,baselineResult:{days:[]},externalRequested:true,
  openDataLoader:async()=>rows,date:'2026-10-08',todayIsoDate:()=> '2026-10-07',
  dayRhythm:'free',walkingKmTarget:null,distanceMode:'no_limit',anchorMode:'place',preferences:['fika'],
  weatherProvider:async()=>null,synthesizeVia:'engine'});
 assert.equal(out.result.days[0]?.primary_route?.day_profile,'light');
 assert.equal(out.result.days[0]?.primary_route?.main_stops?.length,2);
});

test('known source opening at 07:00 outranks unknown hours nearby for the same coffee intent',async()=>{
 const {mapOsmElement}=require('../server/place-candidates/open-data-loader');
 const near=node(601,.001,'cafe',undefined),far=node(602,.026,'cafe','Mo-Su 06:30-09:00');
 const out=await buildAnywhereBlitzDecision({placeQuery:'Test town',placeResolver:async()=>[{label:'Test town',...anchor,confidence:'medium',provenance:'test_resolver',timezone:'Europe/Stockholm'}],preferences:['fika'],clock:()=>new Date('2026-10-07T05:00:00Z'),weatherProvider:async()=>null,openDataLoader:async()=>[near,far].map(mapOsmElement)});
 assert.equal(out.best_move?.candidate_id,'osm-node-602',JSON.stringify(out));
});

test('01:00 next move honors previous-day overnight hours and excludes closed nearby bars',async()=>{
 const {mapOsmElement}=require('../server/place-candidates/open-data-loader');
 const rows=[node(701,.001,'bar','Tu 18:00-23:00'),node(702,.026,'bar','Tu 20:00-03:00')].map(mapOsmElement);
 const out=await buildAnywhereBlitzDecision({placeQuery:'Test town',placeResolver:async()=>[{label:'Test town',...anchor,confidence:'medium',provenance:'test_resolver',timezone:'Europe/Stockholm'}],preferences:['nightlife'],clock:()=>new Date('2026-10-06T23:00:00Z'),weatherProvider:async()=>null,openDataLoader:async()=>rows});
 assert.equal(out.best_move?.candidate_id,'osm-node-702');
 assert.equal(out.context.date,'2026-10-07');
});

test('unknown timezone never invents an opening window',async()=>{
 let req;
 await buildAnywhereBlitzDecision({coords:anchor,preferences:['fika'],clock:()=>new Date('2026-10-07T05:00:00Z'),weatherProvider:async()=>null,openDataLoader:async r=>{req=r;return [];}});
 assert.equal(req.availabilityWindow,null);
});

test('cached acquisition distinguishes rhythms and local clock windows without repeat identical reads',async()=>{
 const {createSourceCache}=require('../server/place-candidates/source-cache');
 const radii=[];const loader=createOpenDataLoader({endpoint:'https://fixture.test',cache:createSourceCache(),fetcher:async(_url,options)=>{radii.push(radius(options));return response(rich);}});
 const r={...anchor,anchorMode:'place',dayRhythm:'calm',requestedIntents:['food']};
 await loader(r);await loader(r);assert.deepEqual(radii,[1500]);
 await loader({...r,dayRhythm:'full'});assert.deepEqual(radii,[1500,5000]);
 await loader({...r,availabilityWindow:{weekday:3,startMinute:420,endMinute:421}});
 await loader({...r,availabilityWindow:{weekday:3,startMinute:421,endMinute:422}});
 assert.deepEqual(radii,[1500,5000,1500,1500]);
});

test('explicit source radius and legacy walking budget retain their contracts',async()=>{
 const radii=[];const fetcher=async(_url,options)=>{radii.push(radius(options));return response(rich);};
 const pinned=createOpenDataLoader({endpoint:'https://fixture.test',fetcher,radiusKm:2});
 await pinned({...anchor,dayRhythm:'full'});assert.equal(radii[0],2000);
 const legacy=createOpenDataLoader({endpoint:'https://fixture.test',fetcher});
 await legacy({...anchor,walkingTargetBand:{targetKm:8}});
 const before=radii.at(-1);await legacy({...anchor,walkingTargetBand:{targetKm:8},dayRhythm:'calm'});assert.equal(radii.at(-1),before);
});

test('free can still publish a peak day when eligible varied supply is rich',async()=>{
 const {mapOsmElement}=require('../server/place-candidates/open-data-loader');
 const rows=[...rich,node(901,.01,'arts_centre','24/7'),{type:'node',id:902,lat:anchor.lat+.02,lon:anchor.lng,tags:{name:'Test park',leisure:'park',wikidata:'Q10902'}},
 {type:'node',id:903,lat:anchor.lat+.012,lon:anchor.lng,tags:{name:'Test view',tourism:'viewpoint',wikidata:'Q10903'}},
 {type:'node',id:904,lat:anchor.lat+.016,lon:anchor.lng,tags:{name:'Test museum',tourism:'museum',wikidata:'Q10904'}}].map(mapOsmElement);
 const out=await composeAgnosticRouteOutput({coords:anchor,baselineResult:{days:[]},externalRequested:true,openDataLoader:async()=>rows,date:'2026-10-08',todayIsoDate:()=> '2026-10-07',dayRhythm:'free',walkingKmTarget:null,distanceMode:'no_limit',anchorMode:'place',preferences:[],weatherProvider:async()=>null,synthesizeVia:'engine'});
 assert.equal(out.result.days[0]?.primary_route?.day_profile,'peak');
});

test('public Planner initial acquisition already carries the requested rhythm',async()=>{
 const {buildApp}=require('../server/app');const {requestJson}=require('./helpers/planner-reservoir-compare');const requests=[];
 const server=buildApp({openDataLoader:async r=>{requests.push(r);return [];},weatherProvider:async()=>null}).listen(0);
 try{
  await requestJson(server,{path:'/api/route-recommendations?lang=en',body:{...anchor,dates:['2026-10-08'],preferences:['food','nightlife'],day_rhythm:'full',include_external_candidates:1,experimental_agnostic_route_output:1,agnostic_engine_compose:1}});
  assert.ok(requests.length>0);
  assert.ok(requests.every(r=>r.dayRhythm==='full'),JSON.stringify(requests));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
