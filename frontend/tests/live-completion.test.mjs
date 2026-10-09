// The Live completion client contract, without React: the bearer token never
// survives the response, completion reads are bounded by the capability's own
// lifetime, and the route upgrade is requested once and only when authorized.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_COMPLETION_ENDPOINT,
  LIVE_ROUTE_UPGRADE_ENDPOINT,
  followLiveCompletion,
  readLiveCompletionResponse,
  readLiveRouteUpgradeResponse,
  takeLiveCompletion,
} from "../src/lib/live-completion.mjs";

const capabilityBody = (extra = {}) => ({
  days: [],
  live_events: { coverage: "covered", pending: true },
  live_completion: { version: 1, token: "opaque-token-1", expires_in_ms: 120000, ...extra },
});

test("the capability is taken out of the response, valid or not", () => {
  const { body, capability } = takeLiveCompletion(capabilityBody({ route_upgrade: "explicit_request" }));
  assert.equal("live_completion" in body, false);
  assert.deepEqual(capability, { token: "opaque-token-1", expiresInMs: 120000, routeUpgrade: "explicit_request" });

  for (const bad of [{ version: 2 }, { token: "" }, { token: "has space" }, { token: "x".repeat(513) }, { expires_in_ms: 0 }, { expires_in_ms: "120000" }]) {
    const taken = takeLiveCompletion(capabilityBody(bad));
    assert.equal(taken.capability, null, JSON.stringify(bad));
    assert.equal("live_completion" in taken.body, false, "an invalid capability is still stripped");
  }
  assert.equal(takeLiveCompletion(capabilityBody({ expires_in_ms: 999999 })).capability.expiresInMs, 120000);
  assert.equal(takeLiveCompletion(capabilityBody()).capability.routeUpgrade, "not_supported");

  const plain = { days: [] };
  assert.equal(takeLiveCompletion(plain).body, plain, "a response without a capability is untouched");
});

test("completion reads: pending, terminal, expired, and anything else is unavailable", () => {
  assert.deepEqual(readLiveCompletionResponse(202, {}), { kind: "pending" });
  assert.deepEqual(readLiveCompletionResponse(410, {}), { kind: "expired" });
  const live = { coverage: "covered", tonight: [] };
  assert.deepEqual(readLiveCompletionResponse(200, { live_events: live, route_upgrade: "explicit_request" }), {
    kind: "terminal",
    liveEvents: live,
    routeUpgrade: "explicit_request",
  });
  assert.equal(readLiveCompletionResponse(200, { live_events: { pending: true } }).kind, "unavailable");
  assert.equal(readLiveCompletionResponse(200, {}).kind, "unavailable");
  assert.equal(readLiveCompletionResponse(503, { error: "live_completion_unavailable" }).kind, "unavailable");
});

test("upgrade answers: only an applied v1 result carries a day, and never a token", () => {
  const result = { days: [{ primary_route: {} }], live_completion: { version: 1, token: "t", expires_in_ms: 1 } };
  const applied = readLiveRouteUpgradeResponse(200, { live_route_upgrade: { version: 1, state: "applied", result } });
  assert.equal(applied.kind, "applied");
  assert.equal("live_completion" in applied.result, false);
  assert.equal(readLiveRouteUpgradeResponse(200, { live_route_upgrade: { version: 1, state: "not_eligible" } }).kind, "not_eligible");
  assert.equal(readLiveRouteUpgradeResponse(200, { live_route_upgrade: { version: 1, state: "rejected" } }).kind, "rejected");
  assert.equal(readLiveRouteUpgradeResponse(200, { live_route_upgrade: { version: 1, state: "applied" } }).kind, "failed");
  assert.equal(readLiveRouteUpgradeResponse(503, { live_route_upgrade: { version: 1, state: "failed" } }).kind, "failed");
  assert.equal(readLiveRouteUpgradeResponse(409, {}).kind, "not_authorized");
  assert.equal(readLiveRouteUpgradeResponse(410, {}).kind, "expired");
  assert.equal(readLiveRouteUpgradeResponse(202, {}).kind, "pending");
});

function harness(answers) {
  let clock = 0;
  const calls = [];
  const waits = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), at: clock });
    const next = answers.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    if (next instanceof Error) throw next;
    assert.equal(url, next.url, "requests arrive in contract order");
    return { status: next.status, json: async () => next.body };
  };
  const wait = async (ms) => {
    waits.push(ms);
    clock += ms;
  };
  return { calls, waits, fetcher, wait, now: () => clock };
}

const capability = (routeUpgrade = "explicit_request", expiresInMs = 120000) => ({ token: "opaque-token-1", expiresInMs, routeUpgrade });

test("follows pending reads to a terminal result, then asks for the upgrade exactly once", async () => {
  const live = { coverage: "covered", tonight: [{ id: "e1" }] };
  const result = { days: [{ primary_route: { main_stops: [] } }] };
  const h = harness([
    { url: LIVE_COMPLETION_ENDPOINT, status: 202, body: {} },
    { url: LIVE_COMPLETION_ENDPOINT, status: 200, body: { live_events: live, route_upgrade: "explicit_request" } },
    { url: LIVE_ROUTE_UPGRADE_ENDPOINT, status: 202, body: {} },
    { url: LIVE_ROUTE_UPGRADE_ENDPOINT, status: 200, body: { live_route_upgrade: { version: 1, state: "applied", result } } },
  ]);
  const seen = [];
  const outcome = await followLiveCompletion({
    capability: capability(),
    signal: new AbortController().signal,
    onLiveEvents: (events) => seen.push(events),
    ...h,
  });
  assert.deepEqual(seen, [live], "the Live result is handed over before the upgrade is asked for");
  assert.equal(outcome.live, "terminal");
  assert.equal(outcome.upgrade.kind, "applied");
  assert.deepEqual(outcome.upgrade.result, result);
  for (const call of h.calls) assert.deepEqual(call.body, { token: "opaque-token-1" }, "exactly {token}, nothing else");
  assert.deepEqual(h.waits, [2000, 3000, 2000], "upgrade re-reads restart the cadence");
});

test("an unauthorized capability reads Live and never touches the upgrade endpoint", async () => {
  const h = harness([{ url: LIVE_COMPLETION_ENDPOINT, status: 200, body: { live_events: { coverage: "covered" }, route_upgrade: "not_supported" } }]);
  const outcome = await followLiveCompletion({ capability: capability("not_supported"), signal: new AbortController().signal, ...h });
  assert.deepEqual(outcome, { live: "terminal", upgrade: null });
  assert.equal(h.calls.length, 1);
});

test("the server's own route_upgrade answer decides, not the original flag", async () => {
  const h = harness([{ url: LIVE_COMPLETION_ENDPOINT, status: 200, body: { live_events: { coverage: "covered" }, route_upgrade: "not_supported" } }]);
  const outcome = await followLiveCompletion({ capability: capability("explicit_request"), signal: new AbortController().signal, ...h });
  assert.deepEqual(outcome, { live: "terminal", upgrade: null });
});

test("reads stop at the capability's lifetime instead of polling forever", async () => {
  const pending = Array.from({ length: 30 }, () => ({ url: LIVE_COMPLETION_ENDPOINT, status: 202, body: {} }));
  const h = harness(pending);
  const outcome = await followLiveCompletion({ capability: capability("explicit_request", 30000), signal: new AbortController().signal, ...h });
  assert.equal(outcome.live, "expired");
  assert.ok(h.now() < 30000, `no read is scheduled past the deadline (stopped at ${h.now()} ms)`);
  assert.deepEqual(h.waits, [2000, 3000, 5000, 8000, 10000]);
});

test("410 and an unreadable answer end the run as expired and unavailable", async () => {
  const expired = harness([{ url: LIVE_COMPLETION_ENDPOINT, status: 410, body: { error: "live_completion_expired" } }]);
  assert.deepEqual(await followLiveCompletion({ capability: capability(), signal: new AbortController().signal, ...expired }), { live: "expired", upgrade: null });
  const broken = harness([{ url: LIVE_COMPLETION_ENDPOINT, status: 503, body: {} }]);
  assert.deepEqual(await followLiveCompletion({ capability: capability(), signal: new AbortController().signal, ...broken }), { live: "unavailable", upgrade: null });
});

test("a dropped read is retried within the same lifetime", async () => {
  const h = harness([
    new Error("network"),
    { url: LIVE_COMPLETION_ENDPOINT, status: 200, body: { live_events: { coverage: "covered" } } },
  ]);
  const outcome = await followLiveCompletion({ capability: capability("not_supported"), signal: new AbortController().signal, ...h });
  assert.equal(outcome.live, "terminal");
  assert.equal(h.calls.length, 2);
});

test("cancellation stops the run without reporting Live", async () => {
  const controller = new AbortController();
  const seen = [];
  const outcome = await followLiveCompletion({
    capability: capability(),
    signal: controller.signal,
    onLiveEvents: (events) => seen.push(events),
    fetcher: async () => {
      controller.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    },
    wait: async () => {},
    now: () => 0,
  });
  assert.deepEqual(outcome, { live: "cancelled", upgrade: null });
  assert.deepEqual(seen, []);
});
