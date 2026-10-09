"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildApp } = require("../server/app");
const { readPlannerEntry } = require("../planner-entry");
const app = buildApp({ openDataLoader: null, placeResolver: null, placeSuggestions: null, eventSupply: null, sourceCatalog: null, reviewedPlaceSource: null, placeSelectionStore: {} });
// Exercise the actual Express route handlers without a listener or live providers.
function shell(url) {
  const route = app.router.stack.find(layer => layer.route?.path === url.split("?")[0]);
  assert.ok(route, url);
  const observed = { status: 200 };
  const response = {
    redirect(status, location) { Object.assign(observed, { status, location }); },
    status(status) { observed.status = status; return this; },
    type() { return this; },
    send(body) { observed.body = String(body); return this; },
  };
  route.route.stack[0].handle({ originalUrl: url, query: Object.fromEntries(new URLSearchParams(url.split("?")[1])) }, response);
  return observed;
}
test("present valid or invalid place_ref reaches the real Planner shell and legacy handoff unchanged", () => {
  for (const query of ["place_ref=r41485", "place_ref=R41485", "place_ref=", "place_ref=r41485%0A", "place_ref=&place_ref=r41485", "place_ref=r41485&place_ref=", "place_ref=r41485&lat=999&lng=13"]) {
    assert.equal(readPlannerEntry(query).hasIntent, true, query);
    const current = shell(`/anywhere?${query}&lang=sv`);
    assert.equal(current.status, 200, query);
    assert.match(current.body, /<astro-island/);
    assert.doesNotMatch(current.body, /Plan a day|Planera en dag|e.g. Lyon or Kyoto/);
    assert.equal(current.location, undefined);
    const legacy = shell(`/labs/anywhere?${query}&lang=sv`);
    assert.equal(legacy.status, 302);
    assert.equal(legacy.location, `/anywhere?${query}&lang=sv`);
  }
});
test("no-ref shell routing keeps no-intent, GPS, restore and coordinate first-value semantics", () => {
  for (const query of ["", "planner=open", "lat=999&lng=13", "lat=&lat=55&lng=13", "place=&place=Rome", "restore=no"]) {
    for (const route of ["/anywhere", "/labs/anywhere"]) {
      assert.deepEqual(shell(`${route}?${query}`), { status: 302, location: "/?lang=en" }, query);
    }
  }
  for (const query of ["place=Rome&place=", "lat=0&lng=0", "anchor=near", "restore=last"]) {
    assert.equal(shell(`/anywhere?${query}`).status, 200, query);
    assert.equal(shell(`/labs/anywhere?${query}`).location, `/anywhere?${query}`);
  }
});
