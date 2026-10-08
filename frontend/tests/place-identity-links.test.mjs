/**
 * The chosen place keeps its identity on reload, in another language and in a
 * new session. Links carry the place's OSM identity (`place_ref`), which the
 * server re-validates — never coordinates and never a session receipt.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";
import { buildShareUrl, decodeShareParams, encodeShareParams } from "../src/lib/anywhere-share.mjs";
import { buildAnywherePayload } from "../src/lib/anywhere-payload.mjs";
import { routeForInput } from "../src/lib/landing-routing.mjs";

test("links carry a valid identity only beside the place text it names", () => {
  const qs = encodeShareParams({ place: "Rome, Lazio, Italy", placeRef: "r41485", lang: "sv" });
  assert.equal(new URLSearchParams(qs).get("place_ref"), "r41485");
  assert.equal(decodeShareParams(qs).placeRef, "r41485");
  for (const bad of ["41485", "R41485", "r0", "lat=41.9", "r41485&lat=1"]) {
    assert.equal(new URLSearchParams(encodeShareParams({ place: "Rome", placeRef: bad })).get("place_ref"), null, bad);
    assert.equal(decodeShareParams(`place=Rome&place_ref=${encodeURIComponent(bad)}`).placeRef, null, bad);
  }
  assert.equal(decodeShareParams("place_ref=r41485").placeRef, null, "an identity without its place text is ignored");
  assert.match(buildShareUrl("https://p.example", { place: "Rome", placeRef: "r41485" }), /place_ref=r41485/);
});

test("the typed-place request carries the identity; a position request never does", () => {
  assert.equal(buildAnywherePayload({ place: "Rome", placeRef: "r41485" }).place_ref, "r41485");
  assert.equal(buildAnywherePayload({ place: "Rome", placeRef: "r41485", coords: { lat: 55.6, lng: 13 } }).place_ref, undefined);
  assert.equal("place_ref" in buildAnywherePayload({ place: "Rome" }), false, "the default request is unchanged");
});

test("a chosen landing suggestion sends its identity to the planner", () => {
  const route = routeForInput({}, "Lisboa, Portugal", "sv", { placeRef: "r5400890" });
  const params = new URL(route.href, "http://localhost").searchParams;
  assert.equal(params.get("place"), "Lisboa, Portugal");
  assert.equal(params.get("place_ref"), "r5400890");
  assert.equal(new URL(routeForInput({}, "Lisboa", "sv", { placeRef: "lisboa" }).href, "http://localhost").searchParams.get("place_ref"), null);
});

const romeDay = (placeRef = "r41485") => {
  const stops = [
    { id: "a", label: "Place a", lat: 41.9, lng: 12.49, type: "museum" },
    { id: "b", label: "Place b", lat: 41.901, lng: 12.49, type: "restaurant" },
  ];
  return {
    days: [{
      date: "2026-10-08",
      experimental_agnostic_route_applied: true,
      primary_route: { id: "__agnostic_compose__", main_stops: stops, estimated_km: 1.2, legs: [], map_route_points: [], map_path_points: stops.map(({ lat, lng }) => ({ lat, lng })), confidence: "low" },
      alternatives: [],
    }],
    agnostic_route_output_experiment: {
      intake: { status: "resolved", resolved: { label: "Rome, Roma Capitale, Lazio, Italy", lat: 41.9, lng: 12.49, selection_id: "receipt-1", place_ref: placeRef } },
      promotion: { promote: true, readiness: "promotable" },
    },
  };
};
const composeCalls = (h) => h.fetchMock.calls.filter((call) => call.url.startsWith("/api/route-recommendations"));
const click = (h, element) => h.act(() => element.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));

test("reloading a chosen place, switching language and opening a shared link keep the same identity", async () => {
  // Arrival from the landing: the one-shot receipt handoff plus the identity.
  const first = await mountPlanner({
    url: "http://localhost/anywhere?place=Rome&place_ref=r41485&planner=open&lang=en",
    sessionStorage: { "parranda:place-choice": { place: "Rome", selection: "receipt-1", label: "Rome, Roma Capitale, Lazio, Italy", at: Date.now() } },
  });
  first.document.addEventListener("click", (event) => event.preventDefault());
  await first.clock.advance(500);
  const [arrival] = composeCalls(first);
  assert.equal(arrival.body.place_selection, "receipt-1");
  assert.equal(arrival.body.place_ref, "r41485");
  await first.fetchMock.respond(arrival, romeDay());
  await first.clock.advance(50);

  const reloadSearch = first.window.location.search;
  assert.equal(new URLSearchParams(reloadSearch).get("place_ref"), "r41485", "the address names the place");
  const sv = [...first.container.querySelectorAll("a")].find((a) => a.textContent.trim() === "SV");
  assert.equal(new URL(sv.href, "http://localhost").searchParams.get("place_ref"), "r41485", "the language link names it too");
  const copied = [];
  Object.defineProperty(first.window.navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { copied.push(text); } } });
  await click(first, [...first.container.querySelectorAll("button")].find((b) => /^Share/.test((b.getAttribute("aria-label") || b.textContent).trim())));
  await first.clock.advance(10);
  assert.equal(copied.length, 1, "the share link was produced");
  assert.equal(new URL(copied[0]).searchParams.get("place_ref"), "r41485", "the share link names it");
  await first.unmount();

  // A plain reload: the one-shot receipt is gone (Hermès, 773c48d), the identity is not.
  for (const search of [reloadSearch, new URL(sv.href, "http://localhost").search, new URL(copied[0]).search]) {
    const again = await mountPlanner({ url: `http://localhost/anywhere${search}` });
    try {
      await again.clock.advance(500);
      const [call] = composeCalls(again);
      assert.equal(call.body.place_selection, undefined, "no receipt survives into a new session");
      assert.equal(call.body.place_ref, "r41485", search);
    } finally {
      await again.unmount();
    }
  }
});

test("choosing between namesakes carries the chosen identity", async () => {
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Lisbon&planner=open&lang=en" });
  try {
    h.document.addEventListener("click", (event) => event.preventDefault());
    await h.clock.advance(500);
    await h.fetchMock.respond(composeCalls(h)[0], {
      days: [],
      agnostic_route_output_experiment: {
        intake: {
          query: "Lisbon", status: "unresolved", resolved: null, blockers: ["ambiguous_place"],
          candidates: [
            { label: "Lisbon, Linn County, Iowa, United States", selection_id: "us-token", place_ref: "r129082" },
            { label: "Lisboa, Portugal", selection_id: "pt-token", place_ref: "r5400890" },
          ],
        },
        source_status: { status: "no_anchor" },
      },
    });
    await h.clock.advance(30);
    const button = [...h.container.querySelectorAll("button")].find((b) => b.textContent.includes("Lisboa, Portugal"));
    await click(h, button);
    const chosen = composeCalls(h)[1];
    assert.equal(chosen.body.place_selection, "pt-token");
    assert.equal(chosen.body.place_ref, "r5400890");
  } finally {
    await h.unmount();
  }
});
