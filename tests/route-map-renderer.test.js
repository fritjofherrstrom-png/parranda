"use strict";

/**
 * The map renderer (MapLibre over OpenFreeMap vector tiles) in the real
 * Planner, in Chromium, for the three things a raster map never had to do:
 *
 *   - follow the theme: switching day/night recolours the drawn map in place —
 *     the background turns to the new paper, every marker stays, the view does
 *     not jump and the day is not composed again;
 *   - survive the tile provider being down: every non-page host is refused
 *     here, so the basemap never loads; the route and all its numbered stops
 *     still draw over plain paper, and one status line says the background is
 *     missing;
 *   - survive a browser that cannot draw it (no WebGL2): the map is replaced
 *     by one line, the day's stops and its Maps route stay usable, nothing
 *     throws and nothing retries.
 *
 * /api/route-recommendations is answered from a fixture. Not evidence of a
 * real phone, iOS Safari or a real GPU.
 */

const assert = require("node:assert/strict");
const { once } = require("node:events");
const test = require("node:test");

const { buildApp } = require("../server/app");

const FIXTURE_DATE = "2026-09-27";
const FIXED_NOW = new Date(`${FIXTURE_DATE}T10:00:00Z`);
const STOPS = [
  { id: "a", label: "Stop a", lat: 55.595, lng: 12.99, type: "museum" },
  { id: "b", label: "Stop b", lat: 55.598, lng: 12.998, type: "park" },
  { id: "c", label: "Stop c", lat: 55.601, lng: 13.004, type: "cafe" },
  { id: "d", label: "Stop d", lat: 55.603, lng: 13.01, type: "restaurant" },
];
const PAPER = { day: [238, 236, 231], night: [17, 16, 18] };

function composedDay() {
  return {
    days: [{
      date: FIXTURE_DATE,
      experimental_agnostic_route_applied: true,
      primary_route: {
        id: "__agnostic_compose__",
        main_stops: STOPS,
        estimated_km: 2.4,
        legs: [],
        map_route_points: [],
        map_path_points: STOPS.map(({ lat, lng }) => ({ lat, lng })),
        confidence: "low",
      },
      alternatives: [],
    }],
    place_structure: {
      provenance: "agnostic_anchor",
      area_count: 1,
      district_day: { areas: [{ center: { lat: 55.6, lng: 13 }, stops: [] }], legs: [], covered_intents: [], missing_intents: [] },
    },
    live_events: { coverage: "covered", tonight: [], this_week: [] },
    agnostic_route_output_experiment: { promotion: { promote: true, readiness: "promotable" } },
  };
}

let runtime;
function startRuntime() {
  runtime ??= (async () => {
    let chromium;
    try {
      ({ chromium } = require("playwright-core"));
    } catch (error) {
      return { unavailable: `playwright-core is not installed (${error.code || error.message})` };
    }
    let browser = null;
    const errors = [];
    for (const options of [process.env.PARRANDA_TEST_CHROMIUM && { executablePath: process.env.PARRANDA_TEST_CHROMIUM }, {}, { channel: "chrome" }].filter(Boolean)) {
      try { browser = await chromium.launch(options); break; } catch (error) { errors.push(error.message.split("\n")[0]); }
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
  assert.ok(!process.env.CI, `the map renderer check needs Chromium in CI: ${current.unavailable}`);
  t.skip(current.unavailable);
  return null;
}

async function openDay({ browser, origin }, { theme = "day", noWebGL2 = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  let composes = 0;
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/route-recommendations") { composes += 1; return route.fulfill({ json: composedDay() }); }
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "not part of this check" } });
    return route.continue();
  });
  await context.addInitScript(({ theme, noWebGL2 }) => {
    try { localStorage.setItem("parranda:theme", theme); } catch {}
    if (noWebGL2) {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
        return kind === "webgl2" ? null : original.call(this, kind, ...rest);
      };
    }
  }, { theme, noWebGL2 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto(`${origin}/anywhere?place=Testville&lang=sv`);
  const route = page.getByRole("region", { name: "Rutten" });
  return { context, page, route, pageErrors, composes: () => composes };
}

// The rendered colour of the map's own canvas at a point with no stop, line or
// control: the basemap's background layer (no tiles load here).
async function backgroundAt(page) {
  const canvas = page.locator('section[aria-label="Rutten"] canvas.maplibregl-canvas');
  const box = await canvas.boundingBox();
  const shot = await page.screenshot({ clip: { x: box.x + box.width - 60, y: box.y + box.height / 2, width: 4, height: 4 } });
  // A 4×4 PNG of one flat colour: decode its first pixel with the browser.
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 4; canvas.height = 4;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return [...context.getImageData(1, 1, 1, 1).data.slice(0, 3)];
  }, shot.toString("base64"));
}

const near = (actual, expected) => actual.every((value, i) => Math.abs(value - expected[i]) <= 3);

test("a theme switch recolours the drawn map without redrawing the day", { timeout: 120_000 }, async (t) => {
  const current = await openRuntime(t);
  if (!current) return;
  const { context, page, route, pageErrors, composes } = await openDay(current, { theme: "day" });
  try {
    await route.locator(".route-map-marker").nth(STOPS.length - 1).waitFor();
    await route.getByText("Ritar kartan …").waitFor({ state: "detached" });
    await page.waitForTimeout(400);
    const dayPaper = await backgroundAt(page);
    assert.ok(near(dayPaper, PAPER.day), `day background ${dayPaper}`);
    const before = await route.locator(".route-map-marker").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [e.textContent, Math.round(r.left), Math.round(r.top)]; }));
    const composed = composes();

    await page.getByRole("button", { name: "Kvällsläge" }).click();
    await page.waitForTimeout(400);
    const nightPaper = await backgroundAt(page);
    assert.ok(near(nightPaper, PAPER.night), `night background ${nightPaper}`);
    const after = await route.locator(".route-map-marker").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [e.textContent, Math.round(r.left), Math.round(r.top)]; }));
    assert.deepEqual(after, before, "every marker stays where it was");
    assert.equal(composes(), composed, "the day is not composed again");
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test("with the tile provider down the route still draws over paper, and says so", { timeout: 120_000 }, async (t) => {
  const current = await openRuntime(t);
  if (!current) return;
  const { context, page, route, pageErrors } = await openDay(current);
  try {
    await route.locator(".route-map-marker").nth(STOPS.length - 1).waitFor();
    assert.deepEqual(await route.locator(".route-map-marker").allTextContents(), ["1", "2", "3", "4"]);
    await route.getByRole("status").filter({ hasText: "Kartbakgrunden kunde inte hämtas" }).waitFor();
    // The attribution stays visible even without tiles.
    assert.match(await route.locator(".maplibregl-ctrl-attrib").innerText(), /OpenStreetMap/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});

test("without WebGL2 the map is one line and the day stays whole", { timeout: 120_000 }, async (t) => {
  const current = await openRuntime(t);
  if (!current) return;
  const { context, page, route, pageErrors, composes } = await openDay(current, { noWebGL2: true });
  try {
    await route.getByRole("status").filter({ hasText: "Kartan kan inte visas i den här webbläsaren" }).waitFor();
    assert.equal(await route.locator(".maplibregl-map, .route-map-marker").count(), 0, "no half-drawn map");
    assert.equal(await route.getByText("Ritar kartan …").count(), 0, "no endless loader");
    for (const stop of STOPS) assert.equal(await route.getByRole("button", { name: new RegExp(stop.label) }).count(), 1, `${stop.label} is listed`);
    assert.ok(await page.getByRole("link", { name: /Öppna rutten i Maps/ }).count(), "the Maps route is offered");
    const composed = composes();
    await page.waitForTimeout(1500);
    assert.equal(composes(), composed, "nothing retries");
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
});
