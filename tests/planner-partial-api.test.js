const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');
const {buildApp}=require('../server/app');const {SOURCE_COMPLETION}=require('../server/place-candidates/background-source');
const {externalRecord}=require('./helpers/planner-reservoir-compare');
function call(server,body,token){return new Promise((resolve,reject)=>{
 const data=JSON.stringify(token?{token}:body);
 const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:token?'/api/planner-status':'/api/route-recommendations?lang=en',method:'POST',agent:false,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),Prefer:'respond-async'}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)})}catch(e){reject(e)}})});
 req.on('error',reject);req.end(data);
})}
function findPartial(value){if(!value||typeof value!=='object')return false;if(value.source_completion?.status==='partial')return true;return Object.values(value).some(findPartial)}

test('real async lifecycle composes source-owned partial SH and SH+fika without default-city work or warm replay',async()=>{
 const source=[...['Juniper','Willow','Hazel'].map((name,i)=>externalRecord('shop-'+i,name,'vintage-shop',55.6+i*.0005,13.0,['second_hand'])),externalRecord('cafe','Maple Cafe','cafe',55.601,13.0005,['fika'])].map(r=>({...r,opening_hours:'Mo-Su 10:00-18:00'}));
 let complete;const slow=new Promise(r=>complete=r);let calls=0;let weather=0;
 const loader=async()=>{calls++;const rows=[...source];Object.defineProperty(rows,SOURCE_COMPLETION,{value:slow});return rows};
 const server=buildApp({openDataLoader:loader,eventSupply:null,reviewedPlaceSource:null,clock:()=>new Date('2026-10-01T09:00:00Z'),weatherProvider:async({anchor})=>{weather++;if(anchor)assert.equal(anchor.lat,55.6);return{condition:'sun',maxTemp:18,timezone_resolution:{timezone:'Europe/Stockholm',timezone_source:'weather_provider_auto',utc_offset_seconds:7200}}}}).listen(0);
 try{
  for(const preferences of [['second_hand'],['second_hand','fika']]){
   const body={lat:55.6,lng:13.0,dates:['2026-10-08'],preferences,day_rhythm:'full',distance_mode:'no_limit',experimental_agnostic_route_output:1,include_external_candidates:1,agnostic_engine_compose:1};
   const first=await call(server,body);assert.equal(first.status,202);
   await new Promise(r=>setTimeout(r,8200));const done=await call(server,null,first.body.planner_lifecycle.token);
   assert.equal(done.status,200);const stops=done.body.days?.[0]?.primary_route?.main_stops||[];assert.ok(stops.length>=2);
   assert.ok(findPartial(done.body),'partial source completion must survive to public provenance');
   for(const stop of stops)assert.ok(stop.covered_preferences.some(p=>preferences.includes(p==='coffee'?'fika':p)));
  }
  assert.equal(calls,2,'one frozen trusted snapshot per original execution');
  assert.equal(weather,2,'only local context, no implicit default-city weather acquisition');
 }finally{complete(source);await new Promise(r=>server.close(r))}
});
