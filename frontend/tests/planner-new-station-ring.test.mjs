/**
 * Show what changed: after an adjustment lands, each station whose stop
 * carries the New chip rings once in ink, staggered down the line (60ms a
 * station, capped at 180ms). No ring on unchanged stations, none when every
 * station is new (the change line already says so), and the current station
 * keeps its own ember ring. The ring is applied once per rebuild: opening and
 * closing a stop keeps the same disc element and the same class, so the CSS
 * animation never replays.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mountPlanner } from "./helpers/planner-harness.mjs";
import { componentSource } from "./helpers/planner-source.mjs";

const INK_RING = "[--p-ring-rgb:var(--p-color-ink)]";
const RING = "motion-safe:animate-ring-once";

const station = (id, i) => ({ id, label: `Place ${id}`, lat: 55.6 + i * 0.002, lng: 13, type: "museum" });

function lineProps(core, { newIds = [], stale = false, at = null } = {}) {
  const tracking = at != null;
  return {
    lang: "en", t: (sv, en) => en, stale, newStopIdentities: new Set(newIds),
    routeLineIsSketch: false, dayContextNote: null, split: { core, woven: [] }, routeStops: core,
    legForStop: () => null, mapsPlaceContext: "Testville", expandedStopKey: null, setExpandedStopKey: () => {},
    expandedCandidateKey: null, setExpandedCandidateKey: () => {}, commitments: {}, selected: [],
    releaseCommitment: () => {}, keepStop: () => {}, dismissStop: () => {}, removeStop: () => {}, commit: () => {},
    eveningEvent: null, selectedDate: "2026-10-17", dayOffset: 0, routeContextSuggestions: [],
    detoursOpen: false, setDetoursOpen: () => {},
    follow: tracking
      ? { supported: true, state: { status: "tracking", position: { lat: core[at].lat, lng: core[at].lng, accuracy: 10 } }, retry: () => {} }
      : { supported: false, state: { status: "idle" }, retry: () => {} },
    following: tracking, canFollowToday: tracking, onToggleFollow: () => {},
  };
}

async function line(t, core, options) {
  const h = await mountPlanner({ entry: "components/planner/StopLine.tsx", props: lineProps(core, options) });
  t.after(() => h.unmount());
  return h;
}

const items = (root) => [...root.querySelectorAll('ol[aria-label="The stops, in order"] > li')];
/** The station disc inside a stop row. */
const disc = (item) => item.querySelector("button span.border-3");
const inkRing = (item) => {
  const d = disc(item);
  return d.className.includes(INK_RING) && d.className.includes(RING);
};
const delay = (item) => disc(item).style.animationDelay;

const five = ["a", "b", "c", "d", "e"].map(station);

test("only stations carrying the New chip ring in ink; unchanged stations stay still", async (t) => {
  const h = await line(t, five, { newIds: ["id:b", "id:d"] });
  const rows = items(h.container);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(inkRing), [false, true, false, true, false]);
  for (const row of rows) {
    const marked = [...row.querySelectorAll("span")].some((span) => span.textContent === "New");
    assert.equal(inkRing(row), marked, "the ring and the New chip agree");
    if (!marked) assert.doesNotMatch(disc(row).className, /animate-ring-once/, "no ring of any kind on an unchanged station");
  }
});

test("the ring is staggered 60ms a station in line order, capped at 180ms", async (t) => {
  const h = await line(t, [...five, station("f", 5)], { newIds: ["id:a", "id:b", "id:c", "id:d", "id:e"] });
  const rows = items(h.container);
  assert.deepEqual(rows.slice(0, 5).map(delay), ["0ms", "60ms", "120ms", "180ms", "180ms"]);
  assert.equal(inkRing(rows[5]), false);
  assert.equal(delay(rows[5]), "", "an unchanged station carries no delay");
});

test("no ring when every station is new: a full replace is said by the change line", async (t) => {
  const h = await line(t, five, { newIds: five.map((s) => `id:${s.id}`) });
  for (const row of items(h.container)) {
    assert.equal(inkRing(row), false);
    assert.equal(delay(row), "");
  }
});

test("no ring while the day rebuilds", async (t) => {
  const h = await line(t, five, { newIds: ["id:b"], stale: true });
  assert.equal(items(h.container).some(inkRing), false);
});

test("the current station keeps its own ember ring, never a second ink one", async (t) => {
  const h = await line(t, five, { newIds: ["id:b", "id:c", "id:d"], at: 2 });
  const rows = items(h.container);
  const current = disc(rows[2]);
  assert.match(current.className, /motion-safe:animate-ring-once/, "the current station rings");
  assert.equal(current.className.includes(INK_RING), false, "in ember, not ink");
  assert.equal(current.className.split(RING).length - 1, 1, "exactly one ring");
  assert.equal(current.style.animationDelay, "", "its own ring is not staggered");
  // The other new stations keep the stagger among themselves.
  assert.deepEqual([rows[1], rows[3]].map(delay), ["0ms", "60ms"]);
});

test("the ring is ink, plays once, and only under motion-safe", () => {
  const source = componentSource("planner/StopLine.tsx");
  const inkUses = source.split(INK_RING).length - 1;
  assert.equal(inkUses, 1, "one ink ring class in the line");
  assert.match(source, /"\s*\[--p-ring-rgb:var\(--p-color-ink\)\] motion-safe:animate-ring-once"/);
  assert.doesNotMatch(source, /(^|[\s"'`])animate-ring-once/, "never outside motion-safe");
  assert.match(source, /Math\.min\(order \* NEW_RING_STEP_MS, NEW_RING_MAX_DELAY_MS\)/);
  assert.match(source, /const NEW_RING_STEP_MS = 60;/);
  assert.match(source, /const NEW_RING_MAX_DELAY_MS = 180;/);
});

// Through the real planner: a rebuild lands, the added station rings; opening
// and closing stops keeps the very same disc element with the very same class
// and delay, so the browser has nothing to restart.
const DATE = "2026-10-17";
const plannerStops = ["a", "b", "c"].map((id, i) => ({ ...station(id, i), covered_preferences: ["culture"], commitment_eligible: true }));
function day(rows) {
  return {
    days: [{ date: DATE, experimental_agnostic_route_applied: true, primary_route: {
      id: "__agnostic_compose__", main_stops: rows, estimated_km: 2.1, legs: [], map_route_points: [],
      map_path_points: rows.map(({ lat, lng }) => ({ lat, lng })),
    }, alternatives: [] }],
    agnostic_route_output_experiment: {
      intake: { status: "resolved", resolved: { label: "Testville" } },
      promotion: { promote: true, readiness: "promotable" },
      source_status: { status: `loaded:${rows.length}`, collection: { source_completion: { status: "partial", pending: 1, failed: 0, completed: 1 } } },
    },
  };
}
const calls = (h) => h.fetchMock.calls.filter((c) => c.url.startsWith("/api/route-recommendations"));
const button = (h, re) => [...h.container.querySelectorAll("button")].find((b) => re.test(b.textContent.trim()));
const click = (h, target) => {
  assert.ok(target, "the actual control exists");
  return h.act(() => target.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true })));
};

test("a landed rebuild rings the added station once; open and close never re-apply it", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(`${DATE}T10:00:00Z`) });
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&prefs=culture&lang=en" });
  t.after(() => h.unmount());
  await h.fetchMock.respond(calls(h)[0], day(plannerStops));
  assert.equal(items(h.container).some(inkRing), false, "a first day has nothing new");

  await click(h, button(h, /^Look for more places$/));
  assert.equal(items(h.container).some(inkRing), false, "nothing rings while the day rebuilds");
  await h.fetchMock.respond(calls(h)[1], day([...plannerStops, station("d", 3)]));
  let rows = items(h.container);
  assert.deepEqual(rows.map(inkRing), [false, false, false, true]);
  const ringed = disc(rows[3]);
  const ringedClass = ringed.className.match(/\S*animate-ring-once\S*|\[--p-ring-rgb:[^\]]+\]/g).join(" ");
  assert.equal(delay(rows[3]), "0ms");

  // Open the new stop, open another (closing it), then close that one.
  for (const index of [3, 0, 0]) {
    await click(h, items(h.container)[index].querySelector("button[aria-expanded]"));
    rows = items(h.container);
    assert.equal(disc(rows[3]), ringed, "the same disc element: never remounted");
    assert.equal(disc(rows[3]).className.match(/\S*animate-ring-once\S*|\[--p-ring-rgb:[^\]]+\]/g).join(" "), ringedClass, "the same ring class");
    assert.equal(delay(rows[3]), "0ms", "the same delay");
    assert.deepEqual(rows.map(inkRing), [false, false, false, true], "no other station starts ringing");
  }
});

// RANG ONCE. The ink ring and the ember "you are here" ring are one animation
// in two colours: a New station that kept its ink class when it became
// current would only change colour, and the browser would not restart the
// ring, so the arrival cue never played. Once the ink ring has ended, its
// class and delay come off for good; becoming current then adds a fresh ring
// (ember), and leaving "current" never brings the ink ring back.
const RING_END = "parranda-ring-once";
// A browser sends "animationend". jsdom has no AnimationEvent, so React
// listens for the prefixed "webkitAnimationEnd" there; both are sent, and the
// handler records a station at most once.
function animationEnd(h, target, animationName = RING_END) {
  return h.act(() => {
    for (const type of ["animationend", "webkitAnimationEnd"]) {
      const event = new h.window.Event(type, { bubbles: true });
      Object.defineProperty(event, "animationName", { value: animationName });
      target.dispatchEvent(event);
    }
  });
}
const ringClasses = (item) => disc(item).className.match(/\S*animate-ring-once\S*|\[--p-ring-rgb:[^\]]+\]/g) ?? [];

test("a New station whose ink ring has ended rings in ember when it becomes current, and never in ink again", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(`${DATE}T10:00:00Z`) });
  const watches = [];
  const geolocation = {
    watchPosition(ok) { watches.push(ok); return watches.length; },
    clearWatch() {},
  };
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&prefs=culture&lang=en", geolocation, visibilityState: "visible" });
  t.after(() => h.unmount());
  const fix = (stop) => h.act(() => watches.at(-1)({ coords: { latitude: stop.lat, longitude: stop.lng, accuracy: 10 }, timestamp: Date.now() }));
  await h.fetchMock.respond(calls(h)[0], day(plannerStops));
  await click(h, button(h, /^Look for more places$/));
  const added = station("d", 3);
  await h.fetchMock.respond(calls(h)[1], day([...plannerStops, added]));
  let rows = items(h.container);
  assert.deepEqual(rows.map(inkRing), [false, false, false, true]);
  const ringed = disc(rows[3]);

  // Only the disc's own ring counts: another animation, or one bubbling up
  // from inside the disc, leaves the ink ring where it is.
  await animationEnd(h, ringed, "parranda-panel-in");
  assert.equal(inkRing(items(h.container)[3]), true, "another animation's end is not the ring's");
  const inner = h.document.createElement("span");
  ringed.append(inner);
  await animationEnd(h, inner);
  inner.remove();
  assert.equal(inkRing(items(h.container)[3]), true, "a child's animation end is not the disc's");

  // The ink ring ends: its class and delay come off; the New chip stays.
  await animationEnd(h, ringed);
  rows = items(h.container);
  assert.equal(disc(rows[3]), ringed, "the same disc element");
  assert.deepEqual(ringClasses(rows[3]), [], "no ring class once the ink ring has played");
  assert.equal(delay(rows[3]), "");
  assert.ok([...rows[3].querySelectorAll("span")].some((span) => span.textContent === "New"), "the New chip still stands");

  // A re-render (open and close a stop) keeps the record: no ink ring again.
  for (const index of [0, 0]) await click(h, items(h.container)[index].querySelector("button[aria-expanded]"));
  assert.deepEqual(ringClasses(items(h.container)[3]), [], "a re-render does not re-apply the ink ring");

  // Reaching the New station: a fresh ring class is added, in ember, so the
  // browser starts the arrival ring.
  await click(h, button(h, /^Follow the day$/));
  await fix(added);
  assert.match(h.text(), /You're at Place d/);
  rows = items(h.container);
  assert.equal(disc(rows[3]), ringed, "the same disc element, so the ring starts by the class being added");
  assert.deepEqual(ringClasses(rows[3]), [RING], "the ember ring, newly added; not ink");
  assert.equal(delay(rows[3]), "", "the arrival ring is not staggered");

  // Leaving it: the ink ring does not come back.
  await fix(plannerStops[0]);
  assert.match(h.text(), /You're at Place a/);
  rows = items(h.container);
  assert.deepEqual(ringClasses(rows[3]), [], "leaving 'current' never replays the ink ring");
  assert.equal(delay(rows[3]), "");
  await click(h, button(h, /^Stop following$/));
  assert.deepEqual(ringClasses(items(h.container)[3]), [], "nor does ending the follow");
});

test("the ring's end is recorded by the stop, not its index, and only for the ring's own keyframes", () => {
  const source = componentSource("planner/StopLine.tsx");
  assert.match(source, /const RING_ONCE_ANIMATION = "parranda-ring-once";/);
  assert.match(source, /event\.target !== event\.currentTarget \|\| event\.animationName !== RING_ONCE_ANIMATION/);
  assert.match(source, /recordRang\(changeIdentity\)/);
  assert.match(source, /rangIds\.has\(changeIdentity\) \? null : newRingDelays\[i\]/);
  // The keyframes the handler names are the ones the ring class plays.
  const css = componentSource("../styles/tailwind.css");
  assert.match(css, /--animate-ring-once: parranda-ring-once /);
  assert.match(css, /@keyframes parranda-ring-once \{/);
});
