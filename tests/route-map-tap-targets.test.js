"use strict";

/**
 * A tap on a route stop's visible number opens that stop.
 *
 * Each numbered marker was a transparent 72px Leaflet icon, so that a clustered
 * stop's disc could be drawn up to 36px beside its coordinate, and Leaflet
 * stacks markers by screen y. The lower of two stops drawn about 40px apart
 * covered its neighbour's number: at 390px a tap or hover on stop 3 opened
 * stop 2's name. Leaving only the 44px box around each disc tappable is not
 * enough either: on a 320px phone the diagonal day is drawn with stops 20px
 * apart, and a neighbour's 44px box still covered a visible number.
 *
 * Now a stop is drawn twice at the same place (RouteMap.tsx), both as 44px
 * icons anchored where its disc is drawn: its disc and number in Leaflet's
 * marker pane, and its touch target in a pane beneath every disc.
 *
 * This opens the real Planner in Chromium at 320, 390 and 1280px, collapsed and
 * expanded, and checks every marker whose number is visible:
 *   - the element at the centre of its disc is its own disc;
 *   - hovering its number, and tapping it on a touch screen, opens its own
 *     stop's name and no other, and the taps leave the map where it was (a
 *     tapped marker takes the focus, and Leaflet pans a focused marker's whole
 *     icon into view: the 72px icon moved the map up to 12px);
 *   - around its disc, wherever no other stop and no map control is drawn, the
 *     element under the pointer is its 44px target, and hovering there opens
 *     its name. (On a touch screen Chromium moves a tap beside a disc onto the
 *     nearest element it thinks tappable: the disc itself, a neighbour, or a
 *     map control. That is the browser's guess, not this page's hit test.)
 *
 * A number whose centre is drawn under another stop's disc is not visible, and
 * cannot be tapped at all: a tap there opens the stop drawn on top, which is
 * what a person sees. That is how a dense day is drawn on a small map, not how
 * a marker takes a tap, and it is tracked, as blocking, in #531. The test holds
 * that boundary both ways: a hidden number in a view #531 does not list fails,
 * and so does a listed view that no longer hides one (the entry then goes, and
 * the test becomes strict there).
 *
 * The days are the ones that reproduced the fault (the diagonal day, both
 * corners), every corner, a clustered pair drawn beside its coordinates, and
 * route-map-controls.test.js's clustered north-east corner, which hides numbers
 * on a collapsed phone map.
 *
 * Not evidence of keyboard access to the markers, nor of any real phone or of
 * iOS Safari: those are separate boundaries. This is headless Chromium with a
 * mouse and emulated touch.
 *
 * /api/route-recommendations is answered inside the browser from a fixture and
 * every other host, map tiles included, is refused, so no provider or live
 * network runs.
 *
 * Needs Chromium: PARRANDA_TEST_CHROMIUM=<executable>, a Playwright-managed
 * browser (`npx playwright-core install chromium`), or Google Chrome, which
 * GitHub-hosted runners ship. Without one it skips locally and fails in CI.
 */

const assert = require("node:assert/strict");
const { once } = require("node:events");
const test = require("node:test");

const { buildApp } = require("../server/app");

const FIXTURE_DATE = "2026-09-27";
const FIXED_NOW = Date.parse(`${FIXTURE_DATE}T10:00:00Z`);
const WIDTHS = [320, 390, 1280];
// The Tailwind transition is 150ms and the Planner re-fits on transitionend,
// or after 400ms if none comes; wait past both before measuring.
const SETTLE_MS = 600;

const CHROMIUM_LAUNCHES = [
  process.env.PARRANDA_TEST_CHROMIUM && { executablePath: process.env.PARRANDA_TEST_CHROMIUM },
  {},
  { channel: "chrome" },
].filter(Boolean);

function stop(id, lat, lng) {
  return { id, label: `Stop ${id.toUpperCase()}`, lat, lng, type: "museum", daypart: "afternoon" };
}

// The woven evening event, as event-route-stop-weave appends it: last.
function liveStop(lat, lng) {
  return {
    id: "live-event-ev-quay",
    label: "Quay concert",
    lat,
    lng,
    daypart: "evening",
    is_live_event: true,
    event_id: "ev-quay",
    starts_at: `${FIXTURE_DATE}T17:00:00Z`,
    timezone: "Europe/Stockholm",
  };
}

const DAYS = {
  // The 2 km day that reproduced the fault: at 390px its stops are drawn about
  // 40px apart, at 320px about 20px apart.
  "diagonal, Live stop north-east": [
    stop("a", 55.595, 12.99),
    stop("b", 55.598, 12.998),
    stop("c", 55.601, 13.004),
    stop("d", 55.603, 13.01),
    liveStop(55.606, 13.018),
  ],
  // The same fault with the lower stop earlier in the day, and later.
  "north-east corner (the Live stop)": [
    stop("a", 55.5982, 12.9905),
    stop("b", 55.6005, 12.997),
    stop("c", 55.6021, 13.003),
    stop("d", 55.6036, 13.0085),
    liveStop(55.605, 13.0125),
  ],
  "north-west corner": [
    stop("a", 55.605, 12.9905),
    stop("b", 55.6036, 12.9945),
    stop("c", 55.6021, 13.0),
    stop("d", 55.6005, 13.006),
    liveStop(55.5982, 13.0125),
  ],
  // Stops far apart, beside the zoom bar, the expand button and the attribution.
  "every corner": [
    stop("a", 55.5982, 12.9905),
    stop("b", 55.605, 12.9905),
    stop("c", 55.605, 13.0125),
    liveStop(55.5982, 13.0125),
  ],
  // Two stops 90 m apart across the route: each disc is drawn 36px beside its
  // coordinate, which is what the 72px shell is for.
  "clustered pair across the route": [
    stop("a", 55.6, 12.985),
    stop("b", 55.6, 12.997),
    stop("c", 55.6004, 13.006),
    stop("d", 55.5996, 13.006),
    liveStop(55.6, 13.02),
  ],
  // The dense day: the Live stop 80 m from stop d in the north-east corner. On
  // a collapsed phone map it is fitted far out, and discs cover numbers.
  "clustered north-east corner": [
    stop("a", 55.595, 12.99),
    stop("b", 55.598, 12.998),
    stop("c", 55.601, 13.004),
    stop("d", 55.6055, 13.0165),
    liveStop(55.6062, 13.0178),
  ],
};

// The views in which a stop's number is drawn under another stop's disc today,
// and so cannot be seen or tapped: tracked, and blocking, in #531. Each view
// listed must still hide a number; every other view must hide none.
const HIDDEN_NUMBERS_ISSUE = "https://github.com/fritjofherrstrom-png/parranda/issues/531";
const HIDDEN_NUMBER_VIEWS = new Set([
  "clustered north-east corner at 320px, collapsed",
  "clustered north-east corner at 390px, collapsed",
]);

function composedDay(stops) {
  return {
    days: [
      {
        date: FIXTURE_DATE,
        experimental_agnostic_route_applied: true,
        primary_route: {
          id: "__agnostic_compose__",
          main_stops: stops,
          estimated_km: 2.4,
          legs: [],
          map_route_points: [],
          map_path_points: stops.map(({ lat, lng }) => ({ lat, lng })),
          confidence: "low",
        },
        alternatives: [],
      },
    ],
    // With source-backed structure and settled Live, no silent re-ask follows.
    place_structure: {
      provenance: "agnostic_anchor",
      area_count: 1,
      district_day: {
        areas: [{ center: { lat: stops[0].lat, lng: stops[0].lng }, stops: [] }],
        legs: [],
        covered_intents: [],
        missing_intents: [],
      },
    },
    live_events: { coverage: "covered", tonight: [], this_week: [] },
    agnostic_route_output_experiment: { promotion: { promote: true, readiness: "promotable" } },
  };
}

// --- browser + server ---------------------------------------------------

let runtime;

function startRuntime() {
  runtime ??= (async () => {
    let chromium;
    try {
      ({ chromium } = require("playwright-core"));
    } catch (error) {
      return { unavailable: `playwright-core is not installed (${error.code || error.message})` };
    }
    const errors = [];
    let browser = null;
    for (const options of CHROMIUM_LAUNCHES) {
      try {
        browser = await chromium.launch(options);
        break;
      } catch (error) {
        errors.push(`${JSON.stringify(options)}: ${error.message.split("\n")[0]}`);
      }
    }
    if (!browser) return { unavailable: `no Chromium could be launched (${errors.join("; ")})` };
    const server = buildApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    return { browser, server, origin: `http://127.0.0.1:${server.address().port}` };
  })();
  return runtime;
}

test.after(async () => {
  const current = await runtime;
  await current?.browser?.close();
  if (current?.server) {
    current.server.closeAllConnections();
    await new Promise((resolve) => current.server.close(resolve));
  }
});

async function openRuntime(t) {
  const current = await startRuntime();
  if (!current.unavailable) return current;
  // CI must never lose this check silently.
  assert.ok(!process.env.CI, `the route map tap target check needs Chromium in CI: ${current.unavailable}`);
  t.skip(
    `${current.unavailable}; install Google Chrome, run \`npx playwright-core install chromium\`, or set PARRANDA_TEST_CHROMIUM`,
  );
  return null;
}

async function openDay({ browser, origin }, { width, stops }) {
  const context = await browser.newContext({
    viewport: { width, height: width >= 1024 ? 800 : 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/route-recommendations") return route.fulfill({ json: composedDay(stops) });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "not part of this check" } });
    return route.continue();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto(`${origin}/anywhere?place=Testville&lang=sv`);
  const route = page.getByRole("region", { name: "Rutten" });
  await route.locator(".route-map-marker").nth(stops.length - 1).waitFor();
  await route.getByText("Ritar kartan …").waitFor({ state: "detached" });
  return { context, page, route, pageErrors };
}

// --- in the page ---------------------------------------------------------

// Runs in the page. Brings the whole map into view (elementFromPoint sees only
// the viewport), then finds the numbers drawn under another disc, and checks
// what a tap on each visible number, and around its disc, would hit.
function measureMarkers() {
  const container = document.querySelector('section[aria-label="Rutten"] .leaflet-container');
  container.scrollIntoView({ block: "center" });
  const frame = container.parentElement;
  const map = container.getBoundingClientRect();
  const problems = [];
  if (map.top < 0 || map.bottom > innerHeight) problems.push("the map does not fit in the viewport");

  const markers = [...frame.querySelectorAll(".route-map-marker")].map((element) => {
    const rect = element.getBoundingClientRect();
    const inset = parseFloat(getComputedStyle(element, "::before").top) || 0;
    return {
      element,
      name: `marker ${element.textContent.trim()}`,
      x: (rect.left + rect.right) / 2,
      y: (rect.top + rect.bottom) / 2,
      radius: (rect.right - rect.left) / 2 - inset,
      // The stop's touch target is the same 44px box, drawn in the pane beneath.
      half: (rect.right - rect.left) / 2,
      // Leaflet stacks markers by this: the higher one is drawn on top.
      z: Number(element.closest(".leaflet-marker-icon").style.zIndex) || 0,
    };
  });
  // A number is hidden when its centre lies under a disc drawn above it.
  const coveredBy = (marker) =>
    markers.filter((other) => other.z > marker.z && Math.hypot(marker.x - other.x, marker.y - other.y) < other.radius);
  const controls = [...frame.querySelectorAll(".leaflet-control, [data-map-control]")].map((element) => element.getBoundingClientRect());
  const centredOn = (element) => {
    const rect = element.getBoundingClientRect();
    const x = (rect.left + rect.right) / 2;
    const y = (rect.top + rect.bottom) / 2;
    return markers.find((marker) => Math.abs(marker.x - x) < 0.5 && Math.abs(marker.y - y) < 0.5);
  };
  // Which stop, if any, the element at a point belongs to, and what it is.
  const hitAt = (x, y) => {
    const element = document.elementFromPoint(x, y);
    const disc = element?.closest(".route-map-marker");
    if (disc) return { owner: markers.find((marker) => marker.element === disc), what: "disc" };
    const target = element?.closest(".route-map-target");
    if (target) return { owner: centredOn(target), what: "touch target" };
    const icon = element?.closest(".route-map-marker-shell");
    if (icon) return { owner: markers.find((marker) => icon.contains(marker.element)), what: "icon" };
    if (element?.closest(".leaflet-control, [data-map-control]")) return { owner: null, what: "a map control" };
    return { owner: null, what: element ? `<${element.tagName.toLowerCase()} class="${element.className}">` : "nothing" };
  };
  const describe = ({ owner, what }) =>
    owner ? `${owner.name}'s ${what}` : what === "touch target" ? "a touch target on no stop's disc" : what;
  // A point only this stop's 44px target covers: clear of every other stop's
  // target and of every control, by a pixel for rounding.
  const clearOf = (marker, x, y) =>
    !markers.some(
      (other) => other !== marker && Math.abs(other.x - x) < other.half + 1 && Math.abs(other.y - y) < other.half + 1,
    ) && !controls.some((box) => x > box.left - 1 && x < box.right + 1 && y > box.top - 1 && y < box.bottom + 1);

  let targetsChecked = 0;
  const measured = markers.map((marker) => {
    const hiddenUnder = coveredBy(marker).map((other) => other.name);
    // Out of this test's scope, and reported to it: see #531.
    if (hiddenUnder.length) return { name: marker.name, x: marker.x, y: marker.y, hiddenUnder, aside: null };

    const hit = hitAt(marker.x, marker.y);
    if (hit.owner !== marker || hit.what !== "disc") problems.push(`a tap on ${marker.name}'s number hits ${describe(hit)}`);

    // Around the disc, inside the 44px target, wherever nothing else is drawn.
    const around = [[20, 0], [-20, 0], [0, 20], [0, -20], [20, 20], [-20, 20], [20, -20], [-20, -20]]
      .filter(([dx, dy]) => clearOf(marker, marker.x + dx, marker.y + dy));
    for (const [dx, dy] of around) {
      targetsChecked += 1;
      const aside = hitAt(marker.x + dx, marker.y + dy);
      if (aside.owner !== marker) problems.push(`a tap ${dx},${dy}px from ${marker.name}'s centre hits ${describe(aside)}`);
    }
    return { name: marker.name, x: marker.x, y: marker.y, hiddenUnder, aside: around[0] ?? null };
  });
  if (!targetsChecked) problems.push("no marker's 44px target was clear of its neighbours and the controls to check");
  return { markers: measured, problems };
}

// Runs in the page: where each marker's disc is now.
function markerCentres() {
  return [...document.querySelectorAll('section[aria-label="Rutten"] .route-map-marker')].map((element) => {
    const rect = element.getBoundingClientRect();
    return { name: `marker ${element.textContent.trim()}`, x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  });
}

// Runs in the page: the names Leaflet has open, or null. A closed tooltip
// fades out at opacity 0 before it is removed.
function openNames() {
  const names = [...document.querySelectorAll(".leaflet-tooltip-pane .leaflet-tooltip")]
    .filter((tooltip) => tooltip.style.opacity !== "0")
    .map((tooltip) => tooltip.textContent.trim());
  return names.length ? names : null;
}

// Runs in the page, once: records every name a tap opens and when its click
// has arrived. Chromium with both a touch screen and a mouse hovers back to the
// mouse right after a tap (the test parks it off the map), which closes the
// name again; a phone has no mouse to go back to. What counts is what opened.
function recordTaps() {
  const pane = document.querySelector('section[aria-label="Rutten"] .leaflet-tooltip-pane');
  window.tapRecord = { clicked: false, opened: [] };
  new MutationObserver(() => {
    for (const tooltip of pane.querySelectorAll(".leaflet-tooltip")) {
      if (tooltip.style.opacity !== "0") window.tapRecord.opened.push(tooltip.textContent.trim());
    }
  }).observe(pane, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  document.addEventListener("click", () => {
    window.tapRecord.clicked = true;
  }, true);
  // The test taps one stop after another within milliseconds, which Chromium
  // reads as a double tap, and Leaflet zooms the map in on one. A person
  // tapping the next stop does not; keep every tap a single tap.
  document.addEventListener("dblclick", (event) => event.stopPropagation(), true);
}

// --- checks ---------------------------------------------------------------

function named(names) {
  return names.length ? [...new Set(names)].join(" and ") : "no name";
}

async function moveClockOn(page) {
  await page.clock.setFixedTime((await page.evaluate(() => Date.now())) + 1_000);
}

async function nameOpenedByHover(page, x, y) {
  await page.mouse.move(x, y);
  const opened = await page.waitForFunction(openNames, null, { timeout: 2_000 }).catch(() => null);
  return named(opened ? await opened.jsonValue() : []);
}

async function nameOpenedByTap(page, x, y) {
  await page.evaluate(() => {
    window.tapRecord = { clicked: false, opened: [] };
  });
  await page.touchscreen.tap(x, y);
  // Polled on the next frame, after Leaflet has handled the click.
  const record = await page
    .waitForFunction(() => window.tapRecord.clicked && window.tapRecord, null, { timeout: 2_000 })
    .catch(() => null);
  return record ? named((await record.jsonValue()).opened) : "nothing (no click arrived)";
}

// Checks one view; returns what failed, and the numbers it found hidden.
async function checkMarkers(page, stops, where) {
  const { markers, problems } = await page.evaluate(measureMarkers);
  const found = problems.map((problem) => `${where}: ${problem}`);
  if (markers.length !== stops.length) found.push(`${where}: ${markers.length} of ${stops.length} markers drawn`);
  const labels = new Map(stops.map((stop, index) => [`marker ${index + 1}`, stop.label]));
  const expect = (name, action, opened) => {
    if (opened !== labels.get(name)) found.push(`${where}: ${action} opens ${opened}, not ${labels.get(name)}`);
  };
  const visible = markers.filter(({ hiddenUnder }) => !hiddenUnder.length);
  const hidden = markers.filter(({ hiddenUnder }) => hiddenUnder.length).map(({ name, hiddenUnder }) => ({ name, hiddenUnder }));

  // With the mouse: every visible number, then every 44px target beside its
  // disc. One stop after another, so each hover has to close the name before it.
  for (const { name, x, y } of visible) {
    expect(name, `hovering ${name}'s number`, await nameOpenedByHover(page, x, y));
  }
  for (const { name, x, y, aside } of visible) {
    if (aside) expect(name, `hovering ${name}'s 44px target`, await nameOpenedByHover(page, x + aside[0], y + aside[1]));
  }

  // With the touch screen: every visible number. The mouse waits off the map,
  // so that it closes the last name and opens none while the touch screen taps.
  await page.mouse.move(1, 1);
  for (const { name, x, y } of visible) {
    // Leaflet counts two touch taps within 200ms of Date.now() as a double tap
    // and zooms in. The clock is fixed, so move it on as a person's taps would.
    await moveClockOn(page);
    expect(name, `tapping ${name}'s number`, await nameOpenedByTap(page, x, y));
  }

  // A tapped marker takes the focus, and Leaflet pans a focused marker's icon
  // into view. The icons are the 44px boxes the fit keeps on the map, so no tap
  // may move it. (The pan runs on the page's clock: move it on, then look.)
  await moveClockOn(page);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const moved = Math.max(
    ...(await page.evaluate(markerCentres)).map(({ name, x, y }) => {
      const measured = markers.find((marker) => marker.name === name);
      return Math.hypot(x - measured.x, y - measured.y);
    }),
  );
  if (moved >= 1) found.push(`${where}: tapping the numbers moved the map ${Math.round(moved)}px`);
  return { found, hidden };
}

for (const width of WIDTHS) {
  test(`route stop numbers on the map at ${width}px, collapsed and expanded`, { timeout: 180_000 }, async (t) => {
    const current = await openRuntime(t);
    if (!current) return;
    const problems = [];
    const hiddenByView = new Map();
    for (const [dayName, stops] of Object.entries(DAYS)) {
      const { context, page, route, pageErrors } = await openDay(current, { width, stops });
      try {
        await page.evaluate(recordTaps);
        for (const state of ["collapsed", "expanded"]) {
          if (state === "expanded") {
            await route.getByRole("button", { name: "Förstora kartan" }).click();
            await page.waitForTimeout(SETTLE_MS);
          }
          const where = `${dayName} at ${width}px, ${state}`;
          const { found, hidden } = await checkMarkers(page, stops, where);
          problems.push(...found);
          hiddenByView.set(where, hidden);
        }
        if (pageErrors.length) problems.push(`${dayName} at ${width}px: the Planner threw: ${pageErrors.join("; ")}`);
      } finally {
        await context.close();
      }
    }

    await t.test("a tap or hover on every visible number opens that stop", () => {
      assert.deepEqual(problems, [], `visible route stop numbers that do not open their own stop:\n${problems.join("\n")}`);
    });

    await t.test("numbers are hidden only in the views #531 tracks", (st) => {
      const outside = [];
      for (const [where, hidden] of hiddenByView) {
        const list = hidden.map(({ name, hiddenUnder }) => `${name} under ${hiddenUnder.join(", ")}`).join("; ");
        if (HIDDEN_NUMBER_VIEWS.has(where)) {
          if (hidden.length) st.diagnostic(`${where}: hidden, not tappable (${HIDDEN_NUMBERS_ISSUE}): ${list}`);
          else outside.push(`${where}: no number is hidden any more; take the view off the list and update ${HIDDEN_NUMBERS_ISSUE}`);
        } else if (hidden.length) {
          outside.push(`${where}: ${list}`);
        }
      }
      assert.deepEqual(outside, [], `hidden route stop numbers outside ${HIDDEN_NUMBERS_ISSUE}'s views:\n${outside.join("\n")}`);
    });
  });
}
