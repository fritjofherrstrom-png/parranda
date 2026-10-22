/** Real mounted planner, controlled HTTP replies; no provider/runtime acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPlanner } from './helpers/planner-harness.mjs';
const DATE = '2026-10-17', NEXT = '2026-10-18', LAST = 'parranda:anywhere:last';
const ID = `live:${DATE}:${'a'.repeat(32)}`, OTHER = `live:${DATE}:${'b'.repeat(32)}`;
const URL = 'http://localhost/anywhere?place=Fixture%20Town&lang=en';
const stable = [{ id: 'museum', label: 'Fixture Museum', type: 'museum', lat: 59.333, lng: 18.065, commitment_eligible: true, covered_preferences: ['culture'] }, { id: 'lunch', label: 'Fixture Lunch', type: 'restaurant', lat: 59.334, lng: 18.066, commitment_eligible: true, covered_preferences: ['food'] }];
function event(extra = {}) { return { id: 'source-event', title: 'Evening concert', live_occurrence_id: ID, live_choice_eligible: true, occurrence_date: DATE, starts_at: `${DATE}T18:00:00Z`, timezone: 'Europe/Stockholm', lat: 59.335, lng: 18.067, source_label: 'Source', source_url: 'https://example.org/event', ...extra }; }
function live(events = [event()]) { return { coverage: 'covered', selected_date: DATE, pending: false, tonight: events, this_week: events, acquisition: { source_health: { status: 'healthy', result: 'events_found', reasons: [], selected_source_count: 1, responding_source_count: 1, event_bearing_source_count: 1, empty_source_count: 0, failed_source_count: 0, unavailable_source_count: 0, raw_event_count: events.length, normalized_event_count: events.length, accepted_event_count: events.length, surfaced_event_count: events.length, rejected_event_count: 0 } } }; }
function day({ events = [event()], chosen = null, stops = stable, edit = null, pending = false } = {}) { const occurrence = chosen ? event({ live_occurrence_id: chosen, id: chosen === OTHER ? 'second' : 'source-event', title: chosen === OTHER ? 'Second concert' : 'Evening concert' }) : null; const published = [...stops, ...(occurrence ? [{ ...occurrence, id: `live-event-${occurrence.id}`, label: occurrence.title, is_live_event: true }] : [])]; return { days: [{ date: DATE, experimental_agnostic_route_applied: true, primary_route: { id: '__agnostic_compose__', title: 'Fixture day', estimated_km: 1, main_stops: published, map_route_points: [], map_path_points: [], legs: [] }, alternatives: [] }], place_structure: { provenance: 'agnostic_anchor', area_count: 1, areas: [], district_day: { areas: [], evening_event: occurrence ? { ...occurrence, woven_into_route: true } : null } }, agnostic_route_output_experiment: { intake: { query: 'Fixture Town' }, promotion: { promote: true }, source_status: { anchor: { lat: 59.333, lng: 18.065 } }, ...(edit ? { day_edit: { status: 'applied', ...edit } } : {}) }, live_events: { ...live(events), pending }, ...(pending ? { live_completion: { version: 1, token: 'c'.repeat(48), expires_in_ms: 120000, route_upgrade: 'explicit_request' } } : {}) }; }
const routes = h => h.fetchMock.calls.filter(c => c.url.includes('route-recommendations'));
const buttons = (h, label) => [...h.container.querySelectorAll('button')].filter(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label);
async function click(h, label) { const b = buttons(h, label)[0]; assert.ok(b, `actual '${label}' button`); await h.act(() => b.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))); return b; }
async function start(t, body = day(), options = {}) { t.mock.timers.enable({ apis: ['Date'], now: new Date(`${DATE}T10:00:00Z`) }); const { manualTeardown, ...mountOptions } = options; const h = await mountPlanner({ url: URL, ...mountOptions }); if (!options.manualTeardown)
    t.after(() => h.unmount()); await h.fetchMock.respond(routes(h)[0], body); return h; }
async function open(h, events = [event()]) { await click(h, buttons(h, 'See all live').length ? 'See all live' : 'Explore live'); const q = h.fetchMock.calls.filter(c => c.url.startsWith('/api/live-events')).at(-1); if (q && !q.answered)
    await h.fetchMock.respond(q, { contract: 'live_event_query_v1', route_mutation: false, day_anchor_mutation: false, live_events: live(events) }); }
const routeText = h => h.container.querySelector('section[aria-label="The route"]')?.textContent || '';
// Removing the real selection control or bypassing commitment dispatch breaks this journey.
test('Live occurrence selection closes modal, focuses day status and composes once; Undo restores exact answer without POST', async (t) => {
    const h = await start(t, day({ events: [event(), event({ id: 'second', title: 'Second concert', live_occurrence_id: OTHER })] }));
    const before = h.readStorage(LAST);
    await open(h);
    const [action, competingAction] = buttons(h, 'Plan with this event');
    assert.ok(action, 'selectable actual occurrence has an action');
    await h.act(() => { action.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })); action.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })); });
    assert.equal(h.container.querySelector('[role="dialog"]'), null);
    assert.equal(h.window.document.activeElement?.getAttribute('role'), 'status');
    await h.clock.advance(400);
    assert.equal(routes(h).length, 2);
    assert.deepEqual(routes(h)[1].body.live_event_choices, [{ occurrence_id: ID, action: 'keep' }]);
    assert.ok(!routes(h)[1].body.pinned_candidate_ids?.includes(ID));
    await h.fetchMock.respond(routes(h)[1], day({ chosen: ID }));
    assert.match(routeText(h), /Evening concert/);
    assert.equal(h.readStorage(LAST).commitments.entries[ID].kind, 'pin');
    await click(h, 'Undo');
    await h.clock.advance(1000);
    assert.equal(routes(h).length, 2);
    assert.equal(h.readStorage(LAST).id, before.id);
    assert.deepEqual(h.readStorage(LAST).commitments, before.commitments);
    assert.doesNotMatch(routeText(h), /Evening concert/);
});
// Parent series and weak/other-day metadata may not manufacture a selectable slot.
test('series selects exact source slot in both sort modes and hides missing/false/other-day choices', async (t) => {
    const slots = [event(), event({ id: 'second', live_occurrence_id: OTHER, starts_at: `${DATE}T20:00:00Z` })];
    const invalid = [event({ id: 'no-eligibility', live_choice_eligible: undefined }), event({ id: 'no-date', occurrence_date: undefined }), event({ id: 'malformed', live_occurrence_id: 'unissued' }), event({ id: 'weak', live_choice_eligible: false }), event({ id: 'missing', live_occurrence_id: undefined }), event({ id: 'wrong', occurrence_date: NEXT }), event({ id: 'wrong-id-date', live_occurrence_id: `live:${NEXT}:${'e'.repeat(32)}` })];
    const series = event({ id: 'series', title: 'Concert series', occurrences: slots });
    const h = await start(t, day({ events: [series, ...invalid] }));
    await open(h, [series, ...invalid]);
    assert.equal(buttons(h, 'Plan with this event').length, 2, 'only two actual slots, no selectable parent');
    await click(h, 'By time');
    const controls = buttons(h, 'Plan with this event');
    assert.equal(controls.length, 2);
    await h.act(() => controls[1].dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
    await h.clock.advance(400);
    assert.deepEqual(routes(h).at(-1).body.live_event_choices, [{ occurrence_id: OTHER, action: 'keep' }]);
});
for (const failure of ['missing', 'different', 'no-route', 'transport', 'capacity'])
    test(`unfulfilled selection (${failure}) retains published day and offers explicit recovery plus exact Undo`, async (t) => {
        const h = await start(t);
        const before = h.readStorage(LAST);
        await open(h);
        await click(h, 'Plan with this event');
        await h.clock.advance(400);
        const req = routes(h).at(-1);
        if (failure === 'transport')
            await h.act(() => req.rejectResponse(new Error('network')));
        else
            await h.fetchMock.respond(req, failure === 'no-route' ? { days: [] } : failure === 'capacity' ? { error: 'busy', retry_after_seconds: 3 } : day({ chosen: failure === 'different' ? OTHER : null }), failure === 'capacity' ? 429 : 200);
        assert.match(routeText(h), /Fixture Museum/);
        assert.doesNotMatch(routeText(h), /Second concert/);
        assert.equal(h.readStorage(LAST).id, before.id);
        assert.match(h.text(), /could not.*chosen event|chosen event.*could not/i);
        assert.ok(buttons(h, 'Try planning with this event again').length);
        await click(h, 'Undo');
        await h.clock.advance(500);
        assert.equal(routes(h).length, 2);
        assert.deepEqual(h.readStorage(LAST).commitments, before.commitments);
    });
test('a second explicit event replaces active Live intent while preserving stable pins and a manually shortened cap/exclusions', async (t) => {
    const extra = { id: 'park', label: 'Fixture Park', lat: 59.336, lng: 18.068, type: 'park' };
    const h = await start(t, day({ stops: [...stable, extra] }));
    const disclosure = [...h.container.querySelectorAll('button[aria-controls]')].find(b => b.textContent.includes('Fixture Museum'));
    await h.act(() => disclosure.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
    await click(h, 'Remove');
    await h.clock.advance(400);
    const shortened = routes(h).at(-1);
    const edit = { ...shortened.body.day_edit, retained_candidate_ids: ['lunch', 'park'], target_stop_count: 2 };
    await h.fetchMock.respond(shortened, day({ stops: [stable[1], extra], edit }));
    const lunch = [...h.container.querySelectorAll('button[aria-controls]')].find(b => b.textContent.includes('Fixture Lunch'));
    await h.act(() => lunch.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
    await click(h, 'Keep this one');
    await h.clock.advance(400);
    const pinned = routes(h).at(-1);
    await h.fetchMock.respond(pinned, day({ stops: [stable[1], extra], edit }));
    await open(h);
    await click(h, 'Plan with this event');
    await h.clock.advance(400);
    const req = routes(h).at(-1);
    assert.equal(req.body.day_edit.target_stop_count, 2);
    assert.equal(req.body.day_edit.preserve_retained, false);
    assert.ok(req.body.excluded_candidate_ids.includes('museum'));
    assert.ok(req.body.pinned_candidate_ids.includes('lunch'));
    await h.fetchMock.respond(req, day({ chosen: ID, events: [event({ id: 'second', title: 'Second concert', live_occurrence_id: OTHER })], stops: [stable[1]], edit }));
    await open(h, [event({ id: 'second', title: 'Second concert', live_occurrence_id: OTHER })]);
    await click(h, 'Plan with this event');
    await h.clock.advance(400);
    const second = routes(h).at(-1);
    assert.equal(second.body.day_edit.target_stop_count, 2);
    assert.deepEqual(second.body.live_event_choices, [{ occurrence_id: OTHER, action: 'keep' }]);
    assert.ok(second.body.excluded_candidate_ids.includes('museum'));
    assert.ok(second.body.pinned_candidate_ids.includes('lunch'));
});
test('saved/reloaded selection keeps identity and rejects late completion after a newer day choice', async (t) => {
    let h = await start(t, day({ pending: true }), { manualTeardown: true });
    t.after(() => h?.unmount());
    await h.clock.advance(2000);
    const completion = h.fetchMock.calls.find(c => c.url === '/api/planner-live-completion');
    assert.ok(completion);
    await h.fetchMock.respond(completion, { live_events: live(), live_completion: { version: 1, state: 'ready', route_upgrade: 'explicit_request' } }, 200, { deferBody: true });
    await open(h);
    await click(h, 'Plan with this event');
    assert.equal(completion.aborted, true);
    await h.clock.advance(400);
    await h.fetchMock.respond(routes(h).at(-1), day({ chosen: ID }));
    await h.act(() => completion.releaseBody());
    assert.equal(h.fetchMock.calls.filter(c => c.url === '/api/planner-live-route-upgrade').length, 0);
    await click(h, 'Save');
    const saved = h.readStorage('parranda:anywhere:saved')[0];
    assert.equal(saved.commitments.entries[ID].kind, 'pin');
    const savedSection = [...h.container.querySelectorAll('section')].find(n => n.textContent.trim().startsWith('Saved days'));
    const requestCount = routes(h).length;
    await h.act(() => savedSection.querySelector('li button').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
    await h.clock.advance(500);
    assert.equal(routes(h).length, requestCount, 'restore installs its snapshot without composing');
    assert.match(routeText(h), /Evening concert/);
    await click(h, 'rebuild for fresh events');
    const rebuild = routes(h).at(-1);
    assert.deepEqual(rebuild.body.live_event_choices, [{ occurrence_id: ID, action: 'keep' }]);
    await h.fetchMock.respond(rebuild, day({ chosen: ID }));
    const last = h.readStorage(LAST), url = h.window.location.href;
    await h.unmount();
    h = null;
    h = await mountPlanner({ url, storage: { [LAST]: last }, navigationType: 'reload' });
    const reload = routes(h)[0];
    assert.deepEqual(reload.body.live_event_choices, [{ occurrence_id: ID, action: 'keep' }]);
    await h.fetchMock.respond(reload, day({ chosen: ID }));
    await click(h, 'Adjust');
    await click(h, 'Tomorrow');
    await h.clock.advance(400);
    assert.deepEqual(routes(h).at(-1).body.live_event_choices, undefined);
    await h.fetchMock.respond(routes(h).at(-1), { ...day(), days: [] });
    assert.doesNotMatch(routeText(h), /Evening concert/);
});
test('successful retry after refusal retains exact original Undo baseline and event intent', async (t) => {
    const h = await start(t);
    const original = h.readStorage(LAST);
    await open(h);
    await click(h, 'Plan with this event');
    await h.clock.advance(400);
    await h.fetchMock.respond(routes(h).at(-1), { days: [] });
    await click(h, 'Try planning with this event again');
    const retry = routes(h).at(-1);
    assert.deepEqual(retry.body.live_event_choices, [{ occurrence_id: ID, action: 'keep' }]);
    await h.fetchMock.respond(retry, day({ chosen: ID }));
    await click(h, 'Undo');
    await h.clock.advance(500);
    assert.equal(routes(h).length, 3);
    assert.deepEqual(h.readStorage(LAST), original);
});
test('a changed day rejects an already received late selection body without carrying another date keep', async (t) => {
    const h = await start(t);
    await open(h);
    await click(h, 'Plan with this event');
    await h.clock.advance(400);
    const old = routes(h).at(-1);
    await h.fetchMock.respond(old, day({ chosen: ID }), 200, { deferBody: true });
    await click(h, 'Adjust');
    await click(h, 'Tomorrow');
    assert.equal(old.aborted, true);
    await h.clock.advance(400);
    const next = routes(h).at(-1);
    assert.equal(next.body.live_event_choices, undefined);
    await h.fetchMock.respond(next, { ...day(), days: [{ ...day().days[0], date: NEXT }] });
    await h.act(() => old.releaseBody());
    assert.doesNotMatch(routeText(h), /Evening concert/);
    assert.equal(h.readStorage(LAST).dateIso, NEXT);
});
for (const action of ['Remove from day', 'Try another event'])
    test(`explicit selection supersedes previous '${action}' choice, leaving only the selected exact occurrence`, async (t) => {
        const alternate = event({ id: 'second', title: 'Second concert', live_occurrence_id: OTHER });
        const h = await start(t, day({ chosen: ID, events: [alternate] }));
        await click(h, action);
        await h.clock.advance(400);
        await h.fetchMock.respond(routes(h).at(-1), day({ events: [alternate] }));
        await open(h, [alternate]);
        await click(h, 'Plan with this event');
        await h.clock.advance(400);
        assert.deepEqual(routes(h).at(-1).body.live_event_choices, [{ occurrence_id: OTHER, action: 'keep' }]);
    });
test('restoring a saved snapshot during the selection debounce cancels busy intent and its pending compose', async (t) => {
    const h = await start(t);
    await click(h, 'Save');
    await open(h);
    await click(h, 'Plan with this event');
    const saved = [...h.container.querySelectorAll('section')].find(n => n.textContent.trim().startsWith('Saved days'));
    await h.act(() => saved.querySelector('li button').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
    await h.clock.advance(1000);
    assert.equal(routes(h).length, 1);
    assert.doesNotMatch(h.text(), /Planning the day with the chosen event/);
    assert.doesNotMatch(routeText(h), /Evening concert/);
});


test('a singleton series offers only its actual source slot rather than the representative identity', async t => {
    const series = event({ id: 'parent', title: 'One source slot', live_occurrence_id: OTHER,
        occurrences: [event({ title: undefined })] });
    const h = await start(t, day({ events: [series] }));
    await open(h, [series]);
    const actions = buttons(h, 'Plan with this event');
    assert.equal(actions.length, 1);
    assert.ok(actions[0].closest('details'), 'selection belongs to the actual occurrence list');
    await click(h, 'Plan with this event');
    await h.clock.advance(400);
    assert.deepEqual(routes(h).at(-1).body.live_event_choices, [{ occurrence_id: ID, action: 'keep' }]);
});

test('an explicit occurrence choice keeps the displayed absolute day across midnight before the debounced request', async t => {
    const h = await start(t);
    await open(h);
    t.mock.timers.tick(24 * 60 * 60 * 1000);
    await click(h, 'Plan with this event');
    await h.clock.advance(400);
    const request = routes(h).at(-1);
    assert.deepEqual(request.body.dates, [DATE]);
    assert.deepEqual(request.body.live_event_choices, [{ occurrence_id: ID, action: 'keep' }]);
});

// Adopted from the independent listed-date reproduction: one accepted source
// row can expand to several By time calendar rows without changing identity.
for (const grouped of [false, true]) test(`By time only offers the attested selected calendar row for ${grouped ? 'an array slot' : 'a listed-session row'}`, async t => {
    const sessions = event({ starts_at: undefined, ends_at: undefined, starts_on: DATE, ends_on: NEXT,
        time_window: { kind: 'occurrences', dates: [DATE, NEXT], local_start: '18:00', local_end: '20:00', timezone: 'Europe/Stockholm' } });
    const source = grouped ? event({ id: 'series', title: 'Listed source series', occurrences: [sessions] }) : sessions;
    const h = await start(t, day({ events: [source] }));
    await open(h, [source]);
    await click(h, 'By time');
    const sections = [...h.container.querySelectorAll('[role="dialog"] section')];
    assert.equal(sections.length, 2, 'both actual source-listed dates remain browsable');
    assert.equal(sections[0].getAttribute('aria-label'), 'Sat 17 Oct');
    assert.equal(sections[1].getAttribute('aria-label'), 'Sun 18 Oct');
    const selectedAction = [...sections[0].querySelectorAll('button')].find(b => b.textContent.trim() === 'Plan with this event');
    assert.ok(selectedAction, 'the attested selected-day occurrence remains actionable');
    assert.equal(Boolean(sections[1].querySelector('button')), false, 'the next-day navigation row must not silently choose the selected-day ID');
    assert.equal(routes(h).length, 1, 'browsing source-listed dates never composes');
    await h.act(() => selectedAction.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
    await h.clock.advance(400);
    assert.deepEqual(routes(h).at(-1).body.dates, [DATE]);
    assert.deepEqual(routes(h).at(-1).body.live_event_choices, [{ occurrence_id: ID, action: 'keep' }]);
});

const pendingTo = (h, endpoint) => h.fetchMock.calls.findLast(call => call.url === endpoint && !call.answered && !call.aborted);
async function coldSelection(t, {expiresInMs=120000}={}) {
    const h = await start(t);
    const previous = h.readStorage(LAST);
    await open(h);
    await click(h, 'Plan with this event');
    await h.clock.advance(400);
    const request = routes(h).at(-1);
    const pending = day({ chosen: OTHER, pending: true });
    pending.live_completion.expires_in_ms = expiresInMs;
    await h.fetchMock.respond(request, pending);
    assert.deepEqual(h.readStorage(LAST), previous, 'pending is not a published answer to the explicit choice');
    assert.doesNotMatch(routeText(h), /Second concert/);
    assert.doesNotMatch(h.text(), /chosen event could not be confirmed/);
    return {h,previous,request};
}
async function readyColdSelection(h) {
    await h.clock.advance(2000);
    const completion = pendingTo(h, '/api/planner-live-completion');
    assert.ok(completion, 'the original capability is followed while the old day is held');
    await h.fetchMock.respond(completion, { live_events: live(), live_completion: { version: 1, state: 'ready', route_upgrade: 'explicit_request' } });
    const upgrade = pendingTo(h, '/api/planner-live-route-upgrade');
    assert.ok(upgrade, 'the same producer authorizes one upgrade, not another compose');
    return {completion,upgrade};
}

test('cold explicit choice holds the old day through the bounded original completion then publishes exact applied occurrence once', async t => {
    const {h,previous} = await coldSelection(t);
    const {completion,upgrade} = await readyColdSelection(h);
    assert.deepEqual(completion.body, {token:'c'.repeat(48)});
    assert.deepEqual(upgrade.body, {token:'c'.repeat(48)});
    assert.deepEqual(h.readStorage(LAST), previous);
    await h.fetchMock.respond(upgrade, {live_route_upgrade:{version:1,state:'applied'},result:day({chosen:ID})});
    assert.match(routeText(h), /Evening concert/);
    assert.doesNotMatch(routeText(h), /Second concert/);
    assert.equal(h.readStorage(LAST).commitments.entries[ID].kind, 'pin');
    assert.doesNotMatch(JSON.stringify(h.readStorage(LAST)), new RegExp('c'.repeat(48)));
    await h.clock.advance(3000);
    assert.equal(routes(h).length,2);
    assert.equal(h.fetchMock.calls.filter(c=>c.url==='/api/planner-live-completion').length,1,'no duplicate background completion run');
    assert.equal(h.fetchMock.calls.filter(c=>c.url==='/api/planner-live-route-upgrade').length,1);
    await click(h,'Undo');
    await h.clock.advance(500);
    assert.deepEqual(h.readStorage(LAST), previous);
    assert.equal(routes(h).length,2);
});

for (const ending of ['terminal-no-upgrade','expired','not-eligible','different-applied']) test(`cold explicit choice ${ending} refuses atomically after its bounded completion`, async t => {
    const {h,previous} = await coldSelection(t);
    if (ending==='terminal-no-upgrade' || ending==='expired') {
        await h.clock.advance(2000);
        const completion=pendingTo(h,'/api/planner-live-completion'); assert.ok(completion);
        await h.fetchMock.respond(completion,ending==='expired'?{error:'expired'}:{live_events:live(),live_completion:{version:1,state:'ready',route_upgrade:'not_supported'}},ending==='expired'?410:200);
    } else {
        const {upgrade}=await readyColdSelection(h);
        await h.fetchMock.respond(upgrade,ending==='not-eligible'?{live_route_upgrade:{version:1,state:'not_eligible'}}:{live_route_upgrade:{version:1,state:'applied'},result:day({chosen:OTHER})});
    }
    assert.deepEqual(h.readStorage(LAST),previous);
    assert.doesNotMatch(routeText(h),/Second concert/);
    assert.match(h.text(),/chosen event could not be confirmed/);
    assert.ok(buttons(h,'Try planning with this event again').length);
    await click(h,'Undo'); await h.clock.advance(500); assert.equal(routes(h).length,2);
});

test('a newer day aborts a cold choice and rejects an already received late applied-upgrade body',async t=>{
    const {h}=await coldSelection(t);
    const {upgrade}=await readyColdSelection(h);
    await h.fetchMock.respond(upgrade,{live_route_upgrade:{version:1,state:'applied'},result:day({chosen:ID})},200,{deferBody:true});
    await click(h,'Adjust'); await click(h,'Tomorrow');
    assert.equal(upgrade.aborted,true);
    await h.clock.advance(400);
    const latest=routes(h).at(-1); assert.equal(latest.body.live_event_choices,undefined);
    await h.fetchMock.respond(latest,{...day(),days:[{...day().days[0],date:NEXT}]});
    await h.act(()=>upgrade.releaseBody());
    assert.doesNotMatch(routeText(h),/Evening concert/);
    assert.equal(h.readStorage(LAST).dateIso,NEXT);
});

test('navigation abort cancels the same cold completion without adding another acquisition',async t=>{
    const {h,previous}=await coldSelection(t);
    await h.clock.advance(2000);
    const completion=pendingTo(h,'/api/planner-live-completion'); assert.ok(completion);
    await h.act(()=>h.window.dispatchEvent(new h.window.Event('pagehide')));
    assert.equal(completion.aborted,true);
    await h.clock.advance(120000);
    assert.deepEqual(h.readStorage(LAST),previous);
    assert.equal(routes(h).length,2);
    assert.equal(h.fetchMock.calls.filter(c=>c.url==='/api/planner-live-route-upgrade').length,0);
});

test('an unanswered cold-choice read expires at its original capability lifetime and retains the old day',async t=>{
    const {h,previous}=await coldSelection(t,{expiresInMs:2500});
    await h.clock.advance(2000);
    const completion=pendingTo(h,'/api/planner-live-completion'); assert.ok(completion);
    await h.clock.advance(500);
    assert.equal(completion.aborted,true);
    assert.match(h.text(),/chosen event could not be confirmed/);
    assert.deepEqual(h.readStorage(LAST),previous);
    assert.equal(routes(h).length,2);
    assert.equal(h.fetchMock.calls.filter(c=>c.url==='/api/planner-live-route-upgrade').length,0);
});

test('a pending explicit choice without server upgrade authorization refuses without a completion read',async t=>{
    const h=await start(t); const previous=h.readStorage(LAST);
    await open(h); await click(h,'Plan with this event'); await h.clock.advance(400);
    const body=day({chosen:OTHER,pending:true}); body.live_completion.route_upgrade='not_supported';
    await h.fetchMock.respond(routes(h).at(-1),body);
    assert.match(h.text(),/chosen event could not be confirmed/);
    assert.deepEqual(h.readStorage(LAST),previous);
    await h.clock.advance(3000);
    assert.equal(h.fetchMock.calls.filter(c=>c.url==='/api/planner-live-completion').length,0);
    assert.equal(routes(h).length,2);
});
