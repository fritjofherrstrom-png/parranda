const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createValhallaWalkingProvider,
  resolveNetworkWalkingProvider,
  LIMITS,
} = require("../server/valhalla-walking");

const points = [
  { lat: 46, lng: 8, label: "private start" },
  { lat: 46.01, lng: 8.01, label: "private preference" },
];
function encode(points) {
  let lat = 0,
    lng = 0;
  return points
    .map((p) => {
      const next = [Math.round(p.lat * 1e6), Math.round(p.lng * 1e6)];
      const diff = [next[0] - lat, next[1] - lng];
      [lat, lng] = next;
      return diff
        .map((n) => {
          let v = n < 0 ? ~(n << 1) : n << 1,
            s = "";
          while (v >= 32) {
            s += String.fromCharCode((32 | (v & 31)) + 63);
            v >>>= 5;
          }
          return s + String.fromCharCode(v + 63);
        })
        .join("");
    })
    .join("");
}
function payload(ps = points) {
  const { distanceKm } = require("../server/planner/candidate-reach-policy");
  const length = ps
    .slice(1)
    .reduce((sum, p, i) => sum + distanceKm(ps[i], p), 0);
  return {
    trip: {
      status: 0,
      units: "kilometers",
      summary: { length, time: 1440, has_ferry: false },
      legs: [
        {
          summary: { length, time: 1440, has_ferry: false },
          maneuvers: [{ travel_mode: "pedestrian", ferry: false }],
          shape: encode(ps),
        },
      ],
    },
  };
}
function response(body = payload(), extra = {}) {
  const r = new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...extra,
  });
  return r;
}
const create = (fetcher, extra = {}) =>
  createValhallaWalkingProvider({
    endpoint: "https://routing.example.test/route",
    fetcher,
    ...extra,
  });

test("default off; invalid operator configuration does not enable a public demo", () => {
  assert.equal(resolveNetworkWalkingProvider({}), null);
  assert.equal(
    resolveNetworkWalkingProvider({ PARRANDA_NETWORK_WALKING: "enabled" })
      .configured,
    false,
  );
  for (const endpoint of [
    "http://outside.test/route",
    "https://user:pass@test/route",
    "https://test/route?key=x",
    "ftp://test/route",
  ])
    assert.equal(
      create(async () => response(), { endpoint }).configured,
      false,
    );
});
test("adapter failures expose only sanitized operational or route rejection reasons", async () => {
  const cases = [
    [create(async () => { throw Error("secret endpoint credentials"); }), "provider_unavailable"],
    [create(async () => response({ error: "private upstream" }, { status: 503 })), "provider_unavailable"],
    [create(async () => response({}, { status: 429 })), "busy"],
    [create(async () => response(), { endpoint: "https://user:secret@test/route" }), "invalid_configuration"],
    [create(async () => response({ error_code: 442, error: "private no route" }, { status: 400 })), "route_rejected"],
    [create(async () => response({})), "route_rejected"],
  ];
  for (const [provider, reason] of cases) {
    assert.deepEqual(await provider.session().route(points), { status: "unavailable", reason });
  }
});

test("session deadlines and exhausted call budgets are operational failures", async () => {
  let now = 0;
  const p = create(async () => response(), { now: () => now });
  const s = p.session();
  assert.equal((await s.route(points)).status, "ok");
  now = LIMITS.totalMs + 1;
  assert.deepEqual(await s.route(points), { status: "unavailable", reason: "provider_unavailable" });
  const capped = p.session();
  for (let i = 0; i < LIMITS.requests; i++) await capped.route(points);
  assert.deepEqual(await capped.route(points), { status: "unavailable", reason: "busy" });
});

test("pedestrian-only request sends coordinates, not names, request tokens or preferences", async () => {
  const calls = [];
  const p = create(async (url, options) => {
    calls.push({ url: String(url), options });
    return response();
  });
  const r = await p.session().route(points);
  assert.equal(r.status, "ok");
  assert.equal(r.source, "valhalla_pedestrian");
  assert.deepEqual(
    r.pathPoints,
    points.map(({ lat, lng }) => ({ lat, lng })),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, "error");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.costing, "pedestrian");
  assert.equal(body.units, "kilometers");
  assert.equal(body.directions_type, "maneuvers");
  assert.equal(body.costing_options.pedestrian.use_ferry, 0);
  assert.ok(!JSON.stringify(body).includes("private"));
});
test("missing geometry, inconsistent summaries, ferry and large snap are fail closed", async () => {
  const bad = [
    (b) => {
      delete b.trip.legs[0].shape;
    },
    (b) => {
      b.trip.summary.length = 8;
    },
    (b) => {
      b.trip.summary.has_ferry = true;
    },
    (b) => {
      b.trip.legs[0].summary.has_ferry = true;
    },
    (b) => {
      b.trip.legs[0].shape = encode([{ lat: 46.2, lng: 8 }, points[1]]);
    },
    (b) => {
      b.trip.units = "miles";
    },
    (b) => {
      b.trip.legs[0].summary.time = null;
    },
    (b) => {
      b.trip.legs[0].shape = "~~~~~~";
    },
  ];
  for (const mutate of bad) {
    const b = payload();
    mutate(b);
    const r = await create(async () => response(b))
      .session()
      .route(points);
    assert.notEqual(r.status, "ok");
  }
});
test("consistent totals cannot conceal a different path length", async () => {
  const b = payload();
  b.trip.summary.length = 8;
  b.trip.legs[0].summary.length = 8;
  assert.equal(
    (
      await create(async () => response(b))
        .session()
        .route(points)
    ).status,
    "unavailable",
  );
});
test("false ferry summaries without complete pedestrian maneuver evidence are not trusted", async () => {
  for (const maneuvers of [
    undefined,
    [],
    [{ travel_mode: "drive" }],
    [{}],
    [{ travel_mode: "pedestrian", ferry: true }],
  ]) {
    const b = payload();
    b.trip.legs[0].maneuvers = maneuvers;
    assert.equal(
      (
        await create(async () => response(b))
          .session()
          .route(points)
      ).status,
      "unavailable",
    );
  }
});
test("warm cache is exact-coordinate, TTL-bounded, label-independent and never caches failure", async () => {
  let calls = 0,
    now = 1;
  const p = create(
    async () => {
      calls++;
      return calls === 1 ? response({}, { status: 503 }) : response();
    },
    { now: () => now },
  );
  assert.notEqual((await p.session().route(points)).status, "ok");
  assert.equal((await p.session().route(points)).status, "ok");
  await p.session().route(points.map((p) => ({ ...p, label: "changed" })));
  assert.equal(calls, 2);
  now += LIMITS.ttlMs + 1;
  await p.session().route(points);
  assert.equal(calls, 3);
});
test("stream byte cap stops body reading and failures are not heuristic", async () => {
  let cancelled = false;
  const p = create(
    async () =>
      new Response(
        new ReadableStream({
          pull(c) {
            c.enqueue(new Uint8Array(LIMITS.responseBytes + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  assert.notEqual((await p.session().route(points)).status, "ok");
  assert.equal(cancelled, true);
});
test("coalesced cancellation preserves a live consumer, last cancellation aborts producer", async () => {
  let signal,
    finish,
    calls = 0;
  const p = create(async (_url, opts) => {
    calls++;
    signal = opts.signal;
    return new Promise((resolve) => {
      finish = () => resolve(response());
    });
  });
  const a = new AbortController(),
    b = new AbortController();
  const one = p.session({ signal: a.signal }).route(points);
  const two = p.session({ signal: b.signal }).route(points);
  await new Promise((resolve) => setImmediate(resolve));
  a.abort();
  await assert.rejects(one);
  assert.equal(signal.aborted, false);
  finish();
  assert.equal((await two).status, "ok");
  assert.equal(calls, 1);
  const q = create(async (_url, opts) => {
    signal = opts.signal;
    return new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      }),
    );
  });
  const c = new AbortController();
  const last = q.session({ signal: c.signal }).route(points);
  await new Promise((resolve) => setImmediate(resolve));
  c.abort();
  await assert.rejects(last);
  assert.equal(signal.aborted, true);
});

test("global acquisition slots have no unbounded waiting queue; a session makes at most four requests", async () => {
  let calls = 0;
  const p = create(async () => {
    calls++;
    return response();
  });
  const s = p.session();
  for (let i = 0; i < 5; i++)
    await s.route(points.map((p) => ({ ...p, lat: p.lat + i * 0.000001 })));
  assert.equal(calls, 4);
  const controllers = [];
  const q = create(
    async (_url, { signal }) =>
      new Promise((_, reject) => {
        controllers.push(signal);
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  );
  const cancel = new AbortController();
  const first = q
    .session({ signal: cancel.signal })
    .route(points)
    .catch(() => {});
  const second = q
    .session({ signal: cancel.signal })
    .route(points.map((p) => ({ ...p, lng: p.lng + 0.001 })))
    .catch(() => {});
  await new Promise((r) => setImmediate(r));
  const third = await q
    .session()
    .route(points.map((p) => ({ ...p, lng: p.lng + 0.002 })));
  assert.equal(third.status, "unavailable");
  assert.equal(third.reason, "busy");
  assert.equal(controllers.length, 2);
  cancel.abort();
  await Promise.all([first, second]);
});
test("request deadline covers an outstanding streamed body, not just response headers", async () => {
  let cancelled = false;
  const p = create(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  const start = performance.now();
  assert.deepEqual(await p.session().route(points), {
    status: "unavailable", reason: "provider_unavailable",
  });
  assert.equal(cancelled, true);
  assert.ok(performance.now() - start < LIMITS.requestMs + 2000);
});
test("redirect/final endpoint drift, wrong content type and too many points never publish geometry", async () => {
  const drift = response();
  Object.defineProperty(drift, "url", { value: "https://other.test/route" });
  assert.notEqual(
    (
      await create(async () => drift)
        .session()
        .route(points)
    ).status,
    "ok",
  );
  assert.notEqual(
    (
      await create(async () =>
        response(payload(), { headers: { "content-type": "text/html" } }),
      )
        .session()
        .route(points)
    ).status,
    "ok",
  );
  let calls = 0;
  const p = create(async () => {
    calls++;
    return response();
  });
  assert.equal(
    (await p.session().route(Array.from({ length: 11 }, () => points[0])))
      .status,
    "unavailable",
  );
  assert.equal(calls, 0);
});
test("abandoned late response cannot populate cache or release a newer same-key owner", async () => {
  const finishes = [];
  let calls = 0;
  const p = create(async () => {
    calls++;
    return new Promise((resolve) => finishes.push(() => resolve(response())));
  });
  const c = new AbortController();
  const abandoned = p.session({ signal: c.signal }).route(points);
  await new Promise((r) => setImmediate(r));
  c.abort();
  await assert.rejects(abandoned);
  const next = p.session().route(points);
  await new Promise((r) => setImmediate(r));
  finishes[0]();
  await new Promise((r) => setImmediate(r));
  const shared = p.session().route(points);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 2);
  finishes[1]();
  assert.equal((await next).status, "ok");
  assert.equal((await shared).status, "ok");
});
