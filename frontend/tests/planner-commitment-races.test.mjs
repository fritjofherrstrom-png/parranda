/**
 * The commitment races, driven against the REAL component.
 *
 * Every commitment bug found after Slice 04 shipped was an ordering problem —
 * a click, a 400ms debounce, an in-flight request, a restore, a silent
 * follow-up — and every one of them passed the source-text wiring tests that
 * were supposed to cover this surface. A regex can prove a line exists; it
 * cannot prove what happens when two of those lines run in the wrong order.
 *
 * So these mount the component in jsdom, hold requests in flight deliberately,
 * and step the clock rather than sleeping through it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";
import { freezeComposeDateIso } from "../src/lib/anywhere-payload.mjs";

const NOTICE = /could not fit in this day/i;
const KEPT_LEDGER = /\d+ places? kept/;

test("one compose intent keeps its local date when a follow-up crosses midnight", () => {
  const beforeMidnight = new Date("2026-08-24T23:59:59");
  const afterMidnight = new Date("2026-08-25T00:00:01");
  const frozen = freezeComposeDateIso({ dayOffset: 0, now: beforeMidnight });

  assert.equal(frozen, "2026-08-24");
  assert.equal(
    freezeComposeDateIso({ dayOffset: 0, now: afterMidnight, dateIsoOverride: frozen }),
    frozen,
    "a silent follow-up answers the original day rather than silently becoming tomorrow",
  );
});

test("request, saved entry, snapshot key and silent follow-up share the frozen date", () => {
  const source = readFileSync(new URL("../src/components/AnywherePlanner.tsx", import.meta.url), "utf8");
  assert.match(source, /const effectiveDateIso = freezeComposeDateIso\(/);
  assert.match(source, /dates: \[effectiveDateIso\]/);
  assert.match(source, /dateIso: effectiveDateIso/);
  assert.match(source, /dayKey: savedEntryId\(\{[\s\S]*?dateIso: effectiveDateIso,[\s\S]*?walkKey: effectiveWalkKey/);
  assert.match(source, /dateIsoOverride: effectiveDateIso/);
});

function stop(id) {
  return {
    id,
    label: `Place ${id}`,
    lat: 41.9,
    lng: 12.49,
    type: "restaurant",
    tags: [],
    trust: { source_tier: "inferred", confidence: "low" },
    provenance: { attribution: [{ provider_id: "osm", label: "osm" }] },
  };
}

/** A response the decision module accepts as a real composed day. */
function composedDay(stopIds) {
  return {
    days: [
      {
        date: "2026-08-23",
        experimental_agnostic_route_applied: true,
        primary_route: {
          id: "__agnostic_compose__",
          title: "Plan",
          summary: "s",
          estimated_km: 1.2,
          main_stops: stopIds.map(stop),
          map_route_points: [],
          map_path_points: [],
          legs: [],
          confidence: "low",
          trust_summary: { source_tiers: ["inferred"], confidence: "low" },
        },
        alternatives: [],
      },
    ],
    // A nearby candidate the day did NOT choose, so "Add to my day" has
    // something real to commit to. Committing to a place already on screen
    // could never produce a premature verdict — the very bug under test only
    // bites when the commitment is absent from the rendered day.
    place_structure: {
      provenance: "agnostic_anchor",
      area_count: 1,
      areas: [],
      district_day: {
        areas: [
          {
            center: { lat: 41.9, lng: 12.49 },
            covers: ["food"],
            size: 1,
            stop_ids: ["outsider"],
            stop_names: ["Place outsider"],
            stops: [
              // Declared committable by the server, which is now what makes Add
              // appear at all — these tests are about WHEN a verdict may be
              // shown, so the commitment has to be offerable in the first place.
              {
                id: "outsider",
                name: "Place outsider",
                lat: 41.9002,
                lng: 12.49,
                type: "cafe",
                tags: [],
                commitment_eligible: true,
              },
            ],
          },
        ],
      },
    },
    agnostic_route_output_experiment: { promotion: { promote: true } },
  };
}

/** A composed day plus the server's own verdict on the commitments it carried. */
function composedDayWithRefusals(stopIds, unhonored) {
  const day = composedDay(stopIds);
  day.agnostic_route_output_experiment.pinned_candidates = {
    requested_count: unhonored.length,
    honored_count: 0,
    unhonored_count: unhonored.length,
    unhonored,
  };
  return day;
}

/** A response with candidates but no route: structure_only. */
function structureOnly() {
  return {
    days: [],
    place_structure: {
      provenance: "agnostic_anchor",
      area_count: 1,
      areas: [{ size: 2, center: { lat: 41.9, lng: 12.49 }, member_ids: ["x", "y"] }],
      district_day: {
        areas: [
          {
            center: { lat: 41.9, lng: 12.49 },
            covers: ["food"],
            size: 2,
            stop_ids: ["x", "y"],
            stop_names: ["Place x", "Place y"],
            // No commitment_eligible: true here, deliberately. structure_only
            // means promotion was withheld, and a withheld day authorises
            // nothing — a pin in that state comes back day_not_published every
            // time. A fixture declaring otherwise is a payload the server
            // cannot produce.
            stops: [
              { id: "x", name: "Place x", lat: 41.9, lng: 12.49, type: "restaurant", tags: [], commitment_eligible: false },
              { id: "y", name: "Place y", lat: 41.9001, lng: 12.49, type: "cafe", tags: [], commitment_eligible: false },
            ],
          },
        ],
      },
    },
    agnostic_route_output_experiment: {},
  };
}

/** Mount, compose one day, and hand back the harness ready for interaction. */
async function plannerWithDay(stopIds = ["a", "b", "c"], options = {}) {
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&lang=en", ...options });
  await h.clock.advance(500);
  const first = h.fetchMock.pending()[0];
  assert.ok(first, "the planner composes on arrival with ?place=");
  await h.fetchMock.respond(first, composedDay(stopIds));
  await h.clock.advance(50);
  return h;
}

function buttonMatching(h, pattern) {
  return [...h.container.querySelectorAll("button")].find((b) => pattern.test(b.textContent || ""));
}

async function click(h, button) {
  assert.ok(button, "the control under test exists");
  await h.act(() => {
    button.dispatchEvent(new h.window.Event("click", { bubbles: true }));
  });
}

test('cold Planner renders an honest wait then the real day after one submission', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const initial = h.fetchMock.pending()[0];
  const frozenInput = structuredClone(initial.body);
  const token = 'a'.repeat(48);
  await h.fetchMock.respond(initial, { planner_lifecycle: {
    version: 1, state: 'warm_pending', token, retry_after_ms: 3000, remaining_ms: 50000, max_polls: 20,
  } }, 202);
  assert.match(h.text(), /plan will continue automatically/i);
  assert.ok(!h.text().includes('Place a'));
  await h.clock.advance(3000);
  const poll = h.fetchMock.pending().find(call => call.url === '/api/planner-status');
  assert.deepEqual(poll.body, { token });
  await h.fetchMock.respond(poll, composedDay(['a', 'b']));
  assert.match(h.text(), /Place a/);
  assert.doesNotMatch(h.text(), /plan will continue automatically/i);
  await h.clock.advance(10000);
  assert.equal(h.fetchMock.calls.filter(call => call.url.includes('route-recommendations')).length, 1);
  assert.deepEqual(initial.body, frozenInput);
});

test('an adjustment cancels cold polling immediately, before debounce, and ignores a late body', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const initial = h.fetchMock.pending()[0];
  await h.fetchMock.respond(initial, { planner_lifecycle: {
    version: 1, state: 'warm_pending', token: 'b'.repeat(48), retry_after_ms: 3000, remaining_ms: 50000, max_polls: 20,
  } }, 202);
  await h.clock.advance(3000);
  const poll = h.fetchMock.pending().find(call => call.url === '/api/planner-status');
  await h.fetchMock.respond(poll, composedDay(['old-a', 'old-b']), 200, { deferBody: true });
  await click(h, buttonMatching(h, /Adjust/));
  await click(h, buttonMatching(h, /Tomorrow/));
  assert.doesNotMatch(h.text(), /plan will continue automatically/i, 'cancelled waiting copy disappears before debounce');
  await h.fetchMock.releaseBody(poll);
  assert.doesNotMatch(h.text(), /Place old-a/);
  await h.clock.advance(400);
  const next = h.fetchMock.pending().filter(call => call.url.includes('route-recommendations')).at(-1);
  assert.ok(next);
  assert.notDeepEqual(next.body.dates, initial.body.dates);
  await h.fetchMock.respond(next, composedDay(['new-a', 'new-b']));
  assert.match(h.text(), /Place new-a/);
});

test('a terminal cold timeout offers one explicit retry with the current inputs', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const initial = h.fetchMock.pending()[0];
  const token = 'c'.repeat(48);
  await h.fetchMock.respond(initial, { planner_lifecycle: {
    version: 1, state: 'warm_pending', token, retry_after_ms: 3000, remaining_ms: 500, max_polls: 20,
  } }, 202);
  await h.clock.advance(50);
  assert.match(h.text(), /engine isn't answering/i);
  await click(h, buttonMatching(h, /Adjust/));
  await click(h, buttonMatching(h, /Tomorrow/));
  await click(h, buttonMatching(h, /^Coffee$/));
  await click(h, buttonMatching(h, /^Short/));
  const retry = buttonMatching(h, /try building the day again/i);
  assert.ok(retry, 'terminal timeout provides a real retry action');
  const oldStatusCalls = h.fetchMock.calls.filter(call => call.url === '/api/planner-status' && call.method === 'POST').length;
  const routeCallsBefore = h.fetchMock.calls.filter(call => call.url.includes('route-recommendations')).length;
  await h.act(() => {
    retry.dispatchEvent(new h.window.Event('click', { bubbles: true }));
    retry.dispatchEvent(new h.window.Event('click', { bubbles: true }));
  });
  const next = h.fetchMock.pending().filter(call => call.url.includes('route-recommendations')).at(-1);
  assert.ok(next, 'retry starts one new planner execution');
  assert.notDeepEqual(next.body.dates, initial.body.dates);
  assert.ok(next.body.preferences.includes('fika'));
  assert.notEqual(next.body.walking_km_target, initial.body.walking_km_target);
  assert.equal(h.fetchMock.calls.filter(call => call.url.includes('route-recommendations')).length, routeCallsBefore + 1);
  await h.clock.advance(400);
  assert.equal(h.fetchMock.calls.filter(call => call.url.includes('route-recommendations')).length, routeCallsBefore + 1, 'retry consumes the pending debounce');
  assert.equal(h.fetchMock.calls.filter(call => call.url === '/api/planner-status' && call.method === 'POST').length, oldStatusCalls);
  const cancellation = h.fetchMock.calls.find(call => call.url === '/api/planner-status' && call.method === 'DELETE');
  assert.deepEqual(cancellation?.body, { token });
  await h.fetchMock.respond(next, composedDay(['retry-a', 'retry-b']));
  assert.match(h.text(), /Place retry-a/);
});

test('a timed-out update keeps the old day and offers an explicit update retry', async t => {
  const h = await plannerWithDay(['a', 'b']);
  t.after(() => h.unmount());
  await click(h, buttonMatching(h, /Adjust/));
  await click(h, buttonMatching(h, /Tomorrow/));
  await h.clock.advance(400);
  const update = h.fetchMock.pending().filter(call => call.url.includes('route-recommendations')).at(-1);
  const changedDates = [...update.body.dates];
  await h.fetchMock.respond(update, { planner_lifecycle: {
    version: 1, state: 'warm_pending', token: 'd'.repeat(48), retry_after_ms: 3000, remaining_ms: 500, max_polls: 20,
  } }, 202);
  await h.clock.advance(50);
  assert.match(h.text(), /Couldn't update — showing your previous day/);
  assert.match(h.text(), /Place a/);
  const retry = buttonMatching(h, /try updating again/i);
  assert.ok(retry, 'a held day also has a direct recovery action');
  await click(h, retry);
  const next = h.fetchMock.pending().filter(call => call.url.includes('route-recommendations')).at(-1);
  assert.deepEqual(next.body.dates, changedDates);
  await h.fetchMock.respond(next, composedDay(['fresh-a', 'fresh-b']));
  assert.match(h.text(), /Place fresh-a/);
});

/** Open a stop's disclosure and press Keep. */
async function keepFirstStop(h) {
  const disclosure = [...h.container.querySelectorAll("button")].find((b) =>
    /Place a/.test(b.textContent || ""),
  );
  await click(h, disclosure);
  await click(h, buttonMatching(h, /Keep this one/));
}

/**
 * Add the nearby candidate the composed day did not choose.
 *
 * This is the commitment shape the debounce bug actually bit on: the place is
 * absent from the rendered stops, so a verdict computed against the day on
 * screen reads "could not fit" the instant it is clicked.
 */
async function addOutsider(h) {
  await click(h, buttonMatching(h, /detour ideas? near your route/));
  await click(h, buttonMatching(h, /^Place outsider/));
  await click(h, buttonMatching(h, /Add to my day/));
}

// --------------------------------------------------------------------------

test("the debounce boundary is exactly where it claims to be", async (t) => {
  const h = await plannerWithDay();
  t.after(() => h.unmount());

  assert.ok(!NOTICE.test(h.text()), "precondition: a clean composed day");
  const before = h.fetchMock.calls.length;

  await addOutsider(h);
  assert.match(h.text(), KEPT_LEDGER, "the commitment is acknowledged at once");

  // 399ms: the debounce has NOT fired. No request exists, so the day on screen
  // has not been asked about this commitment and cannot answer for it.
  await h.clock.advance(399);
  assert.equal(h.fetchMock.calls.length, before, "no request at 399ms");
  assert.ok(!NOTICE.test(h.text()), "and therefore no verdict at 399ms");

  // 400ms: it fires. Still no verdict — now because the answer is outstanding.
  await h.clock.advance(1);
  assert.equal(h.fetchMock.calls.length, before + 1, "the request leaves at 400ms");
  assert.ok(!NOTICE.test(h.text()), "no verdict while the answer is outstanding");
});

test("an in-flight request never accuses the day on screen", async (t) => {
  const h = await plannerWithDay();
  t.after(() => h.unmount());

  await addOutsider(h);
  await h.clock.advance(500);

  const inFlight = h.fetchMock.pending()[0];
  assert.ok(inFlight, "the recompose actually left");
  assert.deepEqual(inFlight.body.pinned_candidate_ids, ["outsider"], "carrying the commitment");

  // Held open deliberately: this is the whole window between asking and being
  // answered, and the previous day is still what the user is looking at.
  assert.ok(!NOTICE.test(h.text()), "no verdict while the answer is outstanding");
});

test("a verdict appears only once a day has answered for the pin", async (t) => {
  const h = await plannerWithDay();
  t.after(() => h.unmount());

  await addOutsider(h);
  await h.clock.advance(500);
  const inFlight = h.fetchMock.pending()[0];

  // The day comes back WITHOUT the added place. Now — and only now — is there
  // evidence that the commitment could not be met.
  await h.fetchMock.respond(inFlight, composedDay(["a", "b", "c"]));
  await h.clock.advance(50);

  assert.match(h.text(), NOTICE, "the unmet commitment is reported");
  assert.match(h.text(), /Place outsider/, "and named");
});

test("a day that DOES honour the pin says nothing", async (t) => {
  const h = await plannerWithDay();
  t.after(() => h.unmount());

  await addOutsider(h);
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], composedDay(["outsider", "b", "c"]));
  await h.clock.advance(50);

  assert.ok(!NOTICE.test(h.text()), "an honoured commitment is not worth a sentence");
});

test("a failed request produces no verdict at all", async (t) => {
  const h = await plannerWithDay();
  t.after(() => h.unmount());

  await addOutsider(h);
  await h.clock.advance(500);
  const inFlight = h.fetchMock.pending()[0];

  await h.fetchMock.respond(inFlight, { error: "capacity" }, 503);
  await h.clock.advance(50);

  // Nothing was composed, so nothing can be said about the commitment. Before
  // this, the failure path left zero stops on screen while the live ledger
  // still held the pin, and every pin read as unmet.
  assert.ok(!NOTICE.test(h.text()), "a transport failure is not evidence about the user's choices");
});

test("structure_only offers nothing to commit to, and claims nothing either", async (t) => {
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&lang=en" });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], structureOnly());
  await h.clock.advance(50);

  // The candidates are real and stay visible as ideas...
  await click(h, buttonMatching(h, /^Place x/));
  assert.match(h.text(), /Place x/);
  // ...but promotion was withheld, so nothing here can accept a commitment. A
  // pin in this state is refused with day_not_published every time, so offering
  // the verb would be offering a guaranteed round trip to a refusal.
  assert.ok(!buttonMatching(h, /Add to my day/), "no commitment is offered where none can be honoured");
  assert.ok(!NOTICE.test(h.text()), "and with no day, nothing is claimed about fitting into one");
});

test("a commitment made on a real day is not judged by a later dayless one", async (t) => {
  // The case the old version of the test above was reaching for, now that a
  // commitment can no longer be created from structure_only itself: carry one
  // in from a composed day and let the next answer arrive without a day.
  const h = await plannerWithDay();
  t.after(() => h.unmount());

  await addOutsider(h);
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], structureOnly());
  await h.clock.advance(50);

  assert.ok(
    !NOTICE.test(h.text()),
    "a verdict about fitting into a day requires a day to have been composed",
  );
});

test("restoring a snapshot cancels the compose that would have overwritten it", async (t) => {
  const h = await plannerWithDay(["a", "b", "c"]);
  t.after(() => h.unmount());

  // Save the day so there is something to restore.
  await click(h, buttonMatching(h, /^☆$/));
  await h.clock.advance(50);

  // Start a recompose and leave it in flight.
  await keepFirstStop(h);
  await h.clock.advance(500);
  const inFlight = h.fetchMock.pending()[0];
  assert.ok(inFlight, "a compose is in flight");

  // Restore while it is still outstanding.
  const entry = [...h.container.querySelectorAll("button")].find((b) =>
    /Testville · /.test(b.textContent || ""),
  );
  await click(h, entry);
  await h.clock.advance(50);

  assert.ok(inFlight.aborted, "the older compose is aborted, not left racing the snapshot");

  // Even if its answer were to arrive anyway, it must not replace the snapshot.
  await h.fetchMock.respond(inFlight, composedDay(["q", "r", "s"])).catch(() => {});
  await h.clock.advance(50);
  assert.ok(!/Place q/.test(h.text()), "a superseded generation cannot install its day");
});

test("restoring drops the ledger rather than inheriting it", async (t) => {
  const h = await plannerWithDay(["a", "b", "c"]);
  t.after(() => h.unmount());

  await click(h, buttonMatching(h, /^☆$/));
  await h.clock.advance(50);
  await keepFirstStop(h);
  assert.match(h.text(), KEPT_LEDGER, "a commitment is held");

  const entry = [...h.container.querySelectorAll("button")].find((b) =>
    /Testville · /.test(b.textContent || ""),
  );
  await click(h, entry);
  await h.clock.advance(500);

  // Saved days do not persist the commitments they were composed under, so the
  // same place is not evidence of the same day.
  assert.ok(!KEPT_LEDGER.test(h.text()), "the restored day carries no ledger");
  assert.ok(!NOTICE.test(h.text()), "and therefore no verdict");
});

test("releasing a pin mid-flight does not leave the day naming it", async (t) => {
  const h = await plannerWithDay();
  t.after(() => h.unmount());

  await keepFirstStop(h);
  await h.clock.advance(500);
  const inFlight = h.fetchMock.pending()[0];
  assert.deepEqual(inFlight.body.pinned_candidate_ids, ["a"]);

  // Withdraw the commitment while the request that carries it is outstanding.
  const disclosure = [...h.container.querySelectorAll("button")].find((b) =>
    /Place a/.test(b.textContent || ""),
  );
  await click(h, disclosure);
  const release = buttonMatching(h, /Kept — release/);
  if (release) await click(h, release);

  // The in-flight answer lands without the place.
  await h.fetchMock.respond(inFlight, composedDay(["b", "c", "d"])).catch(() => {});
  await h.clock.advance(50);

  // Whatever else is true, the day must not report an unmet commitment the
  // user no longer holds.
  const text = h.text();
  if (NOTICE.test(text)) {
    assert.ok(
      !/Place a/.test(text.slice(text.search(NOTICE))),
      "a released commitment must not be named as unmet",
    );
  }
});

test("an answer to a superseded intent cannot install its day", async (t) => {
  const h = await plannerWithDay(["a", "b", "c"]);
  t.after(() => h.unmount());

  // Commit, let the request leave, and hold it open.
  await addOutsider(h);
  await h.clock.advance(500);
  const inFlight = h.fetchMock.pending()[0];
  assert.deepEqual(inFlight.body.pinned_candidate_ids, ["outsider"]);

  // The user changes their mind while it is in flight. Everything outstanding
  // is now answering a question they have moved past.
  await keepFirstStop(h);

  // The older answer arrives anyway, carrying a day composed for the older
  // intent. The immutable verdict snapshot would keep it from SAYING anything
  // false — but it must not install its route either.
  await h.fetchMock.respond(inFlight, composedDay(["q", "r", "s"])).catch(() => {});
  await h.clock.advance(50);

  assert.ok(!/Place q/.test(h.text()), "a superseded intent's day cannot take the screen");
  assert.match(h.text(), /Place a/, "the day the user is looking at is still theirs");
});

test("a body released after the intent moved on is still refused", async (t) => {
  const h = await plannerWithDay(["a", "b", "c"]);
  t.after(() => h.unmount());

  await addOutsider(h);
  await h.clock.advance(500);
  const inFlight = h.fetchMock.pending()[0];

  // Headers land while the intent is still current...
  await h.fetchMock.respond(inFlight, composedDay(["q", "r", "s"]), 200, { deferBody: true });

  // ...and the user changes their mind in the gap before the body arrives.
  // Reading the response is two awaits, and a race can live between them.
  await keepFirstStop(h);
  await h.fetchMock.releaseBody(inFlight);
  await h.clock.advance(50);

  assert.ok(!/Place q/.test(h.text()), "the generation check must survive the body await");
});

test("starting over invalidates the commitment request already in flight", async (t) => {
  const h = await plannerWithDay();
  t.after(() => h.unmount());

  await addOutsider(h);
  await h.clock.advance(500);
  const inFlight = h.fetchMock.pending()[0];
  assert.deepEqual(inFlight.body.pinned_candidate_ids, ["outsider"]);

  await click(h, buttonMatching(h, /Start over without my choices/));
  await h.fetchMock.respond(inFlight, composedDay(["q", "r", "s"])).catch(() => {});
  await h.clock.advance(50);

  assert.ok(!/Place q/.test(h.text()), "the cleared ledger's old answer cannot take the screen");
});

test("a scheduled silent refresh cannot wake under a newer ledger intent", async (t) => {
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&lang=en" });
  t.after(() => h.unmount());

  await h.clock.advance(500);
  const first = h.fetchMock.pending()[0];
  const pendingLive = composedDay(["a", "b", "c"]);
  pendingLive.live_events = { pending: true };
  await h.fetchMock.respond(first, pendingLive);
  await h.clock.advance(50);

  // The old follow-up is due at t=9500. Change intent 100ms before it wakes;
  // the new debounced request is not due until t=9800.
  await h.clock.advance(8850);
  await addOutsider(h);
  await h.clock.advance(100);

  const staleSilent = h.fetchMock.pending()[0];
  assert.equal(staleSilent, undefined, "the old timer is cancelled before it can send its frozen ledger");
});

// --------------------------------------------------------------------------
// WHY a commitment went unmet is the server's to say.
// --------------------------------------------------------------------------

test("the day renders the reason the server gave", async (t) => {
  const h = await plannerWithDay();
  t.after(() => h.unmount());

  await addOutsider(h);
  await h.clock.advance(500);
  await h.fetchMock.respond(
    h.fetchMock.pending()[0],
    composedDayWithRefusals(["a", "b", "c"], [{ id: "outsider", reason: "walking_budget" }]),
  );
  await h.clock.advance(50);

  assert.match(h.text(), /too far for the walk you asked for/, "the specific cause is shown");
  assert.match(h.text(), /Place outsider/, "attached to the place it is about");
});

test("each named reason gets its own sentence", async (t) => {
  const h = await plannerWithDay();
  t.after(() => h.unmount());

  await addOutsider(h);
  await h.clock.advance(500);
  await h.fetchMock.respond(
    h.fetchMock.pending()[0],
    composedDayWithRefusals(["a", "b", "c"], [{ id: "outsider", reason: "unknown_candidate" }]),
  );
  await h.clock.advance(50);

  assert.match(h.text(), /isn't something Parranda can route to here/);
  assert.ok(
    !/too far for the walk/.test(h.text()),
    "one reason at a time — the day does not offer a menu of possible causes",
  );
});

test("an unrecognised reason falls back rather than inventing one", async (t) => {
  // A newer server, or one that named no reason at all. The day may say it
  // could not fit something; it may never guess why.
  const h = await plannerWithDay();
  t.after(() => h.unmount());

  await addOutsider(h);
  await h.clock.advance(500);
  await h.fetchMock.respond(
    h.fetchMock.pending()[0],
    composedDayWithRefusals(["a", "b", "c"], [{ id: "outsider", reason: "some_future_reason" }]),
  );
  await h.clock.advance(50);

  assert.match(h.text(), /could not fit in this day/i, "the plain sentence still appears");
  assert.ok(!/too far for the walk/.test(h.text()));
  assert.ok(!/can route to here/.test(h.text()));
  assert.ok(!/some_future_reason/.test(h.text()), "and the raw token is never shown to a user");
});

test("no server verdict means no cause is claimed", async (t) => {
  // The absence of a stop is visible to the client; the reason for it is not.
  // Deriving one from route absence is the fabrication this avoids.
  const h = await plannerWithDay();
  t.after(() => h.unmount());

  await addOutsider(h);
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], composedDay(["a", "b", "c"]));
  await h.clock.advance(50);

  assert.match(h.text(), /could not fit in this day/i);
  for (const invented of [
    /too far for the walk/,
    /can route to here/,
    /did not fit any role/,
    /the day was built without it/,
  ]) {
    assert.ok(!invented.test(h.text()), `must not infer: ${invented}`);
  }
});
