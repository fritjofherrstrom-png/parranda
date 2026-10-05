"use strict";
const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { buildApp } = require("../server/app");
async function withServer(run) {
  const server = buildApp({ openDataLoader: null, placeResolver: null, eventSupply: null, reviewedPlaceSource: null }).listen(0);
  const get = (path) => new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port: server.address().port, path }, res => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => resolve({ status: res.statusCode, location: res.headers.location, body }));
    }).on("error", reject);
  });
  try { await run(get); } finally { await new Promise(resolve => server.close(resolve)); }
}
test("root remains the EN/SV Next stop landing", () => withServer(async get => {
  for (const lang of ["en", "sv"]) {
    const res = await get(`/?lang=${lang}`);
    assert.equal(res.status, 200);
    assert.match(res.body, new RegExp(`<html lang="${lang}"`));
    assert.match(res.body, /Next stop/);
  }
}));
test("no-intent anywhere and legacy URLs go directly home, never a second landing", () => withServer(async get => {
  for (const route of ["/anywhere", "/anywhere/", "/labs/anywhere", "/labs/anywhere/"]) {
    for (const query of ["", "?lang=en", "?planner=open", "?place=", "?place=%20%09", "?place=%00", "?place=%EF%BF%BD", "?place[x]=Lyon", "?lat=&lng=0", "?lat=91&lng=0", "?lat=NaN&lng=2", "?restore=no", "?redirect=https://evil.test", "?prefs=food&day=1"]) {
      const res = await get(route + query);
      assert.equal(res.status, 302, route + query);
      assert.equal(res.location, "/?lang=en", route + query);
    }
    assert.equal((await get(route + "?lang=sv&place=+" )).location, "/?lang=sv");
    assert.equal((await get(route + "?lang=https://evil.test" )).location, "/?lang=en");
  }
}));
test("place, GPS handoff, coordinates and explicit snapshot links still reach planner", () => withServer(async get => {
  for (const query of ["place=Lyon", "place=Kyoto&planner=open&prefs=food,culture&day=1&rhythm=full&lang=sv", "anchor=near&planner=open&lang=sv", "lat=0&lng=0", "lat=-90&lng=180", "restore=last&lang=sv", "place=%2F%2Fevil.test", "place=Lyon&place="]) {
    const res = await get(`/anywhere?${query}`);
    assert.equal(res.status, 200, query);
    assert.doesNotMatch(res.body, /Plan a day|Planera en dag|e.g. Lyon or Kyoto/);
    const legacy = await get(`/labs/anywhere?${query}`);
    assert.equal(legacy.status, 302);
    assert.equal(legacy.location, `/anywhere?${query}`);
  }
}));
