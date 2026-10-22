import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountPlanner} from './helpers/planner-harness.mjs';
const captured=JSON.parse(readFileSync(new URL('./fixtures/captured-terminal-place-snapshot.json',import.meta.url)));
const calls=h=>h.fetchMock.calls.filter(c=>c.url.includes('/api/route-recommendations'));

for(const lang of ['en','sv']) for(const kind of ['partial','failed','primary_failed']) {
  test(`terminal ${kind} source response explains a finished no-route result in ${lang}`,async t=>{
    const h=await mountPlanner({url:`http://localhost/anywhere?place=Testville&prefs=culture&lang=${lang}`,props:{lang}});
    t.after(()=>h.unmount());
    const data=structuredClone(captured);
    if(kind==='failed') data.agnostic_route_output_experiment.source_status.collection.source_completion={status:'complete',pending:0,completed:1,failed:1};
    if(kind==='primary_failed') data.agnostic_route_output_experiment.source_status.collection.source_completion={status:'complete',pending:0,completed:1,failed:0};
    await h.fetchMock.respond(calls(h)[0],data);
    const text=h.text();
    assert.match(text,lang==='en'?/Parranda couldn't build a day here right now/:/Parranda kunde inte bygga en dag här just nu/);
    assert.match(text,kind==='partial'
      ? lang==='en'?/incomplete when the response was produced/:/ofullständigt när svaret skapades/
      : lang==='en'?/One or more place sources failed/:/En eller flera platskällor misslyckades/);
    assert.doesNotMatch(text,/on their way|still being fetched|hämtas fortfarande|är på väg|snart.*rutt/i);
    const retry=[...h.container.querySelectorAll('button')].find(b=>b.textContent.trim()===(lang==='en'?'Try again':'Försök igen'));
    assert.ok(retry,'a terminal response offers deliberate recovery even with diagnostic areas');
    await h.clock.advance(120000);
    assert.equal(calls(h).length,1,'terminal publication never starts a retry loop');
    await h.act(()=>retry.dispatchEvent(new h.window.Event('click',{bubbles:true})));
    assert.equal(calls(h).length,2);
    assert.deepEqual(calls(h)[1].body.dates,calls(h)[0].body.dates,'manual retry retains absolute date');
    assert.deepEqual(calls(h)[1].body.preferences,['culture']);
  });
}
