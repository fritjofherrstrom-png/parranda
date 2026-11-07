import assert from "node:assert/strict";
import test from "node:test";
import { mountPlanner } from "./helpers/planner-harness.mjs";
import { encodeShareParams } from "../src/lib/anywhere-share.mjs";

const DATE = "2026-11-07";
const LAST = "parranda:anywhere:last";
const compose = h => h.fetchMock.calls.filter(call => call.url.startsWith("/api/route-recommendations"));
const route = h => h.container.querySelector('ol[aria-label="The stops, in order"]')?.textContent || "";
const chooser = h => h.container.querySelector('[aria-label="All interests"]');
const button = (root, name) => [...root.querySelectorAll("button")].find(b => (b.getAttribute("aria-label") || b.textContent.trim()) === name);
const intake = { status: "resolved", resolved: { label: "Testville", lat: 55.6, lng: 13 } };

function day(name, covered = ["food"], extra = {}) {
  return {
    days: [{
      date: DATE, experimental_agnostic_route_applied: true,
      primary_route: { id: "__agnostic_compose__", main_stops: [
        { id: "one", type: "restaurant", label: name, lat: 55.6, lng: 13, covered_preferences: covered },
        { id: "two", type: "museum", label: "Other stop", lat: 55.602, lng: 13, covered_preferences: ["museums"] },
      ], estimated_km: 1, legs: [], confidence: "low" },
    }],
    agnostic_route_output_experiment: { intake, promotion: { promote: true } },
    ...extra,
  };
}

async function start(t, url = "place=Testville&prefs=food,culture", { response = day("Previous stop") } = {}) {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(DATE + "T10:00:00Z") });
  const h = await mountPlanner({ url: `http://localhost/anywhere?${url}&lang=en` });
  t.after(() => h.unmount());
  if (response) await h.fetchMock.respond(compose(h)[0], response);
  return h;
}

async function click(h, name, root = h.container) {
  const target = button(root, name);
  assert.ok(target, `expected ${name}`);
  await h.act(() => target.click());
  return target;
}

async function open(h) {
  if (!button(h.container, "All interests")) await click(h, "Adjust");
  await click(h, "All interests");
  assert.ok(chooser(h), "the grouped editor is visible");
  return chooser(h);
}

test("grouped edits are drafted across groups and one apply sends the capped selection in priority order", async t => {
  const h = await start(t);
  const editor = await open(h);
  assert.deepEqual([...editor.querySelectorAll("legend")].map(el => el.textContent), [
    "Food & coffee", "Art & history", "Outdoors & by the water", "Markets & finds", "Evening & live",
  ]);
  assert.ok(button(editor, "Remove Food & drink"), "legacy quick choices remain editable");
  await click(h, "Clear selection", editor);
  const picks = ["Flea markets", "Second hand", "Cafés", "Art galleries", "Parks & gardens", "Swimming spots", "Cheap eats"];
  for (const name of picks) await click(h, name, editor);
  assert.equal(button(editor, "Live music").getAttribute("aria-disabled"), "true");
  await click(h, "Live music", editor);
  await click(h, "Make Cafés first", editor);
  await h.clock.advance(1000);
  assert.equal(compose(h).length, 1, "draft actions never compose");
  assert.match(route(h), /Previous stop/);
  await click(h, "Update day", editor);
  await h.clock.advance(1000);
  assert.equal(compose(h).length, 2);
  assert.equal(h.document.activeElement, button(h.container, "All interests"));
  const request = compose(h)[1];
  assert.deepEqual(request.body.dates, [DATE]);
  assert.deepEqual(request.body.preferences, ["flea_markets", "second_hand", "cafes", "art_galleries", "parks_gardens", "bathing_places", "cheap_eats"]);
  assert.deepEqual(request.body.preference_priority, ["cafes", "flea_markets", "second_hand", "art_galleries", "parks_gardens", "bathing_places", "cheap_eats"]);
  assert.match(route(h), /Previous stop/);
  await h.fetchMock.respond(request, day("A matching café", ["cafes"]));
  assert.match(route(h), /A matching café/);
  const coverage = h.container.querySelector('[aria-label="Your picks in this day"]').textContent;
  assert.match(coverage, /Cafés.*in this day/);
  assert.match(coverage, /Flea markets.*not in this day/);
  assert.deepEqual(h.readStorage(LAST).inputs.preferencePriority, request.body.preference_priority);
  await click(h, "Undo this change");
  assert.match(route(h), /Previous stop/);
  assert.deepEqual(h.readStorage(LAST).inputs.selected, ["food", "culture"]);
});

for (const dismissal of ["Cancel", "Escape"]) test(`${dismissal} discards the draft and returns focus to All interests`, async t => {
  const h = await start(t);
  const editor = await open(h);
  assert.equal(h.document.activeElement.textContent, "All interests");
  await click(h, "Clear selection", editor);
  const option = await click(h, "Wine bars", editor);
  if (dismissal === "Cancel") await click(h, "Cancel", editor);
  else await h.act(() => option.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(chooser(h), null);
  assert.equal(h.document.activeElement, button(h.container, "All interests"));
  await h.clock.advance(1000);
  assert.equal(compose(h).length, 1);
  const reopened = await open(h);
  assert.ok(button(reopened, "Remove Food & drink"));
  assert.equal(button(reopened, "Wine bars").getAttribute("aria-pressed"), "false");
});

test("an uncovered grouped result leaves the previous dated day and exact saved inputs on screen", async t => {
  const h = await start(t);
  const previous = h.readStorage(LAST);
  const editor = await open(h);
  await click(h, "Clear selection", editor);
  await click(h, "Swimming spots", editor);
  await click(h, "Update day", editor);
  await h.clock.advance(400);
  await h.fetchMock.respond(compose(h).at(-1), day("A generic route", ["parks_gardens"]));
  assert.match(route(h), /Previous stop/);
  assert.doesNotMatch(route(h), /A generic route/);
  assert.deepEqual(h.readStorage(LAST), previous);
  assert.match(h.text(), /couldn’t confirm a walkable day with these interests.*previous day is still shown/is);
  const edit = await click(h, "Edit interests");
  assert.equal(button(chooser(h), "Swimming spots").getAttribute("aria-pressed"), "true");
  await click(h, "Cancel", chooser(h));
  assert.ok(h.document.activeElement === edit, "focus returns to Edit interests");
  await click(h, "Undo this change");
  assert.deepEqual(h.readStorage(LAST), previous);
  assert.doesNotMatch(h.text(), /couldn’t confirm a walkable day with these interests/i);
});

test("a direct grouped choice without a day offers editing and exposes verified selected-date music from Live", async t => {
  const event = {
    id: "event-1", title: "Verified concert", starts_at: DATE + "T18:00:00Z", occurrence_date: DATE,
    source_url: "https://example.org/concert", matched_preferences: ["live_music"], tags: ["music"],
  };
  const h = await start(t, "place=Testville&prefs=live_music", { response: {
    days: [], agnostic_route_output_experiment: { intake },
    live_events: { coverage: "covered", selected_date: DATE, tonight: [event] },
  } });
  assert.equal(compose(h)[0].body.preferences[0], "live_music", "legacy input URLs accept grouped keys");
  assert.equal(route(h), "");
  assert.match(h.text(), /couldn’t confirm a walkable day with these interests/i);
  assert.match(h.text(), /Live music is listed in Live/i);
  assert.match(h.text(), /Verified concert/);
  await click(h, "Edit interests");
  assert.equal(button(chooser(h), "Live music").getAttribute("aria-pressed"), "true");
});

test("an explicitly empty URL selection composes empty, and does not restore the legacy defaults", async t => {
  const query = encodeShareParams({ place: "Testville", preferences: [] });
  const h = await start(t, query, { response: null });
  assert.deepEqual(compose(h)[0].body.preferences, []);
});

test("an interest compose waits for its own Live upgrade before deciding whether music fits", async t => {
  const h = await start(t);
  const editor = await open(h);
  await click(h, "Clear selection", editor);
  await click(h, "Live music", editor);
  await click(h, "Update day", editor);
  await h.fetchMock.respond(compose(h)[1], day("Provisional stop", ["food"], {
    live_events: { coverage: "covered", selected_date: DATE, pending: true },
    live_completion: { version: 1, token: "live-interest-capability", expires_in_ms: 120000, route_upgrade: "explicit_request" },
  }));
  assert.match(route(h), /Previous stop/);
  assert.doesNotMatch(h.text(), /couldn’t confirm a walkable day/i);
  await h.clock.advance(2000);
  const completion = h.fetchMock.pending().find(call => call.url === "/api/planner-live-completion");
  assert.ok(completion, "the original capability is followed");
  const liveEvents = { coverage: "covered", selected_date: DATE, tonight: [
    { id: "verified", title: "Verified concert", starts_at: DATE + "T18:00:00Z", matched_preferences: ["live_music"] },
  ] };
  await h.fetchMock.respond(completion, {
    live_events: liveEvents, live_completion: { version: 1, state: "ready", route_upgrade: "explicit_request" },
  });
  const upgrade = h.fetchMock.pending().find(call => call.url === "/api/planner-live-route-upgrade");
  assert.ok(upgrade);
  await h.fetchMock.respond(upgrade, {
    live_route_upgrade: { version: 1, state: "applied" },
    result: day("Walk with music", ["live_music"], { live_events: liveEvents }),
  });
  assert.match(route(h), /Walk with music/);
  assert.doesNotMatch(h.text(), /couldn’t confirm a walkable day/i);
  assert.equal(compose(h).length, 2);
  assert.deepEqual(h.readStorage(LAST).inputs.selected, ["live_music"]);
});

const FIRST_REF = "a".repeat(48);
const UPDATED_REF = "b".repeat(48);
const ready = (ref, expiry = "2026-11-08T10:00:00Z") => ({
  version: 1, state: "ready", ref, created_at: DATE + "T09:00:00Z", expires_at: expiry,
});

async function applyShareableInterest(h) {
  const editor = await open(h);
  await click(h, "Clear selection", editor);
  await click(h, "Cafés", editor);
  await click(h, "Update day", editor);
  await h.fetchMock.respond(compose(h).at(-1), day("New café", ["cafes"], { day_snapshot: ready(UPDATED_REF) }));
  assert.match(route(h), /New café/);
}

test("grouped Undo restores the exact Share link for the prior published day", async t => {
  const h = await start(t, undefined, { response: day("Previous stop", ["food"], { day_snapshot: ready(FIRST_REF) }) });
  const copied = [];
  Object.defineProperty(h.window.navigator, "clipboard", { value: { writeText: async href => copied.push(href) } });
  await applyShareableInterest(h);
  await click(h, "Share this day");
  assert.equal(new URL(copied.at(-1)).searchParams.get("snapshot"), UPDATED_REF);
  await click(h, "Undo this change");
  await h.clock.advance(2500);
  assert.match(route(h), /Previous stop/);
  await click(h, "Share this day");
  assert.equal(new URL(copied.at(-1)).searchParams.get("snapshot"), FIRST_REF);
  assert.equal(compose(h).length, 2, "undo and sharing do not compose again");
});

test("grouped Undo offers no Share if the previous publication expired after apply", async t => {
  const h = await start(t, undefined, { response: day("Previous stop", ["food"], { day_snapshot: ready(FIRST_REF, DATE + "T10:01:00Z") }) });
  await applyShareableInterest(h);
  assert.ok(button(h.container, "Share this day"), "the new day has a valid publication");
  t.mock.timers.setTime(Date.parse(DATE + "T10:02:00Z"));
  await click(h, "Undo this change");
  assert.match(route(h), /Previous stop/);
  assert.equal(button(h.container, "Share this day"), undefined);
});

test("grouped Undo of a public day returns to the original read-only publication", async t => {
  const h = await start(t, `snapshot=${FIRST_REF}`, { response: null });
  const original = day("Previous stop", ["food"], {
    agnostic_route_output_experiment: {
      synthesized_via: "agnostic_compose_engine", route_mutation: true, eligibility: { eligible: true },
      intake: { ...intake, mode: "place", resolved: { ...intake.resolved, place_ref: "r123", confidence: "high" } },
      promotion: { promote: true },
      pinned_candidates: { requested_count: 0, honored_count: 0, unhonored_count: 0, unhonored: [] },
    },
  });
  const { version, ref, created_at, expires_at } = ready(FIRST_REF);
  await h.fetchMock.respond(h.fetchMock.calls[0], {
    version, ref, created_at, expires_at, language: "en",
    intent: { dateIso: DATE, place: "Testville", placeLabel: "Testville", placeRef: "r123", mode: "typed",
      selected: ["food", "culture"], walkKey: "balanced", excludedCandidateIds: [], pinnedCandidateIds: [], liveEventChoices: [] },
    result: original,
  });
  assert.match(route(h), /Previous stop/);
  assert.match(h.text(), /Saved day/);
  await applyShareableInterest(h);
  assert.equal(new URL(h.window.location.href).searchParams.get("snapshot"), null);
  await click(h, "Undo this change");
  assert.match(route(h), /Previous stop/);
  assert.match(h.text(), /Saved day/);
  assert.equal(new URL(h.window.location.href).searchParams.get("snapshot"), FIRST_REF);
  assert.ok(button(h.container, "Share this day"));
  assert.equal(compose(h).length, 1);
});
