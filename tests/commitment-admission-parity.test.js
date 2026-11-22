'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {compose,record}=require('./helpers/day-composition-fixtures');
const {composeDistrictDay}=require('../server/candidates/district-composition');
const {normalizeUserIntents}=require('../server/candidates/intent-vocabulary');
const {classifyPromotionReadiness}=require('../server/planner/agnostic-promotion-gate');
const {markCommitmentEligibility,publishedEligibleIds}=require('../server/planner/commitment-eligibility');
// Actual composer and the same public eligibility projection as app.js.
// Controlled source facts; this is not HTTP/provider/native acceptance.
function projection(output,records,preferences,pins,id){
 const e=output.experiment;
 const promotion=classifyPromotionReadiness({calibration:e.readiness_calibration,strongAnchor:true,
  unresolvedRoles:e.experimental_route?.unresolved_roles,requestedIntents:normalizeUserIntents(preferences).intents,
  preferenceCoverage:e.constraint_negotiation?.preference_coverage,primaryStops:output.stops,pinnedIds:pins});
 assert.equal(promotion.promote,true,'precondition: the actual composition can publish its eligibility');
 const district=composeDistrictDay(records,{intents:preferences,maxAreas:3,candidateSurface:true});
 const publicStructure=markCommitmentEligibility({district_day:{areas:district.areas}},publishedEligibleIds({
  promotionPromote:promotion.promote,commitmentEligibleIds:output.commitmentEligibleIds}),output.candidateHours);
 const row=publicStructure.district_day.areas.flatMap(a=>a.stops||[]).find(c=>c.id===id);
 assert.ok(row,'precondition: this exact identity is in the actual public candidate surface');
 return row.commitment_eligible;
}
function singleSource(candidate,provider){return {...candidate,sources:candidate.sources.filter(s=>s.provider===provider)};}
test('public Add eligibility includes an individually admitted identity below stronger same-role peers',async()=>{
 const id='lower-culture',preferences=['culture'];
 const records=[...Array.from({length:7},(_,i)=>record('strong-culture-'+i,'museum',i)),
  singleSource(record(id,'museum',8),'osm')];
 const before=await compose(records,preferences,{dayRhythm:'balanced'});
 assert.ok(!before.stops.some(s=>s.id===id),'the identity remains outside automatic selection');
 const after=await compose(records,preferences,{dayRhythm:'balanced',pinnedStopIds:[id]});
 assert.ok(after.stops.some(s=>s.id===id),'the same identity is in fact individually pinnable');
 assert.equal(projection(before,records,preferences,[],id),true,'Add must expose a choice the actual pin path admits');
 assert.equal(projection(after,records,preferences,[id],id),true);
});
test('public Add eligibility excludes a below-cut identity rejected directly but admitted only in an adjacent role',async()=>{
 const id='chain-cafe-6',preferences=['food','coffee','views','culture'];
 const records=[...Array.from({length:7},(_,i)=>record('chain-cafe-'+i,'cafe',i,{chain:true,brand:'BigChain'})),
  singleSource(record('local-food','restaurant',7),'osm'),record('local-view','viewpoint',8),record('local-culture','museum',9)];
 const before=await compose(records,preferences,{dayRhythm:'balanced'});
 const after=await compose(records,preferences,{dayRhythm:'balanced',pinnedStopIds:[id]});
 assert.ok(!after.stops.some(s=>s.id===id),'direct rejection is still authoritative on the explicit path');
 assert.ok(after.pinnedRefusals.some(r=>r.id===id),'the actual composer refuses this exact pin');
 assert.equal(projection(before,records,preferences,[],id),false,'Add must not promise a pin the direct-admission guard refuses');
 assert.equal(projection(after,records,preferences,[id],id),false);
});
for(const [name,provider,extra] of [['closed','osm',{opening_hours:'Mo-Su off'}],['knowledge-only','wikidata',{}]])
 test('public Add and explicit admission both refuse '+name+' lower-tier identities',async()=>{
  const id='lower-culture',preferences=['culture'];
  const records=[...Array.from({length:7},(_,i)=>record('strong-culture-'+i,'museum',i)),
   singleSource(record(id,'museum',8,extra),provider)];
  const before=await compose(records,preferences,{dayRhythm:'balanced'});
  const after=await compose(records,preferences,{dayRhythm:'balanced',pinnedStopIds:[id]});
  assert.equal(projection(before,records,preferences,[],id),false);
  assert.equal(projection(after,records,preferences,[id],id),false);
  assert.ok(!after.stops.some(s=>s.id===id));
 });
