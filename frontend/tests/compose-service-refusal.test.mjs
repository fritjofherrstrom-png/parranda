import test from "node:test";
import assert from "node:assert/strict";
import { composeServiceRefusal } from "../src/lib/compose-service-refusal.mjs";

test("public guard refusals retain their honest retry contract", () => {
  assert.deepEqual(composeServiceRefusal(429, { error: "busy", retry_after_seconds: 5 }), {
    kind: "busy",
    retry_after_seconds: 5,
  });
  assert.deepEqual(composeServiceRefusal(429, { error: "rate_limited", retry_after_seconds: 12.2 }), {
    kind: "rate_limited",
    retry_after_seconds: 13,
  });
});

test("unknown and non-429 failures stay on the generic transport path", () => {
  assert.equal(composeServiceRefusal(500, { error: "busy" }), null);
  assert.equal(composeServiceRefusal(429, { error: "provider_failed" }), null);
  assert.equal(composeServiceRefusal(200, null), null);
});
