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
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";

const NOTICE = /Could not fit in this day/;
const KEPT_LEDGER = /\d+ places? kept/;

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
              { id: "outsider", name: "Place outsider", lat: 41.9002, lng: 12.49, type: "cafe", tags: [] },
            ],
          },
        ],
      },
    },
    agnostic_route_output_experiment: { promotion: { promote: true } },
  };
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
            stops: [
              { id: "x", name: "Place x", lat: 41.9, lng: 12.49, type: "restaurant", tags: [] },
              { id: "y", name: "Place y", lat: 41.9001, lng: 12.49, type: "cafe", tags: [] },
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

test("structure_only composes no day, so no pin can have failed to fit in one", async (t) => {
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&lang=en" });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], structureOnly());
  await h.clock.advance(50);

  const add = buttonMatching(h, /Place x/);
  await click(h, add);
  await click(h, buttonMatching(h, /Add to my day/));
  await h.clock.advance(500);

  const inFlight = h.fetchMock.pending()[0];
  assert.ok(inFlight, "the request goes out");
  await h.fetchMock.respond(inFlight, structureOnly());
  await h.clock.advance(50);

  // There is no day here — there never was one. "Could not fit in this day"
  // would be describing something that does not exist.
  assert.ok(
    !NOTICE.test(h.text()),
    "a verdict about fitting into a day requires a day",
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
