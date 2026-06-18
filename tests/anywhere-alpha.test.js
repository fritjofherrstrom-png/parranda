const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const { buildApp } = require("../server/app");

async function requestText(server, { method = "GET", path = "/" } = {}) {
  const { port } = server.address();

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            body: data,
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

test("landing unknown place handoff routes to any-place alpha while registered cities stay on city shells", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "landing.js"), "utf8");

  assert.match(source, /function buildAnyPlaceAlphaUrl/);
  assert.match(source, /params\.set\("place", place\)/);
  assert.match(source, /params\.set\("planner", "open"\)/);
  assert.match(source, /params\.set\("lang", currentLang\(\)\)/);
  assert.match(source, /return "\/labs\/anywhere\?" \+ params\.toString\(\)/);
  assert.match(source, /window\.location\.href = cityPath \+ "\?" \+ params\.toString\(\)/);
  assert.match(source, /window\.location\.href = anyPlaceUrl/);
  const plannerSubmitBlock = source.slice(
    source.indexOf("if (plannerForm)"),
    source.indexOf("document.querySelectorAll"),
  );
  assert.doesNotMatch(plannerSubmitBlock, /COPY\.unsupported/);
  assert.doesNotMatch(source, /cityPath \+ "\/plan"/);
});

test("landing bootstraps plain JS copy so unsupported validation cannot show HTML entities", async () => {
  const server = buildApp().listen(0);

  try {
    const response = await requestText(server, { path: "/?lang=en" });
    assert.equal(response.status, 200);
    assert.match(response.body, /window\.__PARRANDA_LANDING_COPY__ = \{/);
    assert.match(response.body, /"unsupported":"We're live in Barcelona and Rome\. Try one of those\."/);
    assert.doesNotMatch(response.body, /We&#39;re/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("/labs/anywhere renders an app-style alpha surface, not raw dogfood UI", async () => {
  const server = buildApp().listen(0);

  try {
    const response = await requestText(server, { path: "/labs/anywhere?place=Malm%C3%B6&planner=open&lang=en" });
    assert.equal(response.status, 200);
    assert.match(response.body, /Any-place alpha/);
    assert.match(response.body, /source-backed data/);
    assert.match(response.body, /window\.__PARRANDA_ANYWHERE_PLACE__ = "Malmö";/);
    assert.match(response.body, /src="\/labs-anywhere\.js\?v=1"/);
    assert.match(response.body, /src="\/dogfood-render\.js\?v=26"/);
    assert.doesNotMatch(response.body, /dogfood-shell/);
    assert.doesNotMatch(response.body, /raw JSON/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("any-place alpha client uses the existing agnostic route endpoint and flags only", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "labs-anywhere.js"), "utf8");

  assert.match(source, /city: "anywhere-alpha"/);
  assert.match(source, /include_external_candidates: 1/);
  assert.match(source, /experimental_agnostic_route_output=1&include_external_candidates=1/);
  assert.match(source, /\/api\/route-recommendations\?lang=/);
  assert.doesNotMatch(source, /\/api\/blitz/);
  assert.doesNotMatch(source, /candidate_mode/);
  assert.doesNotMatch(source, /selected_variant/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});
