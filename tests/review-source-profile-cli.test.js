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

test("review CLI accepts one explicit profile path", () => {
  assert.deepEqual(parseArguments(["--approve", "profile.json"]), {
    approvePath: "profile.json",
    errors: [],
  });
  assert.deepEqual(parseArguments(["profile.json"]), {
    approvePath: null,
    errors: ["unknown_argument"],
  });
});

test("review CLI delegates the complete reviewed profile to the trusted catalog", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-profile-review-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, "reviewed.json");
  const profile = {
    profile_key: "place-source-profile-v1:test",
    runtime_review: { status: "approved" },
  };
  fs.writeFileSync(inputPath, JSON.stringify({ source_profile: profile }));
  const output = capture();
  let received = null;

  const code = await main(["--approve", inputPath], {
    output: output.stream,
    errorOutput: capture().stream,
    catalog: {
      async recordApprovedProfile(value) {
        received = value;
        return {
          status: "recorded",
          profile_key: value.profile_key,
          catalog_status: "approved",
        };
      },
    },
  });

  assert.equal(code, 0);
  assert.deepEqual(received, profile);
  assert.equal(JSON.parse(output.value()).catalog_status, "approved");
});

test("review CLI fails visibly when approval validation or catalog config fails", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-profile-review-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, "reviewed.json");
  fs.writeFileSync(inputPath, JSON.stringify({ profile_key: "invalid" }));

  const unavailableOutput = capture();
  assert.equal(await main(["--approve", inputPath], {
    output: unavailableOutput.stream,
    errorOutput: capture().stream,
    env: {},
  }), 1);
  assert.equal(JSON.parse(unavailableOutput.value()).reason, "source_catalog_unavailable");

  const rejectedOutput = capture();
  assert.equal(await main(["--approve", inputPath], {
    output: rejectedOutput.stream,
    errorOutput: capture().stream,
    catalog: {
      recordApprovedProfile: async () => ({
        status: "rejected",
        reason: "invalid_reviewed_source_profile",
      }),
    },
  }), 1);
  assert.equal(JSON.parse(rejectedOutput.value()).reason, "invalid_reviewed_source_profile");
});
