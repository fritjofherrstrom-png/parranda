"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { main, parseArguments } = require("../scripts/review-source-profile");

function capture() {
  let value = "";
  return {
    stream: { write(chunk) { value += chunk; } },
    value() { return value; },
  };
}

test("review CLI requires an explicit operator for approval and supports bounded inspection", () => {
  assert.deepEqual(parseArguments(["--approve", "decision.json", "--operator", "ops@example"]), {
    approvePath: "decision.json",
    inspectProfileKey: null,
    operatorId: "ops@example",
    errors: [],
  });
  assert.deepEqual(parseArguments(["--inspect", "place-source-profile-v1:test"]), {
    approvePath: null,
    inspectProfileKey: "place-source-profile-v1:test",
    operatorId: null,
    errors: [],
  });
  assert.deepEqual(parseArguments(["--approve", "decision.json"]).errors, ["missing_operator"]);
});

test("review CLI delegates a revision-bound decision and explicit operator audit label", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-profile-review-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, "reviewed.json");
  const decision = {
    schema_version: 1,
    profile_key: "place-source-profile-v1:test",
    expected_profile_revision: "sha256:profile",
    expires_at: "2026-09-01T00:00:00.000Z",
    place_sources: [{ candidate_id: "candidate-one", terms_status: "open_license" }],
  };
  fs.writeFileSync(inputPath, JSON.stringify(decision));
  const output = capture();
  let received = null;

  const code = await main(["--approve", inputPath, "--operator", "ops@example"], {
    output: output.stream,
    errorOutput: capture().stream,
    catalog: {
      async approveProfile(value, options) {
        received = { value, options };
        return {
          status: "recorded",
          profile_key: value.profile_key,
          catalog_status: "approved",
          profile_revision: value.expected_profile_revision,
        };
      },
    },
  });

  assert.equal(code, 0);
  assert.deepEqual(received, { value: decision, options: { operatorId: "ops@example" } });
  assert.equal(JSON.parse(output.value()).catalog_status, "approved");
});

test("review CLI inspection returns only the server-derived review bundle", async () => {
  const output = capture();
  const code = await main(["--inspect", "place-source-profile-v1:test"], {
    output: output.stream,
    errorOutput: capture().stream,
    catalog: {
      inspectProfileForReview: async (profileKey) => ({
        status: "reviewable",
        profile_key: profileKey,
        profile_revision: "sha256:profile",
        catalog_status: "review_needed",
        place_source_candidates: [],
      }),
    },
  });
  assert.equal(code, 0);
  assert.equal(JSON.parse(output.value()).profile_revision, "sha256:profile");
});

test("review CLI fails visibly when approval validation or catalog config fails", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-profile-review-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, "reviewed.json");
  fs.writeFileSync(inputPath, JSON.stringify({ profile_key: "invalid" }));

  const unavailableOutput = capture();
  assert.equal(await main(["--approve", inputPath, "--operator", "ops@example"], {
    output: unavailableOutput.stream,
    errorOutput: capture().stream,
    env: {},
  }), 1);
  assert.equal(JSON.parse(unavailableOutput.value()).reason, "source_catalog_unavailable");

  const rejectedOutput = capture();
  assert.equal(await main(["--approve", inputPath, "--operator", "ops@example"], {
    output: rejectedOutput.stream,
    errorOutput: capture().stream,
    catalog: {
      approveProfile: async () => ({
        status: "rejected",
        reason: "profile_revision_mismatch",
      }),
    },
  }), 1);
  assert.equal(JSON.parse(rejectedOutput.value()).reason, "profile_revision_mismatch");
});
