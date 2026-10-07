const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, statSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createPlaceSelectionStore } = require('../server/place-candidates/place-selection');
const { resolveAgnosticIntake } = require('../server/planner/agnostic-place-intake');
const choice = label => ({label, lat:48.85, lng:2.32, confidence:'medium',provenance:'test_geocoder',
  osm_ref:'relation/1',admin_context:{ locality:'Example City',country_code:'fr' },
  spatial_scope:{source:'nominatim_bounds',kind:'district',bounds:{south:48.84,north:48.87,west:2.31,east:2.34}}});
const QUERY = 'Harbour Quarter';

test('selection retains exact server facts without calling the place provider again', async () => {
  const store=createPlaceSelectionStore();
  const token=store.issue(choice('Harbour Quarter, Example City'),QUERY);
  const out=await resolveAgnosticIntake({placeQuery:QUERY,placeSelection:token,placeSelectionStore:store,placeResolver:()=>{throw Error('must not resolve again');}});
  assert.equal(out.intake.status,'resolved');
  assert.equal(out.intake.resolved.label,'Harbour Quarter, Example City');
  assert.equal(out.intake.resolved.selection_id,token);
  assert.equal(out.spatialScope.kind,'district');
});
test('tampering, changed query and expiry cannot replace the trusted destination', async () => {
  let time=1000; const store=createPlaceSelectionStore({now:()=>time});
  const token=store.issue(choice('Chosen area'),QUERY);
  for(const [selection,query] of [[token.slice(0,-3)+'abc',QUERY],[token,'Other place']]) {
    const out=await resolveAgnosticIntake({placeQuery:query,placeSelection:selection,placeSelectionStore:store,placeResolver:async()=>[choice('Different place')]});
    assert.equal(out.anchor,null);assert.deepEqual(out.intake.blockers,['place_selection_invalid']);
  }
  time+=8*24*60*60*1000;
  assert.equal(store.read(token,QUERY),null);
});
test('persistent key preserves choices across restart and never exposes raw provider objects', () => {
  const dir=mkdtempSync(join(tmpdir(),'parranda-selection-'));
  try {
    const a=createPlaceSelectionStore({cacheDir:dir});
    const token=a.issue({...choice('Chosen area'),raw_secret:'not allowed'},QUERY);
    const b=createPlaceSelectionStore({cacheDir:dir});
    assert.equal(b.read(token,QUERY).label,'Chosen area');
    assert.equal(b.read(token,QUERY).raw_secret,undefined);
    assert.equal(statSync(join(dir,'.place-selection-key')).mode & 0o777,0o600);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('ambiguous candidates become selectable and a choice survives later provider ambiguity', async () => {
  const store=createPlaceSelectionStore();
  const out=await resolveAgnosticIntake({placeQuery:QUERY,placeSelectionStore:store,placeResolver:async()=>[choice('Area, First City'),{...choice('Area, Second City'),lat:51.5}]});
  assert.equal(out.intake.candidates.length,2);
  assert.ok(out.intake.candidates[1].selection_id);
  const selected=await resolveAgnosticIntake({placeQuery:QUERY,placeSelectionStore:store,placeSelection:out.intake.candidates[1].selection_id});
  assert.deepEqual(selected.anchor,{lat:51.5,lng:2.32});
});
test('explicit GPS anchor ignores place selections and geographic hints',async()=>{
  const out=await resolveAgnosticIntake({coords:{lat:10,lng:20},placeQuery:QUERY,placeSelection:'forged',placeSelectionStore:createPlaceSelectionStore()});
  assert.deepEqual(out.anchor,{lat:10,lng:20});
});
test('prior verified selection can bias a different query without becoming its identity',async()=>{
  const store=createPlaceSelectionStore();const token=store.issue(choice('First area'),QUERY);let context;
  const out=await resolveAgnosticIntake({placeQuery:'New district',placeSelectionStore:store,placeContextSelection:token,placeResolver:async(q,c)=>{context=c;return[];}});
  assert.deepEqual(context.near,{lat:48.85,lng:2.32});assert.equal(out.anchor,null);
});
test('explicit malformed falsy selections cannot silently resolve another identity',async()=>{
 const store=createPlaceSelectionStore();
 for(const selection of ['',false,0,null]) {
  const out=await resolveAgnosticIntake({placeQuery:QUERY,placeSelection:selection,placeSelectionStore:store,placeResolver:async()=>[choice('Different place')]});
  assert.equal(out.anchor,null);assert.deepEqual(out.intake.blockers,['place_selection_invalid']);
 }
});
