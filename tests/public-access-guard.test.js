/**
 * The inbound half of Parranda's politeness contract. The engine already paces
 * itself toward Nominatim/Overpass; these tests pin that a public URL cannot be
 * used to bypass that pacing, and that refusals stay honest (a real 429, never
 * a silent empty result that would read as "we looked and found nothing").
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  UPSTREAM_COST_PATHS,
  clientKey,
  createFixedWindowLimiter,
  createConcurrencyGate,
  createPublicAccessGuard,
  guardSettings,
} = require("../server/lib/public-access-guard");

const requestFrom = (path, { ip = "203.0.113.7", headers = {} } = {}) => ({
  path,
  headers,
  socket: { remoteAddress: ip },
});

function responseSpy() {
  const listeners = new Map();
  const sent = { status: null, headers: {}, body: null };
  return {
    sent,
    emit(event) {
      for (const fn of listeners.get(event) || []) fn();
    },
    once(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
      return this;
    },
    status(code) {
      sent.status = code;
      return this;
    },
    set(key, value) {
      sent.headers[key] = value;
      return this;
    },
    json(body) {
      sent.body = body;
      return this;
    },
  };
}

test("a fixed window refuses past its max and reports an exact retry time", () => {
  let clock = 1_000;
  const limiter = createFixedWindowLimiter({ windowMs: 10_000, max: 3, now: () => clock });

  assert.equal(limiter.check("a").allowed, true);
  assert.equal(limiter.check("a").allowed, true);
  const third = limiter.check("a");
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);

  const refused = limiter.check("a");
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSec, 10, "Retry-After is the window's real end, not a guess");

  // A different client is unaffected — limits are per-identity, not global.
  assert.equal(limiter.check("b").allowed, true);

  // The window rolls and the same client is served again.
  clock += 10_001;
  assert.equal(limiter.check("a").allowed, true);
});

test("the client key ignores forwarded headers unless trusted hops are declared", () => {
  const spoofed = requestFrom("/api/geocode", {
    ip: "198.51.100.9",
    headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
  });

  // Default: the header is caller-controlled, so only the real peer counts —
  // otherwise one caller could mint a fresh identity per request.
  assert.equal(clientKey(spoofed, 0), "198.51.100.9");

  // With one trusted hop in front, the entry that hop appended is the client.
  assert.equal(clientKey(spoofed, 1), "5.6.7.8");

  // A caller stuffing extra entries cannot push their way past the trusted hop:
  // the count is walked from the RIGHT, so prepended junk is ignored.
  const stuffed = requestFrom("/api/geocode", {
    ip: "198.51.100.9",
    headers: { "x-forwarded-for": "9.9.9.9, 9.9.9.9, 5.6.7.8" },
  });
  assert.equal(clientKey(stuffed, 1), "5.6.7.8");

  // No header, or an empty one, falls back to the peer rather than "unknown".
  assert.equal(clientKey(requestFrom("/api/geocode", { ip: "203.0.113.1" }), 1), "203.0.113.1");
});

test("Cloudflare identity uses only its reviewed visitor header", () => {
  const request = requestFrom("/api/geocode", {
    ip: "127.0.0.1",
    headers: {
      "cf-connecting-ip": "203.0.113.44",
      "x-forwarded-for": "1.2.3.4, 5.6.7.8",
    },
  });
  assert.equal(clientKey(request, { mode: "cloudflare" }), "203.0.113.44");
  assert.equal(
    clientKey(requestFrom("/api/geocode", { ip: "127.0.0.1", headers: { "cf-connecting-ip": "not-an-ip" } }), { mode: "cloudflare" }),
    "127.0.0.1",
    "invalid headers fail back to the direct tunnel peer",
  );
});

test("the fixed-window identity table has a hard memory bound", () => {
  const limiter = createFixedWindowLimiter({ windowMs: 60_000, max: 20, maxTrackedClients: 3, now: () => 1_000 });
  for (const key of ["a", "b", "c", "d", "e"]) limiter.check(key);
  assert.equal(limiter.size(), 3, "live windows cannot grow past the configured cap");
});

test("the concurrency gate caps in-flight work and never queues", () => {
  const gate = createConcurrencyGate({ max: 2 });
  assert.equal(gate.tryAcquire(), true);
  assert.equal(gate.tryAcquire(), true);
  assert.equal(gate.tryAcquire(), false, "a full gate refuses rather than piling up upstream work");
  gate.release();
  assert.equal(gate.tryAcquire(), true);
  assert.equal(gate.active(), 2);
});

test("only upstream-touching endpoints are limited; cheap surfaces pass freely", () => {
  const guard = createPublicAccessGuard({ env: { PARRANDA_PUBLIC_GUARD: "enabled", PARRANDA_PUBLIC_GUARD_MAX: "1" } });

  let passed = 0;
  const next = () => {
    passed += 1;
  };

  // Health and static-ish surfaces are never limited, however often they are hit.
  for (let i = 0; i < 50; i += 1) {
    guard(requestFrom("/api/health"), responseSpy(), next);
  }
  assert.equal(passed, 50);

  assert.ok(UPSTREAM_COST_PATHS.has("/api/route-recommendations"));
  assert.ok(!UPSTREAM_COST_PATHS.has("/api/health"));
  assert.ok(!UPSTREAM_COST_PATHS.has("/api/places/search"), "the in-memory catalog search reaches no upstream");
});

test("an over-limit caller gets an honest 429 with Retry-After, not an empty result", () => {
  const guard = createPublicAccessGuard({
    env: { PARRANDA_PUBLIC_GUARD: "enabled", PARRANDA_PUBLIC_GUARD_MAX: "1", PARRANDA_PUBLIC_GUARD_WINDOW_MS: "60000" },
  });

  let passed = 0;
  const first = responseSpy();
  guard(requestFrom("/api/route-recommendations"), first, () => {
    passed += 1;
  });
  first.emit("finish");
  assert.equal(passed, 1);
  assert.equal(first.sent.status, null, "the allowed request is not answered by the guard");

  const second = responseSpy();
  guard(requestFrom("/api/route-recommendations"), second, () => {
    passed += 1;
  });
  assert.equal(passed, 1, "the over-limit request never reaches the engine");
  assert.equal(second.sent.status, 429);
  assert.equal(second.sent.headers["Retry-After"], "60");
  assert.equal(second.sent.body.error, "rate_limited");
  assert.ok(second.sent.body.retry_after_seconds > 0);
});

test("a full concurrency gate refuses with 'busy' and recovers when responses end", () => {
  const guard = createPublicAccessGuard({
    env: { PARRANDA_PUBLIC_GUARD: "enabled", PARRANDA_PUBLIC_GUARD_MAX: "100", PARRANDA_PUBLIC_GUARD_CONCURRENCY: "1" },
  });

  const held = responseSpy();
  let passed = 0;
  guard(requestFrom("/api/route-recommendations", { ip: "a" }), held, () => {
    passed += 1;
  });
  assert.equal(passed, 1);

  // A second caller arrives while the first is still composing.
  const refused = responseSpy();
  guard(requestFrom("/api/route-recommendations", { ip: "b" }), refused, () => {
    passed += 1;
  });
  assert.equal(passed, 1, "the engine is not entered while the gate is full");
  assert.equal(refused.sent.status, 429);
  assert.equal(refused.sent.body.error, "busy");

  // The first response ends → the slot returns.
  held.emit("finish");
  const afterRelease = responseSpy();
  guard(requestFrom("/api/route-recommendations", { ip: "c" }), afterRelease, () => {
    passed += 1;
  });
  assert.equal(passed, 2);
});

test("a busy refusal does not consume the caller's rate-limit budget", () => {
  const guard = createPublicAccessGuard({
    env: {
      PARRANDA_PUBLIC_GUARD: "enabled",
      PARRANDA_PUBLIC_GUARD_MAX: "1",
      PARRANDA_PUBLIC_GUARD_CONCURRENCY: "1",
    },
  });
  const held = responseSpy();
  guard(requestFrom("/api/route-recommendations", { ip: "a" }), held, () => {});

  const busy = responseSpy();
  guard(requestFrom("/api/route-recommendations", { ip: "b" }), busy, () => {});
  assert.equal(busy.sent.body.error, "busy");

  held.emit("finish");
  const firstAdmitted = responseSpy();
  let admitted = 0;
  guard(requestFrom("/api/route-recommendations", { ip: "b" }), firstAdmitted, () => { admitted += 1; });
  assert.equal(admitted, 1, "the busy attempt did not spend b's only allowed request");
  firstAdmitted.emit("finish");

  const rateLimited = responseSpy();
  guard(requestFrom("/api/route-recommendations", { ip: "b" }), rateLimited, () => { admitted += 1; });
  assert.equal(rateLimited.sent.body.error, "rate_limited");
});

test("a slot is released exactly once even when a response both closes and finishes", () => {
  const guard = createPublicAccessGuard({
    env: { PARRANDA_PUBLIC_GUARD: "enabled", PARRANDA_PUBLIC_GUARD_MAX: "100", PARRANDA_PUBLIC_GUARD_CONCURRENCY: "2" },
  });

  const response = responseSpy();
  guard(requestFrom("/api/blitz"), response, () => {});
  assert.equal(guard.gate.active(), 1);

  // Express emits both for an aborted request; double-releasing would inflate
  // the gate's capacity permanently.
  response.emit("close");
  response.emit("finish");
  assert.equal(guard.gate.active(), 0);

  const other = responseSpy();
  guard(requestFrom("/api/blitz"), other, () => {});
  assert.equal(guard.gate.active(), 1, "capacity is unchanged after the double signal");
});

test("the guard is share-profile explicit and normal deployments stay unchanged", () => {
  assert.equal(guardSettings({}).enabled, false);
  assert.equal(guardSettings({ PARRANDA_PUBLIC_GUARD: "disabled" }).enabled, false);
  assert.equal(guardSettings({ PARRANDA_PUBLIC_GUARD: "0" }).enabled, false);
  assert.equal(guardSettings({ PARRANDA_PUBLIC_GUARD: "enabled" }).enabled, true);
  assert.equal(guardSettings({ PARRANDA_PUBLIC_GUARD: "1" }).enabled, true);
  assert.equal(guardSettings({ PARRANDA_PUBLIC_GUARD: "yes-please" }).enabled, false);

  // Malformed numeric config falls back to the safe defaults rather than 0/NaN.
  const settings = guardSettings({
    PARRANDA_PUBLIC_GUARD_MAX: "-5",
    PARRANDA_PUBLIC_GUARD_CONCURRENCY: "abc",
    PARRANDA_TRUST_PROXY_HOPS: "-2",
  });
  assert.equal(settings.max, 20);
  assert.equal(settings.maxConcurrent, 8);
  assert.equal(settings.trustedHops, 0);
  assert.equal(settings.identityMode, "direct");
});

test("a disabled guard passes everything through (single-user local runs)", () => {
  const guard = createPublicAccessGuard({ env: { PARRANDA_PUBLIC_GUARD: "disabled", PARRANDA_PUBLIC_GUARD_MAX: "1" } });
  let passed = 0;
  for (let i = 0; i < 25; i += 1) {
    guard(requestFrom("/api/route-recommendations"), responseSpy(), () => {
      passed += 1;
    });
  }
  assert.equal(passed, 25);
});

test("an unconfigured normal deployment is not silently moved onto share limits", () => {
  const guard = createPublicAccessGuard({ env: { PARRANDA_PUBLIC_GUARD_MAX: "1" } });
  let passed = 0;
  for (let i = 0; i < 25; i += 1) {
    guard(requestFrom("/api/route-recommendations"), responseSpy(), () => { passed += 1; });
  }
  assert.equal(passed, 25);
});
