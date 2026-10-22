import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { inertOutside, tabbableWithin } from '../src/lib/modal-focus.mjs';
import { mountPlanner } from './helpers/planner-harness.mjs';

// The Live sheet is aria-modal. Its old focus wrap missed <summary> and
// counted links inside a closed <details>, so Tab left the sheet for the page
// behind it. Mounted component with controlled transport, not a real browser.

test('tab order skips closed-details content and counts the summary', () => {
  const { window } = new JSDOM(`<div id="sheet">
    <button id="close">Close</button>
    <button disabled>Off</button>
    <a id="source" href="https://example.test">Source</a>
    <a>No href</a>
    <span tabindex="-1">Programmatic only</span>
    <span id="custom" tabindex="0">Custom</span>
    <a hidden href="https://example.test/hidden">Hidden</a>
    <details><summary id="more">Show 2 more events</summary><a href="https://example.test/inside">Inside</a></details>
  </div>`);
  const ids = tabbableWithin(window.document.getElementById('sheet')).map(el => el.id);
  assert.deepEqual(ids, ['close', 'source', 'custom', 'more']);
  window.document.querySelector('details').open = true;
  assert.equal(tabbableWithin(window.document.getElementById('sheet')).at(-1).textContent, 'Inside');
});

test('inertOutside covers every sibling up to body and undoes only its own changes', () => {
  const { window } = new JSDOM(`<body><nav id="nav"></nav><main id="main"><p id="text"></p>
    <div id="layer"><div id="backdrop"></div><div id="dialog"></div></div></main><aside id="already" inert></aside></body>`);
  const $ = id => window.document.getElementById(id);
  const restore = inertOutside($('layer'));
  for (const id of ['nav', 'text', 'already']) assert.ok($(id).hasAttribute('inert'), `${id} is inert`);
  for (const id of ['main', 'layer', 'backdrop', 'dialog']) assert.equal($(id).hasAttribute('inert'), false, `${id} stays live`);
  restore();
  for (const id of ['nav', 'text']) assert.equal($(id).hasAttribute('inert'), false, `${id} is live again`);
  assert.ok($('already').hasAttribute('inert'), 'a pre-existing inert is not lifted');
});

const day = {
  days: [{ experimental_agnostic_route_applied: true, primary_route: {
    id: '__agnostic_compose__', title: 'Published day', main_stops: [
      { id: 'a', label: 'Museum', lat: 60.17, lng: 24.94 },
      { id: 'b', label: 'Cafe', lat: 60.172, lng: 24.942 },
    ], estimated_km: 2, map_path_points: [], legs: [], confidence: 'low',
  }, alternatives: [] }],
  live_events: { selected_date: '2026-06-29', coverage: 'covered', pending: false,
    acquisition: { source_health: { status: 'healthy', result: 'events_found', reasons: [],
      selected_source_count: 1, responding_source_count: 1, accepted_event_count: 1 } },
    tonight: [{ id: 'concert', title: 'Selected-day concert', timezone: 'Europe/Helsinki', starts_at: '2026-06-29T18:00:00Z',
      source_label: 'Official calendar', source_url: 'https://calendar.example/concert' }], this_week: [] },
  agnostic_route_output_experiment: { promotion: { promote: true }, source_status: { anchor: { lat: 60.17, lng: 24.94 } } },
};

test('the open Live sheet makes the page behind inert, wraps Tab and hands focus back on Escape', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], day);
  await h.clock.advance(50);
  const trigger = [...h.container.querySelectorAll('button')].find(b => /See all live/.test(b.textContent));
  assert.ok(trigger, 'the day offers the Live sheet');
  trigger.focus();
  await h.act(() => trigger.dispatchEvent(new h.window.Event('click', { bubbles: true })));
  await h.clock.advance(50);

  const dialog = h.container.querySelector('[role="dialog"]');
  assert.ok(dialog, 'the sheet is open');
  assert.equal(dialog.closest('[inert]'), null, 'the sheet itself stays reachable');
  assert.ok(h.container.querySelector('nav').closest('[inert]'), 'the app bar behind the sheet is inert');
  assert.ok(trigger.closest('[inert]'), 'the trigger behind the sheet is inert');

  const tabbable = tabbableWithin(dialog);
  const press = (key, shiftKey = false) => h.act(() => h.window.dispatchEvent(
    new h.window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })));
  tabbable.at(-1).focus();
  await press('Tab');
  assert.equal(h.document.activeElement, tabbable[0], 'Tab from the last control wraps to the first');
  await press('Tab', true);
  assert.equal(h.document.activeElement, tabbable.at(-1), 'Shift+Tab from the first wraps to the last');
  h.document.body.focus();
  await press('Tab');
  assert.ok(dialog.contains(h.document.activeElement), 'focus outside the sheet is pulled back in');

  await press('Escape');
  await h.clock.advance(50);
  assert.equal(h.container.querySelector('[role="dialog"]'), null, 'Escape closes the sheet');
  assert.equal(h.container.querySelector('[inert]'), null, 'nothing stays inert after closing');
  assert.equal(h.document.activeElement, trigger, 'focus returns to the trigger');
});
