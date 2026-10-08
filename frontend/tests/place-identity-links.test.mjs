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

test("links carry identity independently of optional display text and flag malformed refs", () => {
  const qs = encodeShareParams({ place: "Rome, Lazio, Italy", placeRef: "r41485", lang: "sv" });
  assert.equal(new URLSearchParams(qs).get("place_ref"), "r41485");
  assert.equal(decodeShareParams(qs).placeRef, "r41485");
  for (const bad of ["41485", "R41485", "r0", "lat=41.9", "r41485&lat=1", "r41485\n", ""]) {
    assert.equal(new URLSearchParams(encodeShareParams({ place: "Rome", placeRef: bad })).get("place_ref"), null, bad);
    const decoded = decodeShareParams(`place=Rome&place_ref=${encodeURIComponent(bad)}`);
    assert.equal(decoded.placeRef, null, bad);
    assert.equal(decoded.invalidPlaceRef, true, "a present invalid identity is not legacy free text");
  }
  assert.equal(decodeShareParams("place_ref=r41485").placeRef, "r41485", "identity does not require display text");
  assert.equal(new URLSearchParams(encodeShareParams({ placeRef: "r41485" })).get("place_ref"), "r41485");
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

const LAST_KEY = "parranda:anywhere:last";
async function rememberedDay() {
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Previous&lang=en" });
  try {
    await h.clock.advance(500);
    await h.fetchMock.respond(composeCalls(h)[0], romeDay());
    await h.clock.advance(50);
    const entry = h.readStorage(LAST_KEY);
    assert.ok(entry?.safeResponse, "a real composed stored-day precondition");
    return entry;
  } finally { await h.unmount(); }
}

test("malformed URL identities block planning and stored-day fallback without repairing the address", async () => {
  const last = await rememberedDay();
  for (const storage of [{}, { [LAST_KEY]: last }]) {
    for (const query of ["place=Rome&place_ref=R41485", "place=Rome&place_ref=r41485%0A", "place=Rome&place_ref=", "place_ref=R41485", "place_ref=r41485%0A", "place_ref=", "place_ref=&place_ref=r41485", "place_ref=R41485&lat=55&lng=13"]) {
      const url = `http://localhost/anywhere?${query}&lang=en`;
      const h = await mountPlanner({ url, storage });
      try {
        await h.clock.advance(1000);
        assert.equal(composeCalls(h).length, 0, "never search a namesake as free text");
        assert.match(h.text(), /invalid place reference/i);
        assert.doesNotMatch(h.text(), /Saved day/);
        assert.equal(h.window.location.search, new URL(url).search);
        assert.deepEqual(h.readStorage(LAST_KEY), storage[LAST_KEY] ?? null);
      } finally { await h.unmount(); }
    }
  }
});

test("ref-only arrival requests its identity before stored-day fallback and adopts the published identity atomically", async () => {
  const last = await rememberedDay();
  for (const storage of [{}, { [LAST_KEY]: last }]) {
    const h = await mountPlanner({ url: "http://localhost/anywhere?place_ref=r41485&lang=en", storage });
    try {
      h.document.addEventListener("click", (event) => event.preventDefault());
      await h.clock.advance(500);
      const calls = composeCalls(h);
      assert.equal(calls.length, 1, "request the ref rather than restoring an unrelated day");
      assert.equal(calls[0].body.place_ref, "r41485");
      for (const field of ["place", "place_query", "lat", "lng", "place_selection"]) assert.equal(calls[0].body[field], undefined, field);
      assert.doesNotMatch(h.text(), /Saved day/);
      await h.fetchMock.respond(calls[0], romeDay());
      await h.clock.advance(50);
      const stored = h.readStorage(LAST_KEY);
      assert.equal(stored.inputs.place, "Rome, Roma Capitale, Lazio, Italy");
      assert.equal(stored.inputs.placeLabel, "Rome, Roma Capitale, Lazio, Italy");
      assert.equal(stored.inputs.placeRef, "r41485");
      assert.equal(stored.inputs.placeSelection, "receipt-1");
      const params = new URLSearchParams(h.window.location.search);
      assert.equal(params.get("place_ref"), "r41485");
      assert.equal(params.get("place"), stored.inputs.place);
      assert.equal(params.has("selection_id"), false);
      const sv = [...h.container.querySelectorAll("a")].find((a) => a.textContent.trim() === "SV");
      assert.equal(new URL(sv.href).searchParams.get("place_ref"), "r41485");
      const copied = [];
      Object.defineProperty(h.window.navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { copied.push(text); } } });
      await click(h, [...h.container.querySelectorAll("button")].find((b) => /^Share/.test((b.getAttribute("aria-label") || b.textContent).trim())));
      await h.clock.advance(10);
      assert.equal(copied.length, 1);
      const share = new URL(copied[0]);
      assert.equal(share.searchParams.get("place_ref"), "r41485");
      for (const url of [share, new URL(sv.href)]) {
        assert.equal(url.searchParams.get("place"), stored.inputs.place);
        for (const field of ["selection_id", "place_selection", "lat", "lng"]) assert.equal(url.searchParams.has(field), false, field);
      }
      await click(h, [...h.container.querySelectorAll("button")].find((b) => /^Adjust/.test((b.getAttribute("aria-label") || b.textContent).trim())));
      await click(h, [...h.container.querySelectorAll("button")].find((b) => /^Easy/.test(b.textContent.trim())));
      await h.clock.advance(450);
      const adjusted = composeCalls(h)[1];
      assert.equal(adjusted.body.place_ref, "r41485");
      assert.equal(adjusted.body.place_selection, "receipt-1");
      assert.equal(adjusted.body.place, stored.inputs.place);
    } finally { await h.unmount(); }
  }
});

test("valid first reference and first non-near anchor retain first-value URL semantics", async () => {
  for (const query of ["place_ref=r41485&place_ref=R41485", "place_ref=r41485&anchor=other&anchor=near"]) {
    const h = await mountPlanner({ url: `http://localhost/anywhere?${query}&lang=en` });
    try {
      await h.clock.advance(500);
      assert.equal(composeCalls(h).length, 1);
      assert.equal(composeCalls(h)[0].body.place_ref, "r41485");
      assert.equal(composeCalls(h)[0].body.lat, undefined);
      assert.doesNotMatch(h.text(), /conflicting place anchors|invalid place reference/i);
    } finally { await h.unmount(); }
  }
});

test("valid ref plus explicit coordinate-field intent fails closed before planning or stored-day restore", async () => {
  const last = await rememberedDay();
  for (const storage of [{}, { [LAST_KEY]: last }]) {
    for (const fields of ["lat=55&lng=13", "lat=999&lng=13", "lat=55", "lng=13", "lat=&lng=", "lat=NaN&lng=13", "lat=&lat=55&lng=13"]) {
      const url = `http://localhost/anywhere?place_ref=r41485&${fields}&lang=en`;
      const h = await mountPlanner({ url, storage });
      try {
        await h.clock.advance(1000);
        assert.equal(h.fetchMock.calls.length, 0, fields);
        assert.match(h.text(), /conflicting place anchors/i, fields);
        assert.doesNotMatch(h.text(), /invalid place reference|Saved day/i);
        assert.equal(h.window.location.search, new URL(url).search);
        assert.deepEqual(h.readStorage(LAST_KEY), storage[LAST_KEY] ?? null);
        assert.equal(h.container.querySelector("form"), null);
        assert.ok(h.container.querySelector('a[href="/?lang=en"]'));
      } finally { await h.unmount(); }
    }
  }
});

test("ref plus near handoff is an anchor conflict without consuming consented coordinates", async () => {
  const last = await rememberedDay();
  const coords = { lat: 55, lng: 13, at: Date.now() };
  for (const storage of [{}, { [LAST_KEY]: last }]) {
    for (const query of ["place_ref=r41485&anchor=near", "place=Rome&place_ref=r41485&anchor=near", "place_ref=r41485&anchor=near&anchor=other"]) {
      const url = `http://localhost/anywhere?${query}&lang=sv`;
      const h = await mountPlanner({ url, storage, props: { lang: "sv" }, sessionStorage: { "parranda:anchor:coords": coords } });
      try {
        await h.clock.advance(1000);
        assert.equal(h.fetchMock.calls.length, 0, query);
        assert.match(h.text(), /motstridiga platsankare/);
        assert.equal(h.window.location.search, new URL(url).search);
        assert.deepEqual(JSON.parse(h.window.sessionStorage.getItem("parranda:anchor:coords")), coords);
        assert.deepEqual(h.readStorage(LAST_KEY), storage[LAST_KEY] ?? null);
        assert.doesNotMatch(h.text(), /Saved day|Sparad dag/);
      } finally { await h.unmount(); }
    }
  }
});

test("no-ref near consumes consented coordinates once without asking for GPS", async () => {
  let gpsCalls = 0;
  const h = await mountPlanner({ url: "http://localhost/anywhere?anchor=near&lang=en", sessionStorage: { "parranda:anchor:coords": { lat: 55, lng: 13 } } });
  try {
    Object.defineProperty(h.window.navigator, "geolocation", { value: { getCurrentPosition() { gpsCalls++; } } });
    await h.clock.advance(500);
    assert.equal(composeCalls(h).length, 1);
    assert.equal(composeCalls(h)[0].body.lat, 55);
    assert.equal(composeCalls(h)[0].body.lng, 13);
    assert.equal(composeCalls(h)[0].body.place_ref, undefined);
    assert.equal(h.window.sessionStorage.getItem("parranda:anchor:coords"), null);
    assert.equal(gpsCalls, 0);
  } finally { await h.unmount(); }
});

test("an unavailable ref-only arrival retains the last safe day without displaying it under the new identity", async () => {
  const last = await rememberedDay();
  const h = await mountPlanner({ url: "http://localhost/anywhere?place_ref=r999&lang=en", storage: { [LAST_KEY]: last } });
  try {
    await h.clock.advance(500);
    assert.equal(composeCalls(h).length, 1);
    await h.fetchMock.respond(composeCalls(h)[0], { days: [], agnostic_route_output_experiment: {
      intake: { status: "unresolved", blockers: ["place_ref_unavailable"] },
    } });
    await h.clock.advance(50);
    assert.deepEqual(h.readStorage(LAST_KEY), last);
    assert.doesNotMatch(h.text(), /Saved day/);
    assert.equal(new URLSearchParams(h.window.location.search).get("place_ref"), "r999");
  } finally { await h.unmount(); }
});
