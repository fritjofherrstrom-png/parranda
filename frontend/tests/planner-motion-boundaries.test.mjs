import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';

const LAST = 'parranda:anywhere:last';
const DATE = '2026-10-17';
const complete = { status: 'complete', pending: 0, failed: 0, completed: 2 };
const partial = { status: 'partial', pending: 1, failed: 0, completed: 1 };
const stops = [
  { id: 'a', label: 'Place a', lat: 55.6, lng: 13, type: 'museum', covered_preferences: ['culture'], commitment_eligible: true },
  { id: 'b', label: 'Place b', lat: 55.601, lng: 13, type: 'restaurant', covered_preferences: ['food'], commitment_eligible: true },
  { id: 'c', label: 'Place c', lat: 55.602, lng: 13, type: 'park', covered_preferences: ['views'], commitment_eligible: true },
];
function day(rows = stops, completion = partial) {
  return {
    days: [{ date: DATE, experimental_agnostic_route_applied: true, primary_route: {
      id: '__agnostic_compose__', main_stops: rows, estimated_km: 2.1, legs: [], map_route_points: [],
      map_path_points: rows.map(({lat,lng}) => ({lat,lng})),
    }, alternatives: [] }],
    agnostic_route_output_experiment: {
      intake: { status: 'resolved', resolved: { label: 'Testville' } },
      promotion: { promote: true, readiness: 'promotable' },
      source_status: { status: `loaded:${rows.length}`, collection: { source_completion: completion } },
    },
  };
}
const calls = h => h.fetchMock.calls.filter(c => c.url.startsWith('/api/route-recommendations'));
const button = (h, re) => [...h.container.querySelectorAll('button')].find(b => re.test(b.textContent.trim()));
async function click(h, target) {
  assert.ok(target, 'the actual control exists');
  await h.act(() => target.dispatchEvent(new h.window.MouseEvent('click', {bubbles:true})));
}
async function mounted(t, body = day()) {
  t.mock.timers.enable({apis:['Date'],now:new Date(`${DATE}T10:00:00Z`)});
  const h = await mountPlanner({url:'http://localhost/anywhere?place=Testville&prefs=food,culture,views&lang=en'});
  t.after(() => h.unmount());
  assert.equal(calls(h).length,1);
  await h.fetchMock.respond(calls(h)[0],body);
  return h;
}
function pick(h, name) {
  return [...h.container.querySelectorAll('ul[aria-label="Your picks in this day"] > li')].find(li => li.textContent.includes(name));
}

test('a terminal failed new-pick rebuild must not claim an active place search', async t => {
  const h = await mounted(t);
  await click(h,button(h,/^Adjust$/));
  await click(h,button(h,/^Coffee$/));
  await h.clock.advance(400);
  assert.match(pick(h,'Coffee')?.textContent || '',/finding places/,'valid precondition: Coffee really entered pending');
  await h.fetchMock.respond(calls(h).at(-1),{},500);
  assert.equal(h.container.querySelector('[data-adjust-rebuild]')?.dataset.adjustRebuild,'failed');
  assert.match(h.text(),/Couldn't update/);
  await h.clock.advance(120000);
  assert.equal(calls(h).length,2,'no further acquisition remains or starts');
  assert.match(h.text(),/Place a/,'the prior answer survives');
  assert.doesNotMatch(pick(h,'Coffee')?.textContent || '',/finding places/,'a failed rebuild is not an active search');
  assert.ok(!pick(h,'Coffee')?.querySelector('[data-ring-mark]'), 'a terminal unanswered pick has no working ring');
  assert.doesNotMatch(pick(h,'Coffee')?.textContent || '',/not in this day|in this day|partly/, 'old-day coverage must not judge the unanswered pick');
  assert.deepEqual(h.readStorage(LAST).inputs.selected, ['food','culture','views'], 'failed intent is not persisted as applied');
});

test('a new badge belongs only to added stop identity, not every matching label', async t => {
  const original = {...stops[0], label:'Common name'};
  const h = await mounted(t,day([original,stops[1],stops[2]]));
  await click(h,button(h,/^Look for more places$/));
  const extra = {...stops[0],id:'different-physical-place',lat:55.604,label:'Common name'};
  await h.fetchMock.respond(calls(h)[1],day([original,extra,stops[1],stops[2]],complete));
  assert.match(h.text(),/Looked for more places: \+1 stop/,'the identity-aware summary sees exactly one added stop');
  const rows = [...h.container.querySelectorAll('ol[aria-label="The stops, in order"] > li')];
  assert.equal(rows.length,4);
  const newMarks = row => [...row.querySelectorAll('span')].filter(span => span.textContent === 'new');
  assert.equal(newMarks(rows[1]).length,1,'positive control: added identity is marked');
  assert.equal(newMarks(rows[0]).length,0,'the existing identity must not be marked new');
});

test('source recheck Undo restores the exact answer and retries the restored frozen question', async t => {
  const h = await mounted(t);
  const original = h.readStorage(LAST);
  await click(h,button(h,/^Look for more places$/));
  assert.deepEqual(calls(h)[1].body,calls(h)[0].body);
  await h.fetchMock.respond(calls(h)[1],day([...stops,{...stops[0],id:'d',label:'Place d',lat:55.603}]));
  assert.match(h.text(),/Looked for more places: \+1 stop/);
  const undo=[...h.container.querySelectorAll('button')].find(b => b.getAttribute('aria-label')==='Undo this change');
  await click(h,undo);
  await h.clock.advance(500);
  assert.equal(calls(h).length,2,'Undo itself emits no compose');
  assert.deepEqual(h.readStorage(LAST),original);
  assert.doesNotMatch(h.text(),/Place d/);
  t.mock.timers.setTime(new Date('2026-10-18T10:00:00Z').getTime());
  await click(h,button(h,/^Look for more places$/));
  assert.equal(calls(h).length,3);
  assert.deepEqual(calls(h)[2].body,calls(h)[0].body,'all restored request fields, including absolute date');
});

test('an input change cancels a deferred source recheck body and preserves latest-intent Undo', async t => {
  const h = await mounted(t);
  const before=h.readStorage(LAST);
  await click(h,button(h,/^Look for more places$/));
  const recheck=calls(h)[1];
  await h.fetchMock.respond(recheck,day([...stops,{...stops[0],id:'old',label:'Stale addition'}],complete),200,{deferBody:true});
  await click(h,button(h,/^Adjust$/));
  await click(h,button(h,/^Coffee$/));
  assert.equal(recheck.aborted,true);
  await h.fetchMock.releaseBody(recheck);
  assert.doesNotMatch(h.text(),/Stale addition/);
  await h.clock.advance(400);
  assert.equal(calls(h).length,3);
  const extra={...stops[0],id:'coffee',label:'Coffee addition',type:'cafe',covered_preferences:['fika']};
  await h.fetchMock.respond(calls(h)[2],day([...stops,extra],complete));
  assert.match(h.text(),/Coffee addition/);
  assert.match(h.text(),/Changed: \+ Coffee/);
  assert.doesNotMatch(h.text(),/Looked for more places:/,'a newer adjustment owns the result');
  await click(h,[...h.container.querySelectorAll('button')].find(b => b.getAttribute('aria-label')==='Undo this change'));
  await h.clock.advance(500);
  assert.equal(calls(h).length,3);
  assert.deepEqual(h.readStorage(LAST),before);
});
