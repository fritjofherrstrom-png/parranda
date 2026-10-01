const test=require('node:test');
const assert=require('node:assert/strict');
const {createOperatorVisitEnricher,parseOperatorVisitEvidence,parseHours,contactLink}=require('../server/place-candidates/operator-visit-evidence');
const {createExternalOpenProvider}=require('../server/place-candidates/external-open-provider');
const {reduceEvidence}=require('../server/candidates/evidence-reducer');
const {evaluateCandidateGates,targetFromPlaceCandidate}=require('../server/candidates/gates');
const {evaluateOperationalViability}=require('../server/place-candidates/operational-viability');
const {resolveCandidateIdentity}=require('../server/candidates/entity-resolution');
const {createSourceCache}=require('../server/place-candidates/source-cache');
const record={id:'map-shop',name:'Juniper Reuse',type:'vintage-shop',website:'https://juniper.example/',lat:1,lng:2,tags:['second_hand'],source_address:{street:'Oak Street',house_number:'14'},sources:[{provider:'osm',family:'map',tier:'inferred',url:'https://www.openstreetmap.org/node/42'}]};
const card=(street,hours)=>`<div><p><strong>Branch — Opening hours</strong><br>${hours}</p><p>${street}<br><a href="https://maps.example/">Find this store</a></p></div>`;
const shop=`<meta property="og:site_name" content="Juniper Reuse"><meta name="description" content="Second hand stores"><main>${card('Oak Street 14','Monday – Friday: 11-19 Saturday: 11-17 Sunday: 12-16')}</main>`;
const office=`<script type="application/ld+json">{"@type":"WebSite","name":"Juniper Reuse"}</script><main><h1>Office</h1><h2>Address</h2><p>Birch Road 4<br>12345 Elsewhere</p><h2>Opening hours</h2><p>Tuesday – Friday 13–17 Saturday 11–14</p><p>Our office provides valuation and intake.</p></main>`;
const dns=async()=>[{address:'93.184.216.34',family:4}];
const response=html=>new Response(html,{status:200,headers:{'Content-Type':'text/html'}});

test('current hours belong to the exact address card, never another branch or a footer',()=>{
 const html=`<meta property="og:site_name" content="Juniper Reuse"><meta name="description" content="Second hand stores"><main>${card('Pine Road 9','Monday – Friday 8-10')}${card('Oak Street 14','Monday – Friday 11-19')}</main><footer>Sunday 9-10</footer>`;
 const fact=parseOperatorVisitEvidence(html,record,record.website);
 assert.equal(fact.status,'confirmed_storefront');assert.equal(fact.opening_hours,'Mo-Fr 11:00-19:00');
 assert.equal(parseOperatorVisitEvidence(shop,{...record,source_address:{street:'Oak Street',house_number:'140'}},record.website).status,'unresolved');
 assert.equal(parseOperatorVisitEvidence(shop,{...record,source_address:null},record.website).status,'unresolved');
});
test('hours and address fragments across sibling cards cannot fabricate a storefront',()=>{
 assert.equal(parseOperatorVisitEvidence(`<main><div>Oak Street 14</div>${card('Pine Road 9','Monday – Friday 11-19')}</main>`,record,record.website).status,'unresolved');
 assert.equal(parseOperatorVisitEvidence(`<main><div>Oak Street 14</div><div>Opening hours Monday – Friday 11-19 Store</div></main>`,record,record.website).status,'unresolved');
});
test('a currently identified valuation/intake office is not a shopping target; its hours are not phone hours',()=>{
 const fact=parseOperatorVisitEvidence(office,record,record.website);
 assert.equal(fact.status,'non_shopping_visit');assert.deepEqual(fact.current_address,{street:'Birch Road',house_number:'4'});
 assert.equal(fact.opening_hours,'Tu-Fr 13:00-17:00; Sa 11:00-14:00');
 assert.equal(evaluateOperationalViability({candidate:{type:'vintage-shop',operator_visit_evidence:fact}}).route_eligible,false);
 assert.equal(parseOperatorVisitEvidence(office,{...record,name:'Unrelated Business'},record.website).status,'unresolved');
});
test('retail that also accepts goods or provides valuations is not falsely excluded as office-only',()=>{
 assert.notEqual(parseOperatorVisitEvidence(office.replace('Our office provides','Our store and office provide'),record,record.website).status,'non_shopping_visit');
});
test('a generic shopping statement cannot certify Second hand or antiques',()=>{
 assert.equal(parseOperatorVisitEvidence(shop.replace('Second hand stores','New retail stores'),record,record.website).status,'unresolved');
});
test('a different or unnamed operator at the same street cannot corroborate identity',()=>{
 assert.equal(parseOperatorVisitEvidence(shop.replace('content="Juniper Reuse"','content="Willow Reuse"'),record,record.website).status,'unresolved');
 assert.equal(parseOperatorVisitEvidence(shop.replace('<meta property="og:site_name" content="Juniper Reuse">',''),record,record.website).status,'unresolved');
});
test('unsupported appointment and overlapping hour claims do not become available windows',()=>{
 assert.equal(parseHours('Monday 11-19; Monday 12-18'),null);
 assert.equal(parseHours('Monday-Friday 11-19 Friday 12-17'),null);
 assert.equal(parseHours('Monday-Friday 11-19 by appointment'),null);
 assert.equal(parseHours('Monday 27-29'),null);
 assert.equal(parseHours('Måndag – Fredag: 11-19 Lördag: 11-17 Söndag: 12-16'),'Mo-Fr 11:00-19:00; Sa 11:00-17:00; Su 12:00-16:00');
});
test('fresh source-owned operator facts corroborate an existing mapped address through unchanged gates',async()=>{
 let calls=0;
 const enrich=createOperatorVisitEnricher({cache:createSourceCache(),resolveHost:dns,fetcher:async()=>{calls++;return response(shop)}});
 const rows=await enrich([record]);assert.equal(calls,1);assert.equal(rows[0].opening_hours,'Mo-Fr 11:00-19:00; Sa 11:00-17:00; Su 12:00-16:00');
 const candidate=createExternalOpenProvider({key:'test'},{dataset:rows}).listCandidates()[0];
 const derived=reduceEvidence(candidate.evidence);
 assert.equal(derived.provenance_diversity,2);
 assert.equal(evaluateCandidateGates({target:targetFromPlaceCandidate(candidate),derived}).may_influence_routes,true);
 assert.equal(candidate.trust.human_verified,false);
 assert.equal((await enrich([record]))[0].opening_hours,rows[0].opening_hours);assert.equal(calls,1);
});
test('operator function veto survives identity merging and does not imply that the business closed',()=>{
 const blocked={...createExternalOpenProvider({key:'test'},{dataset:[record]}).listCandidates()[0],operator_visit_evidence:parseOperatorVisitEvidence(office,record,record.website)};
 const plain={...blocked,id:'another-map-id',operator_visit_evidence:undefined};
 for(const input of [[blocked,plain],[plain,blocked]]){
  const rows=resolveCandidateIdentity(input).candidates;
  assert.equal(rows.length,1);assert.equal(evaluateOperationalViability({candidate:rows[0]}).status,'non_visitable');
 }
});
test('same-origin single contact/store hop is bounded and unrelated URLs/payload facts never enter',async()=>{
 const urls=[];const enrich=createOperatorVisitEnricher({cache:createSourceCache(),resolveHost:dns,fetcher:async u=>{urls.push(u);return response(u.endsWith('/stores')?shop:'<a href="https://evil.example/">Stores</a><a href="/stores">Our stores</a>')}});
 const rows=await enrich([record],{website:'https://evil.example/',operator_visit_evidence:{status:'confirmed_storefront'}});
 assert.deepEqual(urls,['https://juniper.example/','https://juniper.example/stores']);assert.equal(rows[0].operator_visit_evidence.status,'confirmed_storefront');
 assert.equal(contactLink('<a href="https://evil.example/">Stores</a>',record.website),null);
});
test('private DNS, redirects, absent facts and oversized bodies fail closed without artificial corroboration',async()=>{
 for(const options of [
  {resolveHost:async()=>[{address:'127.0.0.1',family:4}],fetcher:async()=>assert.fail('private network')},
  {resolveHost:dns,fetcher:async()=>new Response('',{status:302,headers:{location:'https://evil.example/'}})},
  {resolveHost:dns,fetcher:async()=>response('<main>Unknown.</main>')},
  {resolveHost:dns,fetcher:async()=>response('x'.repeat(512*1024+1))},
 ]){
  const enrich=createOperatorVisitEnricher({cache:createSourceCache(),...options});const [row]=await enrich([record]);
  assert.deepEqual(row,record);
 }
});

const weeklyClosure = `<script type="application/ld+json">{"@type":"WebSite","name":"Juniper Reuse"}</script><main><section><p>Oak Street 14</p><p>Monday, Closed<br>Tuesday, Closed<br>Wednesday, Closed<br>Thursday, Closed<br>Friday, 12:00-18:00<br>Saturday, 12:00-16:00<br>Sunday, Closed</p><p>Beyond that, available by appointment.</p><a href="https://maps.google.com?daddr=Oak%20Street%2014">Get directions</a></section></main>`;
test('explicit closed weekdays veto that day without inventing open windows or corroborating a missing address', async()=>{
 const {operatorClosureForWindow}=require('../server/place-candidates/operator-visit-evidence');
 const missing={...record,source_address:undefined,opening_hours:'Mo-Su 10:00-20:00'};
 const fact=parseOperatorVisitEvidence(weeklyClosure,missing,record.website);
 assert.equal(fact.status,'closed_weekdays');assert.deepEqual(fact.closed_weekdays,['Mo','Tu','We','Th','Su']);
 assert.equal(operatorClosureForWindow({operator_visit_evidence:fact},{weekday:4}).eligible,false);
 assert.equal(operatorClosureForWindow({operator_visit_evidence:fact},{weekday:5}),null);
 assert.equal(operatorClosureForWindow({operator_visit_evidence:fact},{weekday:null}),null);
 const enrich=createOperatorVisitEnricher({cache:createSourceCache(),resolveHost:dns,fetcher:async()=>response(weeklyClosure)});
 const [enriched]=await enrich([missing]);
 assert.deepEqual(enriched.sources,missing.sources);assert.equal(enriched.opening_hours,missing.opening_hours);
 const candidate=createExternalOpenProvider({key:'test'},{dataset:[enriched]}).listCandidates()[0];
 assert.equal(operatorClosureForWindow(candidate,{weekday:4}).eligible,false);
 const plain={...candidate,id:'duplicate',operator_visit_evidence:undefined};
 for(const input of [[plain,candidate],[candidate,plain]])assert.equal(operatorClosureForWindow(resolveCandidateIdentity(input).candidates[0],{weekday:4}).eligible,false);
});
test('ambiguous branches, different identity, conflicting address or incomplete weekday statements cannot supply closure',()=>{
 for(const html of [weeklyClosure.replace('"Juniper Reuse"','"Other Reuse"'),weeklyClosure.replace('Sunday, Closed','Sunday, Unknown'),weeklyClosure.replace('Friday, 12:00-18:00','Friday, 18:00-12:00'),weeklyClosure.replace('</section>','<a href="https://maps.google.com?daddr=Other%20Street%204">Get directions</a></section>'),weeklyClosure.replace('</section>',weeklyClosure.match(/<p>Monday.*?<\/p>/)[0]+'</section>')])assert.equal(parseOperatorVisitEvidence(html,record,record.website).status,'unresolved');
 assert.equal(parseOperatorVisitEvidence(weeklyClosure.replaceAll('Street 14','Street 140').replace('Street%2014','Street%20140'),record,record.website).status,'unresolved');
});
test('one canonical www/apex hop is pinned again and preserves the final source URL, other redirects still fail closed',async()=>{
 const urls=[],hosts=[];
 const enriched=await createOperatorVisitEnricher({cache:createSourceCache(),resolveHost:async host=>{hosts.push(host);return dns()},fetcher:async url=>{
  urls.push(url);return url.includes('//www.')?new Response('',{status:301,headers:{location:'https://juniper.example/'}}):response(weeklyClosure);
 }})([{...record,website:'https://www.juniper.example/'}]);
 assert.deepEqual(urls,['https://www.juniper.example/','https://juniper.example/']);assert.deepEqual(hosts,['www.juniper.example','juniper.example']);
 assert.equal(enriched[0].operator_visit_evidence.source_url,'https://juniper.example/');
 for(const location of ['http://juniper.example/','https://juniper.example/other','https://juniper.example/?secret=1','https://www.juniper.example/']) {
  let calls=0;const [row]=await createOperatorVisitEnricher({cache:createSourceCache(),resolveHost:dns,fetcher:async()=>{calls++;return new Response('',{status:301,headers:{location}})}})([{...record,website:'https://www.juniper.example/'}]);assert.equal(calls,1);assert.equal(row.operator_visit_evidence,undefined);
 }
});
test('canonical redirect cannot escape DNS pinning or consume a second redirect', async()=>{
 for(const blockedDns of [true,false]){
  let calls=0;
  const [row]=await createOperatorVisitEnricher({cache:createSourceCache(),resolveHost:async host=>blockedDns&&host==='juniper.example'?[{address:'127.0.0.1',family:4}]:dns(),fetcher:async url=>{calls++;return new Response('',{status:301,headers:{location:url.includes('//www.')?'https://juniper.example/':'https://www.juniper.example/'}})}})([{...record,website:'https://www.juniper.example/'}]);
  assert.equal(row.operator_visit_evidence,undefined);assert.equal(calls,blockedDns?1:2);
 }
});
