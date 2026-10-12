const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createSharedRateGate } = require("../server/place-candidates/shared-rate-gate");
const { createNominatimPlaceResolver } = require("../server/place-candidates/place-resolver");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "parranda-shared-gate-"));
}

test("two processes sharing a directory get slots one interval apart, never together", async () => {
  const dir = tempDir();
  const clock = { value: 0 };
  const now = () => clock.value;
  const web = createSharedRateGate({ dir, name: "nominatim", intervalMs: 1100, now });
  const worker = createSharedRateGate({ dir, name: "nominatim", intervalMs: 1100, now });
  const slots = [await web.reserve(0), await worker.reserve(0), await web.reserve(0)];
  assert.deepEqual(slots, [0, 1100, 2200]);
});

test("a provider cooldown learned by one process holds the other too", async () => {
  const dir = tempDir();
  const clock = { value: 10_000 };
  const now = () => clock.value;
  const web = createSharedRateGate({ dir, name: "nominatim", intervalMs: 1100, now });
  const worker = createSharedRateGate({ dir, name: "nominatim", intervalMs: 1100, now });
  await web.noteCooldown(70_000);
  assert.equal(await worker.reserve(0), 70_000);
});

test("a lock left by a crashed process is broken after it goes stale", async () => {
  const dir = tempDir();
  const clock = { value: 0 };
  fs.mkdirSync(path.join(dir, "nominatim.lock"));
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(dir, "nominatim.lock"), old, old);
  const gate = createSharedRateGate({ dir, name: "nominatim", intervalMs: 1100, now: () => clock.value, staleLockMs: 5000 });
  assert.equal(await gate.reserve(0), 0);
});

test("a lock that stays busy fails closed instead of skipping the shared limit", async () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, "nominatim.lock"));
  const gate = createSharedRateGate({ dir, name: "nominatim", intervalMs: 1100, staleLockMs: 60_000, maxLockWaitMs: 50 });
  await assert.rejects(gate.reserve(0), /shared_rate_gate_busy/);
});

test("two resolvers sharing a gate directory never call the provider in the same interval", async () => {
  const dir = tempDir();
  const calls = [];
  const fetcher = async () => {
    calls.push(Date.now());
    return { ok: true, status: 200, json: async () => [] };
  };
  // Slots are one interval apart; event-loop delay can only shift a send a
  // few ms, which the default 1100 ms interval's margin absorbs.
  const options = { fetcher, sharedGateDir: dir, minIntervalMs: 300 };
  const web = createNominatimPlaceResolver(options);
  const worker = createNominatimPlaceResolver(options);
  await Promise.all([web("Panora, Malmö"), worker("Moriska paviljongen, Malmö")]);
  calls.sort((a, b) => a - b);
  assert.equal(calls.length, 2);
  assert.ok(calls[1] - calls[0] >= 240, `calls ${calls[1] - calls[0]} ms apart must be about one interval apart`);
});

test("without a shared directory each resolver keeps only its own gate (today's behaviour)", async () => {
  const calls = [];
  const fetcher = async () => {
    calls.push(Date.now());
    return { ok: true, status: 200, json: async () => [] };
  };
  const web = createNominatimPlaceResolver({ fetcher, minIntervalMs: 300 });
  const worker = createNominatimPlaceResolver({ fetcher, minIntervalMs: 300 });
  await Promise.all([web("Panora, Malmö"), worker("Moriska paviljongen, Malmö")]);
  calls.sort((a, b) => a - b);
  assert.ok(calls[1] - calls[0] < 150, "the RED case the shared gate exists for");
});
