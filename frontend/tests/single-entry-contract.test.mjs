import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import entry from "../../planner-entry.js";
import { mountPlanner } from "./helpers/planner-harness.mjs";
const source = (name) => readFileSync(new URL(`../src/components/${name}`, import.meta.url), "utf8");
test("server/client URL intent agrees on first values and rejects malformed entry", () => {
  for (const query of ["", "planner=open", "lang=sv", "place=+", "place=%00", "place=%EF%BF%BD", "place[x]=Lyon", "lat=&lng=0", "lat=Infinity&lng=0", "lat=0x10&lng=0", "lat=91&lng=0", "restore=true", "place=&place=Lyon"]) {
    assert.equal(entry.readPlannerEntry(query).hasIntent, false, query);
  }
  for (const query of ["place=Lyon", "place=Lyon&place=", "anchor=near", "restore=last", "lat=0&lng=0"]) {
    assert.equal(entry.readPlannerEntry(query).hasIntent, true, query);
  }
  assert.deepEqual(entry.readPlannerEntry("lat=0&lng=0&place=Lyon").coords, { lat: 0, lng: 0 });
});
test("no second planner hero or place-entry form, including hydration fallback", () => {
  const planner = source("AnywherePlanner.tsx");
  assert.doesNotMatch(planner, /Plan a day|Planera en dag|var som helst|e\.g\. Lyon or Kyoto|<form/);
  assert.match(planner, /Preparing your day/);
  assert.match(planner, /href=\{`\/\?lang=\$\{lang\}`\}/);
  assert.match(planner, /plannerEntry\.readPlannerEntry\(window.location.search\)/);
  assert.match(planner, /execute\(\{ coords: entry.coords \}/);
  assert.match(planner, /if \(entry.place \|\| shared.placeRef\)/);
});
test("saved resume and snapshot language carry explicit intent; home/change go root", () => {
  assert.match(source("LandingHero.tsx"), /\/anywhere\?restore=last&lang=/);
  assert.match(source("AnywherePlanner.tsx"), /\?restore=last&lang=\$\{option\}/);
  for (const file of ["shared/AppBar.tsx", "planner/AnchorCard.tsx"]) {
    assert.match(source(file), /href=\{`\/\?lang=\$\{lang\}`\}/);
  }
});
test("coordinate deep link composes once around exact zero coordinates, not accompanying place text", async (t) => {
  const h = await mountPlanner({ url: "http://localhost/anywhere?lat=0&lng=0&place=Lyon&prefs=food&day=1&rhythm=full&lang=sv" });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const calls = h.fetchMock.calls.filter(call => call.url.startsWith("/api/route-recommendations"));
  assert.equal(calls.length, 1);
  const payload = calls[0].body;
  assert.equal(payload.lat, 0);
  assert.equal(payload.lng, 0);
  assert.equal(payload.place, undefined);
  assert.equal(h.container.querySelector("form"), null);
});
test("missing explicitly requested snapshot stays honest and links home without fetching", async (t) => {
  const h = await mountPlanner({ url: "http://localhost/anywhere?restore=last&lang=sv" });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  assert.match(h.text(), /Förbereder din dag/);
  assert.equal(h.container.querySelector("form"), null);
  assert.ok(h.container.querySelector('a[href="/?lang=sv"]'));
  assert.equal(h.fetchMock.calls.length, 0);
});
