'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {composeAgnosticRouteOutput} = require('../server/planner/agnostic-route-output');
const {externalRecord} = require('./helpers/planner-reservoir-compare');

const names = ['Alder','Birch','Cedar','Dogwood','Elm','Fir','Ginkgo','Hazel'];
function sourceRows(type='vintage-shop', count=8) {
  return names.slice(0,count).map((name,index)=>{
    const record=externalRecord(`${type}-${name}`,`${name} ${type}`,type,55.6+index*.001,13,[]);
    return {...record,sources:record.sources.slice(0,1)};
  });
}
async function compose(records,preferences,dayRhythm,options={}) {
  const output=await composeAgnosticRouteOutput({
    coords:{lat:55.6,lng:13},baselineResult:{days:[]},externalRequested:true,
    openDataLoader:async()=>structuredClone(records),date:'2026-10-22',todayIsoDate:'2026-10-15',
    trustedTimezone:'Europe/Stockholm',timezone:'Europe/Stockholm',clock:()=>new Date('2026-10-15T08:00:00Z'),
    weatherProvider:async()=>({condition:'sun',source:'controlled',stale:false}),
    synthesizeVia:'engine',distanceMode:'no_limit',dayRhythm,preferences,...options,
  });
  const route=output.result.days[0]?.primary_route;
  return {route,stops:route?.main_stops||[],experiment:output.experiment};
}

test('automatic single-interest density uses the same admitted places Add can use: calm < balanced < full', async()=>{
  const records=sourceRows();
  const pinnedIds=records.slice(0,6).map(record=>record.id);
  const manual=await compose(records,['second_hand'],'full',{pinnedStopIds:pinnedIds});
  assert.equal(manual.stops.length,6,'precondition: all six are already admitted by the existing Add/pin path');
  const results=[];
  for(const rhythm of ['calm','balanced','full']) {
    const output=await compose(records,['second_hand'],rhythm);
    results.push(output.stops.length);
    assert.ok(output.stops.every(stop=>stop.type==='vintage-shop'));
    assert.equal(output.route.trust_summary.human_verified,false);
  }
  assert.deepEqual(results,[4,5,6],'intensity, not source-family count, controls automatic day density');
});

for (const [preference,type] of [['coffee','cafe'],['culture','museum'],['food','restaurant'],
  ['views','viewpoint'],['green','park'],['nightlife','bar']]) {
  test(`single-source ${preference} also spends rhythm on matching places`,async()=>{
    const records=sourceRows(type);
    const counts=[];
    for(const rhythm of ['calm','balanced','full']) {
      const output=await compose(records,[preference],rhythm);
      counts.push(output.stops.length);
      assert.ok(output.stops.every(stop=>stop.type===type));
      assert.equal(output.route.trust_summary.human_verified,false);
      assert.ok(output.stops.every(stop=>stop.provisional===true));
    }
    assert.deepEqual(counts,[4,5,6]);
  });
}

test('mixed trust tiers and two preferences retain density without fake corroboration',async()=>{
  const records=[...sourceRows(),...sourceRows('cafe')];
  records[0].sources=externalRecord('extra-map','Alder vintage-shop','vintage-shop',55.6,13).sources;
  for(const preferences of [['second_hand'],['second_hand','coffee']]) {
    const counts=[];
    for(const rhythm of ['calm','balanced','full']) {
      const output=await compose(records,preferences,rhythm);
      counts.push(output.stops.length);
      const types=new Set(output.stops.map(stop=>stop.type));
      assert.ok([...types].every(type=>type==='vintage-shop'||preferences.includes('coffee')&&type==='cafe'));
      if(preferences.length===2)assert.equal(types.size,2);
      assert.equal(output.route.trust_summary.human_verified,false);
      assert.ok(output.stops.some(stop=>stop.trust?.confidence==='low'),'existing inferred confidence is not upgraded');
    }
    assert.deepEqual(counts,[4,5,6]);
  }
});

test('rhythm depth still refuses known-closed, unattributed and excluded places and preserves pins',async()=>{
  const {withoutExcludedCandidates}=require('../server/planner/excluded-candidates');
  const rows=sourceRows();
  rows[0].opening_hours='Mo-Su off';
  const usable=await withoutExcludedCandidates(async()=>rows,[rows[1].id])();
  const output=await compose(usable,['second_hand'],'full',{pinnedStopIds:[rows[7].id]});
  assert.equal(output.stops.length,6);
  assert.ok(output.stops.some(stop=>stop.id===rows[7].id));
  assert.ok(output.stops.every(stop=>stop.id!==rows[0].id&&stop.id!==rows[1].id));
  const noEvidence=await compose(sourceRows().map(row=>({...row,sources:[]})),['second_hand'],'full');
  assert.equal(noEvidence.stops.length,0);
  const closed=await compose(sourceRows().map(row=>({...row,opening_hours:'Mo-Su off'})),['second_hand'],'full');
  assert.equal(closed.stops.length,0);
});
