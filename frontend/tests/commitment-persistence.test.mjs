/**
 * Commitments that survive a reload and a restore — without the day ever
 * claiming something it was not asked.
 *
 * The rule the previous slices established still holds: a day may only speak
 * for commitments it actually answered. Persistence does not relax that; it
 * gives the saved day its own record so it can answer honestly instead of
 * dropping the ledger. Every test here is about the boundary between the two.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";
import { LAST_KEY, SAVED_KEY } from "../src/lib/anywhere-storage.mjs";
import { COMMITMENT_SNAPSHOT_VERSION } from "../src/lib/commitment-snapshot.mjs";

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
            stops: [{ id: "outsider", name: "Place outsider", lat: 41.9002, lng: 12.49, type: "cafe", tags: [] }],
          },
        ],
      },
    },
    agnostic_route_output_experiment: { promotion: { promote: true } },
  };
}

const PLACE_URL = (place) => `http://localhost/anywhere?place=${place}&lang=en`;

async function plannerWithDay(place = "Testville", stopIds = ["a", "b", "c"], storage) {
  const h = await mountPlanner({ url: PLACE_URL(place), ...(storage ? { storage } : {}) });
  await h.clock.advance(500);
  const first = h.fetchMock.pending()[0];
  assert.ok(first, "the planner composes on arrival with ?place=");
  await h.fetchMock.respond(first, composedDay(stopIds));
  await h.clock.advance(50);
  return h;
}

const buttonMatching = (h, pattern) =>
  [...h.container.querySelectorAll("button")].find((b) => pattern.test(b.textContent || ""));

async function click(h, button) {
  assert.ok(button, "the control under test exists");
  await h.act(() => {
    button.dispatchEvent(new h.window.Event("click", { bubbles: true }));
  });
}

async function keepFirstStop(h) {
  await click(h, [...h.container.querySelectorAll("button")].find((b) => /Place a/.test(b.textContent || "")));
  await click(h, buttonMatching(h, /Keep this one/));
}

/** Commit, let the recompose land, and return the day that answered it. */
async function keepAndSettle(h, answer = ["a", "b", "c"]) {
  await keepFirstStop(h);
  await h.clock.advance(500);
  const inFlight = h.fetchMock.pending()[0];
  await h.fetchMock.respond(inFlight, composedDay(answer));
  await h.clock.advance(50);
  return inFlight;
}

// --------------------------------------------------------------------------

test("a composed day records the commitments it answered", async (t) => {
  const h = await plannerWithDay();
  t.after(() => h.unmount());

  await keepAndSettle(h);

  const stored = h.readStorage(LAST_KEY);
  assert.ok(stored?.commitments, "the day carries its own record");
  assert.equal(stored.commitments.version, COMMITMENT_SNAPSHOT_VERSION, "and it is versioned");
  assert.deepEqual(stored.commitments.entries, { a: { kind: "pin", label: "Place a" } });
  assert.deepEqual(stored.commitments.appliedPins, [{ id: "a", kind: "pin", label: "Place a" }]);
  assert.ok(stored.commitments.anchorKey, "scoped to the geography it was made in");
});

test("a reload brings the commitments back with the day", async (t) => {
  const first = await plannerWithDay();
  await keepAndSettle(first);
  const persisted = first.readStorage(LAST_KEY);
  await first.unmount();

  // A fresh mount with no ?place=, exactly as a reload of /anywhere behaves:
  // the stored day is restored rather than recomposed.
  const h = await mountPlanner({ url: "http://localhost/anywhere?lang=en", storage: { [LAST_KEY]: persisted } });
  t.after(() => h.unmount());
  await h.clock.advance(100);

  assert.match(h.text(), /Place a/, "the day is back");
  assert.match(h.text(), KEPT_LEDGER, "and so is what the user kept");
  assert.ok(!NOTICE.test(h.text()), "the pin was honoured, so nothing is claimed against it");
});

test("a restored day answers with its own verdict, not a recomputed one", async (t) => {
  // The day was composed WITHOUT the kept place, so its record says the
  // commitment went unmet. That verdict travels with it.
  const first = await plannerWithDay();
  await keepAndSettle(first, ["b", "c", "d"]);
  assert.match(first.text(), NOTICE, "precondition: the live day reported it unmet");
  const persisted = first.readStorage(LAST_KEY);
  await first.unmount();

  const h = await mountPlanner({ url: "http://localhost/anywhere?lang=en", storage: { [LAST_KEY]: persisted } });
  t.after(() => h.unmount());
  await h.clock.advance(100);

  assert.match(h.text(), NOTICE, "the restored day reports what it actually answered");
  assert.match(h.text(), /Place a/, "and names it");
});

test("a day saved before this existed still carries no commitments", async (t) => {
  const first = await plannerWithDay();
  await keepAndSettle(first);
  const legacy = { ...first.readStorage(LAST_KEY) };
  delete legacy.commitments;
  await first.unmount();

  const h = await mountPlanner({ url: "http://localhost/anywhere?lang=en", storage: { [LAST_KEY]: legacy } });
  t.after(() => h.unmount());
  await h.clock.advance(100);

  assert.match(h.text(), /Place a/, "the day itself restores as it always did");
  assert.ok(!KEPT_LEDGER.test(h.text()), "with no record, it speaks for no commitments");
  assert.ok(!NOTICE.test(h.text()), "and claims nothing about them");
});

test("a tampered record is refused outright", async (t) => {
  const first = await plannerWithDay();
  await keepAndSettle(first);
  const tampered = first.readStorage(LAST_KEY);
  tampered.commitments.version = 999;
  await first.unmount();

  const h = await mountPlanner({ url: "http://localhost/anywhere?lang=en", storage: { [LAST_KEY]: tampered } });
  t.after(() => h.unmount());
  await h.clock.advance(100);

  assert.match(h.text(), /Place a/);
  assert.ok(!KEPT_LEDGER.test(h.text()), "an unrecognised version is not guessed at");
});

test("one saved day cannot lend its commitments to another", async (t) => {
  // Two days, same session. Restoring the one WITHOUT commitments must not
  // inherit the live ledger left over from the one with them.
  const first = await plannerWithDay("Testville");
  await keepAndSettle(first);
  const withCommitments = first.readStorage(LAST_KEY);
  await first.unmount();

  const second = await plannerWithDay("Otherton");
  const withoutCommitments = second.readStorage(LAST_KEY);
  await second.unmount();
  assert.ok(!withoutCommitments?.commitments, "precondition: the second day made no commitments");

  const h = await mountPlanner({
    url: PLACE_URL("Testville"),
    storage: { [LAST_KEY]: withCommitments, [SAVED_KEY]: [withCommitments, withoutCommitments] },
  });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], composedDay(["a", "b", "c"]));
  await h.clock.advance(50);

  // Hold a LIVE commitment at the moment of restoring. This is the leak the
  // rule exists to stop: without a record of its own, the other day would
  // simply inherit whatever is being held right now.
  await keepAndSettle(h);
  assert.match(h.text(), KEPT_LEDGER, "precondition: a commitment is live");

  const other = [...h.container.querySelectorAll("li button")].find((b) =>
    /^Otherton · /.test((b.textContent || "").trim()),
  );
  await click(h, other);
  await h.clock.advance(100);

  assert.ok(!KEPT_LEDGER.test(h.text()), "the restored day carries only its own record");
  assert.ok(!NOTICE.test(h.text()));
});

test("restoring still cancels a compose that would have overwritten it", async (t) => {
  // Persistence must not weaken the generation rule: a request already in
  // flight is answering an older question, whatever the restored day carries.
  const h = await plannerWithDay();
  t.after(() => h.unmount());

  await click(h, buttonMatching(h, /^☆$/));
  await h.clock.advance(50);
  await keepFirstStop(h);
  await h.clock.advance(500);
  const inFlight = h.fetchMock.pending()[0];
  assert.ok(inFlight, "a compose is in flight");

  const entry = [...h.container.querySelectorAll("li button")].find((b) =>
    /Testville · /.test(b.textContent || ""),
  );
  await click(h, entry);
  await h.clock.advance(50);
  assert.ok(inFlight.aborted, "the older compose is aborted");

  await h.fetchMock.respond(inFlight, composedDay(["q", "r", "s"])).catch(() => {});
  await h.clock.advance(50);
  assert.ok(!/Place q/.test(h.text()), "a superseded generation cannot install its day");
});

test("rebuilding a restored day recomposes with the commitments it carried", async (t) => {
  const first = await plannerWithDay();
  await keepAndSettle(first);
  const persisted = first.readStorage(LAST_KEY);
  await first.unmount();

  const h = await mountPlanner({ url: "http://localhost/anywhere?lang=en", storage: { [LAST_KEY]: persisted } });
  t.after(() => h.unmount());
  await h.clock.advance(100);
  assert.match(h.text(), KEPT_LEDGER, "precondition: the restored day carries them");

  const before = h.fetchMock.calls.length;
  // The control a restored snapshot offers, because its events may be stale.
  const rebuild = buttonMatching(h, /rebuild for fresh events/);
  assert.ok(rebuild, "a restored snapshot offers a rebuild");
  await click(h, rebuild);
  await h.clock.advance(600);

  const sent = h.fetchMock.calls[before];
  assert.ok(sent, "a rebuild actually composes");
  assert.deepEqual(
    sent.body.pinned_candidate_ids,
    ["a"],
    "the rebuild asks the same question the restored day was answering",
  );
});
