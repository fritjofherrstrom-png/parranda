/**
 * The remembered day is the last day that existed. A place that could not be
 * resolved or composed must not replace it, and the landing never offers to
 * "Continue" something that has no day in it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";
import { isComposedEntry } from "../src/lib/anywhere-storage.mjs";

const LAST_KEY = "parranda:anywhere:last";

function composedDay() {
  const stops = [
    { id: "a", label: "Place a", lat: 55.6, lng: 13, type: "museum" },
    { id: "b", label: "Place b", lat: 55.601, lng: 13, type: "restaurant" },
  ];
  return {
    days: [{
      date: "2026-09-25",
      experimental_agnostic_route_applied: true,
      primary_route: {
        id: "__agnostic_compose__",
        main_stops: stops,
        estimated_km: 1.2,
        legs: [],
        map_route_points: [],
        map_path_points: stops.map(({ lat, lng }) => ({ lat, lng })),
        confidence: "low",
      },
      alternatives: [],
    }],
    agnostic_route_output_experiment: {
      intake: { status: "resolved", resolved: { label: null, lat: 55.6, lng: 13 } },
      promotion: { promote: true, readiness: "promotable" },
    },
  };
}

const unresolvedPlace = () => ({
  days: [],
  agnostic_route_output_experiment: {
    intake: { status: "unresolved", blockers: ["place_not_resolved"] },
  },
});

const composeCalls = (h) => h.fetchMock.calls.filter((call) => call.url.startsWith("/api/route-recommendations"));

async function composeOnce(url, body, options = {}) {
  const h = await mountPlanner({ url, ...options });
  await h.clock.advance(500);
  await h.fetchMock.respond(composeCalls(h)[0], body);
  await h.clock.advance(50);
  const stored = h.readStorage(LAST_KEY);
  await h.unmount();
  return stored;
}

test("an unresolved place leaves the last real day in place", async () => {
  const day = await composeOnce("http://localhost/anywhere?place=Testville&planner=open&lang=en", composedDay());
  assert.equal(day?.place, "Testville");
  assert.equal(isComposedEntry(day), true);

  const after = await composeOnce(
    "http://localhost/anywhere?place=xqzvbnmk&planner=open&lang=en",
    unresolvedPlace(),
    { storage: { [LAST_KEY]: day } },
  );
  assert.equal(after?.place, "Testville", "the failed search did not overwrite the remembered day");
});

test("the landing offers to continue only a stored entry that holds a day", async () => {
  const unresolved = {
    id: "xqzvbnmk::2026-09-25::culture,food,views::rhythm=balanced",
    label: "xqzvbnmk",
    place: "xqzvbnmk",
    dateIso: "2026-09-25",
    safeResponse: { days: [] },
    classification: { status: "unavailable", hasStructure: false, placeLabel: "xqzvbnmk" },
    inputs: null,
    commitments: null,
  };
  for (const [entry, offered] of [[unresolved, false], [{ ...unresolved, place: "Testville", classification: { status: "composed" } }, true]]) {
    const h = await mountPlanner({ entry: "components/LandingHero.tsx", url: "http://localhost/?lang=en", storage: { [LAST_KEY]: entry } });
    try {
      assert.equal(/Continue/.test(h.text()), offered, `${entry.classification.status} ${offered ? "is" : "is not"} offered`);
    } finally {
      await h.unmount();
    }
  }
});
