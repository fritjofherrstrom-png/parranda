const test=require('node:test');const assert=require('node:assert/strict');
const repo=process.env.IDENTITY_DEPTH_TEST_REPO || '..';
const {buildApp}=require(repo+'/server/app');
const {mapOsmElement}=require(repo+'/server/place-candidates/open-data-loader');
const http=require('node:http');
function requestJson(server,{path,body}){return new Promise((resolve,reject)=>{const payload=JSON.stringify(body);const req=http.request({host:'127.0.0.1',port:server.address().port,path,method:'POST',agent:false,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),'Connection':'close'}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(e){reject(e);}});});req.setTimeout(15000,()=>req.destroy(new Error('API request timeout')));req.on('error',reject);req.end(payload);});}
// Deterministic source fixtures, not live-city supply or provider responses.
function supply(){return ['Juniper','Willow','Hazel','Rowan'].flatMap((brand,i)=>{
 const lat=55.605+i*0.0007,lng=13.0038;
 const a=mapOsmElement({type:'node',id:8100+i,lat,lon:lng,tags:{name:brand+' Secondhand',alt_name:brand+' Reuse',shop:'second_hand',website:`https://reuse.example/stores/${brand.toLowerCase()}`,'addr:street':'Oak Street','addr:housenumber':String(i+1),opening_hours:'Mo-Su 10:00-18:00'}});
 const b={id:'directory-'+brand,name:brand+' Reuse',type:'vintage-shop',lat,lng,website:a.website,source_address:a.source_address,sources:[{provider:'directory',family:'open_directory',tier:'inferred',url:'https://directory.example/store/'+brand}]};
 return [a,b];});}

test('source-owned identity enrichment reaches a focused full day without changing admission caps',async()=>{
 const originalFetch=global.fetch;
 global.fetch=require('./helpers/planner-reservoir-compare').mockStableWeatherFetch();
 const server=buildApp({openDataLoader:async()=>supply(),weatherProvider:async()=>({condition:'sun',maxTemp:20,timezone_resolution:{timezone:'Europe/Stockholm',timezone_source:'weather_provider_auto',utc_offset_seconds:7200}}),clock:()=>new Date('2026-09-30T08:00:00Z')}).listen(0);
 try{
 const r=await requestJson(server,{path:'/api/route-recommendations?lang=en&experimental_agnostic_route_output=1&agnostic_engine_compose=1&planner_inspect=1',body:{place:'Malmö',lat:55.605,lng:13.0038,dates:['2026-10-01'],preferences:['second_hand'],day_rhythm:'full',distance_mode:'no_limit',include_external_candidates:1}});
 assert.equal(r.status,200);
 const stops=r.body.days?.[0]?.primary_route?.main_stops || [];
 assert.equal(stops.length,4,'Four independently corroborated storefronts must reach the focused route');
 assert.equal(new Set(stops.map(s=>s.id)).size,4);
 assert.equal(r.body.agnostic_route_output_experiment.intake.resolved.lat,55.605);
 assert.equal(r.body.agnostic_route_output_experiment.intake.resolved.lng,13.0038);
 for(const s of stops) assert.ok(/Juniper|Willow|Hazel|Rowan/.test(s.name||s.label||''));
 }finally{await new Promise(resolve=>server.close(resolve));global.fetch=originalFetch;}
});
