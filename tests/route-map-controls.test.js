"use strict";

/**
 * Route markers never sit under the map's own controls.
 *
 * On a phone the Planner's map is a strip about 190px tall with Leaflet's zoom
 * bar in the top-left corner, the attribution along the bottom and the expand
 * button in the top-right corner. A fit that padded the day by one symmetric
 * margin put the day's outermost stop under a control: at 390px the woven Live
 * stop, which the engine appends last, was covered by the expand button and a
 * tap on its centre hit the button.
 *
 * This opens the real Planner in Chromium with synthetic days that reach each
 * corner, the Live stop last in every one, and checks every marker's visible
 * disc against the expand button, the zoom bar and the attribution at 320, 390
 * and 1280px: collapsed, expanded and collapsed again, since the day is fitted
 * again after each transition. A disc below the fold is scrolled into view
 * before its centre is hit-tested, and a centre that cannot be hit-tested
 * fails. The expanded map must show the day at least as close as the collapsed
 * one. Presentation only: the fixture's stops are drawn as given.
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
const FIXED_NOW = new Date(`${FIXTURE_DATE}T10:00:00Z`);
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

// Days shaped to fill the map, so a fit that ignored the controls would put a
// stop in each corner they occupy.
const DAYS = {
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
  "every corner": [
    stop("a", 55.5982, 12.9905),
    stop("b", 55.605, 12.9905),
    stop("c", 55.605, 13.0125),
    liveStop(55.5982, 13.0125),
  ],
  // The 2 km day that reproduced the fault: the Live stop is the north-east end.
  "diagonal, Live stop north-east": [
    stop("a", 55.595, 12.99),
    stop("b", 55.598, 12.998),
    stop("c", 55.601, 13.004),
    stop("d", 55.603, 13.01),
    liveStop(55.606, 13.018),
  ],
  // Two stops 80 m apart are drawn beside their coordinates, one of them
  // further into the north-east corner than its coordinate.
  "clustered north-east corner": [
    stop("a", 55.595, 12.99),
    stop("b", 55.598, 12.998),
    stop("c", 55.601, 13.004),
    stop("d", 55.6055, 13.0165),
    liveStop(55.6062, 13.0178),
  ],
};

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
  assert.ok(!process.env.CI, `the route map control check needs Chromium in CI: ${current.unavailable}`);
  t.skip(
    `${current.unavailable}; install Google Chrome, run \`npx playwright-core install chromium\`, or set PARRANDA_TEST_CHROMIUM`,
  );
  return null;
}

async function openDay({ browser, origin }, { width, stops }) {
  const context = await browser.newContext({
    viewport: { width, height: width >= 1024 ? 800 : 844 },
    deviceScaleFactor: 1,
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

// Runs in the page: every marker's visible disc (the 44px marker's ::before)
// against the map and each control, by geometry and by hit test. It may scroll
// the page.
function measureMap(expandNames) {
  const frame = document.querySelector('section[aria-label="Rutten"] .leaflet-container').parentElement;
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  };
  const round = (b) => `x ${Math.round(b.left)}-${Math.round(b.right)}, y ${Math.round(b.top)}-${Math.round(b.bottom)}`;
  const map = box(frame.querySelector(".leaflet-container"));
  // Found by its accessible name, whether that is a label or visible text.
  const expand = [...frame.querySelectorAll("button")].find((button) =>
    expandNames.includes((button.getAttribute("aria-label") || button.textContent || "").trim()),
  );
  const controls = {
    "the expand button": expand,
    "the zoom bar": frame.querySelector(".leaflet-control-zoom"),
    "the attribution": frame.querySelector(".leaflet-control-attribution"),
  };
  const problems = Object.entries(controls)
    .filter(([, element]) => !element || !(element.getBoundingClientRect().width > 0))
    .map(([name]) => `${name} is not on the map`);
  const discs = [...frame.querySelectorAll(".route-map-marker")].map((marker) => {
    const rect = box(marker);
    const inset = parseFloat(getComputedStyle(marker, "::before").top) || 0;
    const disc = { left: rect.left + inset, top: rect.top + inset, right: rect.right - inset, bottom: rect.bottom - inset };
    const name = `marker ${marker.textContent.trim()} (${round({
      left: disc.left - map.left,
      top: disc.top - map.top,
      right: disc.right - map.left,
      bottom: disc.bottom - map.top,
    })})`;
    if (disc.left < map.left || disc.top < map.top || disc.right > map.right || disc.bottom > map.bottom) {
      problems.push(`${name} is cut off by the map edge`);
    }
    for (const [control, element] of Object.entries(controls)) {
      if (!element) continue;
      const covered = box(element);
      const overlapX = Math.min(disc.right, covered.right) - Math.max(disc.left, covered.left);
      const overlapY = Math.min(disc.bottom, covered.bottom) - Math.max(disc.top, covered.top);
      if (overlapX > 0 && overlapY > 0) {
        const share = Math.round((100 * overlapX * overlapY) / ((disc.right - disc.left) * (disc.bottom - disc.top)));
        problems.push(`${name} is ${share}% under ${control} (${round({
          left: covered.left - map.left,
          top: covered.top - map.top,
          right: covered.right - map.left,
          bottom: covered.bottom - map.top,
        })})`);
      }
    }
    return { marker, name, disc };
  });
  // A tap on each disc's centre, once all geometry above is read (scrolling
  // moves everything). elementFromPoint sees only the viewport, and the
  // expanded map reaches below the fold, so a disc outside it is scrolled into
  // view first. A centre that still cannot be hit-tested is a check that did
  // not run: it fails.
  for (const { marker, name } of discs) {
    const centre = () => {
      const rect = marker.getBoundingClientRect();
      return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
    };
    let { x, y } = centre();
    if (y < 0 || y >= innerHeight) {
      window.scrollBy(0, y - innerHeight / 2);
      ({ x, y } = centre());
    }
    const hit = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight ? document.elementFromPoint(x, y) : null;
    if (!hit) {
      problems.push(`${name}'s centre could not be hit-tested: it is outside the viewport`);
      continue;
    }
    const hitControl = Object.entries(controls).find(([, element]) => element && element.contains(hit));
    if (hitControl) problems.push(`a tap on ${name}'s centre hits ${hitControl[0]}`);
  }
  const xs = discs.map(({ disc }) => (disc.left + disc.right) / 2);
  const ys = discs.map(({ disc }) => (disc.top + disc.bottom) / 2);
  return {
    markers: discs.length,
    height: Math.round(map.bottom - map.top),
    // How large the day is drawn: the diagonal of the markers' extent.
    spread: Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)),
    problems,
  };
}

const EXPAND_NAMES = ["Förstora kartan", "Förminska kartan"];

for (const width of WIDTHS) {
  test(`route markers stay clear of the map controls at ${width}px, collapsed and expanded`, { timeout: 180_000 }, async (t) => {
    const current = await openRuntime(t);
    if (!current) return;
    const problems = [];
    for (const [dayName, stops] of Object.entries(DAYS)) {
      const { context, page, route, pageErrors } = await openDay(current, { width, stops });
      try {
        const states = {};
        for (const state of ["collapsed", "expanded", "collapsed again"]) {
          if (state !== "collapsed") {
            await route.getByRole("button", { name: state === "expanded" ? "Förstora kartan" : "Förminska kartan" }).click();
            await page.waitForTimeout(SETTLE_MS);
          }
          const measured = await page.evaluate(measureMap, EXPAND_NAMES);
          states[state] = measured;
          const where = `${dayName} at ${width}px, ${state}`;
          if (measured.markers !== stops.length) problems.push(`${where}: ${measured.markers} of ${stops.length} markers drawn`);
          problems.push(...measured.problems.map((problem) => `${where}: ${problem}`));
        }
        const { collapsed, expanded } = states;
        const collapsedAgain = states["collapsed again"];
        if (!(expanded.height > collapsed.height)) {
          problems.push(`${dayName} at ${width}px: the map did not grow (${collapsed.height}px → ${expanded.height}px)`);
        }
        if (expanded.spread < collapsed.spread - 1) {
          problems.push(
            `${dayName} at ${width}px: expanding drew the day smaller (${Math.round(collapsed.spread)}px → ${Math.round(expanded.spread)}px)`,
          );
        }
        if (Math.abs(collapsedAgain.spread - collapsed.spread) > 1) {
          problems.push(
            `${dayName} at ${width}px: collapsing again did not return to the collapsed fit ` +
              `(${Math.round(collapsed.spread)}px → ${Math.round(collapsedAgain.spread)}px)`,
          );
        }
        if (pageErrors.length) problems.push(`${dayName} at ${width}px: the Planner threw: ${pageErrors.join("; ")}`);
      } finally {
        await context.close();
      }
    }
    assert.deepEqual(problems, [], `route markers under the map's controls:\n${problems.join("\n")}`);
  });
}

test("the expanded map shows a phone's day closer than the collapsed one", { timeout: 120_000 }, async (t) => {
  const current = await openRuntime(t);
  if (!current) return;
  const { context, page, route } = await openDay(current, { width: 320, stops: DAYS["diagonal, Live stop north-east"] });
  try {
    const collapsed = await page.evaluate(measureMap, EXPAND_NAMES);
    await route.getByRole("button", { name: "Förstora kartan" }).click();
    await page.waitForTimeout(SETTLE_MS);
    const expanded = await page.evaluate(measureMap, EXPAND_NAMES);
    // A 192px strip holds this day a zoom level further out than the 384px map.
    assert.ok(
      expanded.spread > collapsed.spread * 1.5,
      `expected the day drawn larger once expanded: ${Math.round(collapsed.spread)}px → ${Math.round(expanded.spread)}px`,
    );
  } finally {
    await context.close();
  }
});
