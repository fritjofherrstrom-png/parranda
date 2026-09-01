"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  main,
  parseArguments,
} = require("../scripts/scout-local-event-sources");

function capture() {
  let value = "";
  return {
    stream: { write(chunk) { value += chunk; } },
    value() { return value; },
  };
}

test("CLI parses place mode without mistaking the place value for an input file", () => {
  const parsed = parseArguments([
    "--place",
    "Test Place",
    "--live",
    "--catalog",
    "--term",
    "local market",
    "--intent",
    "music",
  ]);

  assert.equal(parsed.place, "Test Place");
  assert.equal(parsed.inputPath, null);
  assert.equal(parsed.live, true);
  assert.equal(parsed.catalog, true);
  assert.deepEqual(parsed.localDiscoveryTerms, ["local market"]);
  assert.deepEqual(parsed.intentHints, ["music"]);
  assert.deepEqual(parsed.errors, []);
});

test("catalog persistence is explicit and records only the scout source profile", async () => {
  const output = capture();
  let recorded = null;
  const records = [{ name: "Venue", type: "museum", website: "https://venue.example/events" }];
  Object.defineProperty(records, "loader_status", { value: "loaded:1" });
  Object.defineProperty(records, "loader_error", { value: null });

  const code = await main(["--place", "Test Place", "--live", "--catalog"], {
    output: output.stream,
    errorOutput: capture().stream,
    runtime: {
      placeResolver: async () => [
        {
          label: "Test Place",
          lat: 50,
          lng: 10,
          confidence: "medium",
          provenance: "trusted_test_resolver",
          spatial_scope: {
            source: "test_bounds",
            kind: "settlement",
            bounds: { south: 49.8, north: 50.2, west: 9.8, east: 10.2 },
          },
        },
      ],
      openDataLoader: async () => records,
      sourceScout: async () => ({
        status: "complete",
        reasons: ["bounded_source_scout_complete"],
        inspected_source_count: 1,
        manifest_candidates: [],
      }),
      scoutCache: null,
      sourceCatalog: {
        async recordDiscovery(profile) {
          recorded = profile;
          return {
            status: "recorded",
            profile_key: profile.profile_key,
            catalog_status: "review_needed",
          };
        },
      },
    },
  });
  const result = JSON.parse(output.value());

  assert.equal(code, 0);
  assert.equal(recorded.place_context.bounds.west, 9.8);
  assert.equal(recorded.runtime_review.status, "unreviewed");
  assert.equal(result.catalog_write.catalog_status, "review_needed");
  assert.equal(result.activation_performed, false);
});

test("catalog mode fails visibly when the trusted catalog is not configured", async () => {
  const output = capture();
  const records = [];
  Object.defineProperty(records, "loader_status", { value: "loaded:0" });
  Object.defineProperty(records, "loader_error", { value: null });
  const code = await main(["--place", "Test Place", "--live", "--catalog"], {
    output: output.stream,
    errorOutput: capture().stream,
    runtime: {
      placeResolver: async () => [{ label: "Test Place", lat: 50, lng: 10, confidence: "medium" }],
      openDataLoader: async () => records,
      sourceScout: async () => ({ status: "empty" }),
      scoutCache: null,
      sourceCatalog: null,
    },
  });
  const result = JSON.parse(output.value());

  assert.equal(code, 1);
  assert.deepEqual(result.catalog_write, {
    status: "unavailable",
    reason: "source_catalog_unavailable",
  });
});

test("place mode without --live is network-free and explains the gate", async () => {
  const output = capture();
  let runtimeRead = false;
  const code = await main(["--place", "Test Place", "--term", "calendar"], {
    output: output.stream,
    errorOutput: capture().stream,
    get runtime() {
      runtimeRead = true;
      throw new Error("runtime must not be read");
    },
  });
  const result = JSON.parse(output.value());

  assert.equal(code, 0);
  assert.equal(runtimeRead, false);
  assert.equal(result.status, "plan_only");
  assert.equal(result.live_network_used, false);
  assert.deepEqual(result.reasons, ["pass_--live_to_resolve_place_and_probe_sources"]);
  assert.ok(result.discovery_queries.includes("Test Place calendar"));
});

test("live place mode uses only injected trusted seams and emits review-only candidates", async () => {
  const output = capture();
  const records = [
    {
      name: "Venue",
      type: "museum",
      website: "https://venue.example/events",
    },
  ];
  Object.defineProperty(records, "loader_status", { value: "loaded:1" });
  Object.defineProperty(records, "loader_error", { value: null });

  const code = await main(["--place", "Test Place", "--live"], {
    output: output.stream,
    errorOutput: capture().stream,
    runtime: {
      placeResolver: async () => [
        {
          label: "Test Place",
          lat: 50,
          lng: 10,
          confidence: "medium",
          provenance: "trusted_test_resolver",
        },
      ],
      openDataLoader: async () => records,
      sourceScout: async () => ({
        status: "complete",
        reasons: ["bounded_source_scout_complete"],
        inspected_source_count: 1,
        manifest_candidates: [
          {
            adapter: "ical",
            endpoint: "https://venue.example/events.ics",
            status: "active",
          },
        ],
      }),
      scoutCache: null,
    },
  });
  const result = JSON.parse(output.value());

  assert.equal(code, 0);
  assert.equal(result.live_network_used, true);
  assert.equal(result.status, "complete");
  assert.equal(result.activation_performed, false);
  assert.equal(result.manifest_candidates[0].status, "review-needed");
  assert.equal(result.manifest_candidates[0].runtime_policy, "review_required");
});

test("CLI rejects conflicting place and JSON input modes", async () => {
  const output = capture();
  const errors = capture();
  const code = await main(["input.json", "--place", "Test Place"], {
    output: output.stream,
    errorOutput: errors.stream,
  });

  assert.equal(code, 1);
  assert.equal(output.value(), "");
  assert.match(errors.value(), /Usage:/);
});

test("existing JSON plan mode remains compatible and network-free", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-scout-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, "input.json");
  fs.writeFileSync(inputPath, JSON.stringify({
    place: { label: "Test Region" },
    anchor: { lat: 50, lng: 10 },
    records: [
      {
        name: "Venue",
        type: "museum",
        website: "https://venue.example/events",
      },
    ],
  }));
  const output = capture();
  const code = await main([inputPath], {
    output: output.stream,
    errorOutput: capture().stream,
  });
  const result = JSON.parse(output.value());

  assert.equal(code, 0);
  assert.equal(result.status, "plan_only");
  assert.equal(result.live_network_used, false);
  assert.ok(result.discovery_queries.includes("Test Region official tourism attractions"));
  assert.equal(result.trusted_website_seeds.length, 1);
  assert.equal(result.trusted_website_seeds[0].url, "https://venue.example/events");
});
