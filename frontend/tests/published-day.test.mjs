// Narrow mock-envelope validation controls, NOT server-publication evidence.
// The real publication → mounted recipient proof is planner-published-day.test.
import test from 'node:test';
import assert from 'node:assert/strict';
import decision from '../../anywhere-render-decision.js';
import { parsePublishedDay, readyPublishedDay, readPublishedDay, publishedDayHref, MAX_PUBLISHED_DAY_BYTES } from '../src/lib/published-day.mjs';
export const REF = 'a'.repeat(48);
const NOW = Date.parse('2026-10-25T12:00:00.000Z');
export function mockEnvelope() {
  return {version:1,ref:REF,created_at:'2026-10-25T10:00:00.000Z',expires_at:'2026-10-30T10:00:00.000Z',language:'en',
    intent:{dateIso:'2026-10-25',place:'Roma, Italia',placeLabel:'Roma, Italia',placeRef:'r41485',mode:'typed',selected:['culture'],walkKey:'balanced',excludedCandidateIds:[],pinnedCandidateIds:['missing'],liveEventChoices:[]},
    result:{days:[{date:'2026-10-25',experimental_agnostic_route_applied:true,primary_route:{id:'__agnostic_compose__',main_stops:[{id:'colosseum',label:'Colosseum',lat:41.9,lng:12.49}],map_route_points:[],map_path_points:[],legs:[],estimated_km:1}}],
      agnostic_route_output_experiment:{synthesized_via:'agnostic_compose_engine',route_mutation:true,eligibility:{eligible:true},
        intake:{mode:'place',status:'resolved',resolved:{label:'Roma, Italia',place_ref:'r41485',confidence:'high'}},
        promotion:{promote:true,readiness:'promotable',qualifying_caps:[],disqualifying_caps:[],unmet_requested_intents:[],reasons:[],blocked_caps:[]},
        pinned_candidates:{requested_count:1,honored_count:0,unhonored_count:1,unhonored:[{id:'missing',reason:'not_in_selected_day'}]}}}};
}
const options = {ref:REF,decision,now:NOW};
test('mock envelope rejects contradictory commitment verdict rather than inferring new reasons',()=>{
  const valid = mockEnvelope();
  assert.ok(parsePublishedDay(valid,options),'bounded schema control accepted');
  const bad = structuredClone(valid);
  bad.result.agnostic_route_output_experiment.pinned_candidates.honored_count = 1;
  assert.equal(parsePublishedDay(bad,options),null,'one pin cannot be both honored and refused');
});

test('mock envelopes fail closed on ref/time/schema/intent/date corruption; source reasons remain owned by server',()=>{
  const valid=mockEnvelope();
  const edits=[v=>v.version=2,v=>v.ref='b'.repeat(48),v=>v.created_at='2026-02-30T10:00:00.000Z',
    v=>v.created_at=v.expires_at,v=>v.expires_at='2026-10-25T11:00:00.000Z',v=>v.language='xx',v=>v.capability='secret',
    v=>v.intent.mode='near_me',v=>v.intent.placeRef='R41485',v=>v.intent.placeLabel='Other',v=>v.intent.selected=['culture','culture'],
    v=>v.intent.preferencePriority=['food'],v=>v.intent.walkKey='short',v=>v.intent.placeSelection='receipt',
    v=>v.intent.dateIso='2026-02-30',v=>v.result.days[0].date='2026-10-26',v=>v.intent.pinnedCandidateIds=['colosseum'],
    v=>v.result.agnostic_route_output_experiment.pinned_candidates.unhonored[0].reason='free text',
    v=>v.result.live_events={pending:true},v=>v.result.days[0].primary_route.main_stops.push(v.result.days[0].primary_route.main_stops[0])];
  for (const edit of edits) {const v=structuredClone(valid);edit(v);assert.equal(parsePublishedDay(v,options),null,String(edit));}
  const restored=parsePublishedDay(valid,options);
  assert.deepEqual(restored.entry.commitments.refusals,[{id:'missing',reason:'not_in_selected_day'}]);
  assert.equal(publishedDayHref(REF,'sv'),`/anywhere?snapshot=${REF}&lang=sv`);
  assert.equal(publishedDayHref(REF.toUpperCase(),'en'),null);
  const sidecar={version:1,state:'ready',ref:REF,created_at:valid.created_at,expires_at:valid.expires_at};
  assert.ok(readyPublishedDay(sidecar,NOW));
  for (const v of [{...sidecar,version:2},{...sidecar,ref:'b'},{...sidecar,token:'private'},{version:1,state:'unavailable'}]) assert.equal(readyPublishedDay(v,NOW),null);
  assert.equal(readyPublishedDay(sidecar,Date.parse(valid.expires_at)),null);
});

test('wire bound covers chunked UTF-8 streams, wrong lengths, malformed JSON and abort during deferred body',async()=>{
  const body=JSON.stringify(mockEnvelope());
  assert.ok(await readPublishedDay(new Response(body),options));
  for (const response of [new Response(body,{status:404}),new Response(body,{headers:{'content-length':String(MAX_PUBLISHED_DAY_BYTES+1)}}),new Response('{'),new Response(body.slice(0,-5))]) await assert.rejects(readPublishedDay(response,options));
  let cancelled=false;
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_PUBLISHED_DAY_BYTES));c.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
  await assert.rejects(readPublishedDay(new Response(stream,{headers:{'content-length':'1'}}),options));
  assert.equal(cancelled,true,'over-limit transport stops consumption even with a false length');
  let release;
  const signal=new AbortController();
  const response={ok:true,json:()=>new Promise(r=>{release=r;})};
  const pending=readPublishedDay(response,{...options,signal:signal.signal});
  signal.abort();release(mockEnvelope());await assert.rejects(pending);
});
