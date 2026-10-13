const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { fork } = require("node:child_process");

const { createSharedRateGate } = require("../server/place-candidates/shared-rate-gate");
const { createNominatimPlaceResolver } = require("../server/place-candidates/place-resolver");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "parranda-shared-gate-"));
}

test("two gate instances sharing a directory get slots one interval apart", async () => {
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

test("an old lock fails closed because age alone cannot prove its owner died", async () => {
  const dir = tempDir();
  const clock = { value: 0 };
  fs.mkdirSync(path.join(dir, "nominatim.lock"));
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(dir, "nominatim.lock"), old, old);
  const gate = createSharedRateGate({ dir, name: "nominatim", intervalMs: 1100, now: () => clock.value, maxLockWaitMs: 30 });
  await assert.rejects(gate.reserve(0), /shared_rate_gate_busy/);
  assert.ok(fs.existsSync(path.join(dir, "nominatim.lock")), "unknown owner lock is preserved");
});

for (const data of ['{broken', '{}', '{"next":-1,"cooldownUntil":0}', '{"next":0,"cooldownUntil":"30000"}']) {
  test(`invalid gate state fails closed: ${data}`, async t => {
    const dir = tempDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, "nominatim.gate.json"), data);
    let calls = 0;
    const resolver = createNominatimPlaceResolver({ sharedGateDir: dir,
      fetcher: async () => { calls += 1; return { ok: true, status: 200, json: async () => [] }; } });
    assert.deepEqual(await resolver("Fixture venue"), []);
    assert.equal(calls, 0, "invalid shared state must prevent provider fetch");
    assert.equal(fs.readFileSync(path.join(dir, "nominatim.gate.json"), "utf8"), data);
  });
}

function processHarness(t, mode, dir) {
  const child = fork(path.join(__dirname, "helpers/shared-gate-process.cjs"), [mode, dir],
    { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  t.after(() => child.kill());
  const pending = [], queued = [];
  child.on("message", message => pending.length ? pending.shift()(message) : queued.push(message));
  return { child, read: () => queued.length ? Promise.resolve(queued.shift()) : new Promise(resolve => pending.push(resolve)) };
}

test("six real OS processes serialize reservations in one shared state", { timeout: 10000 }, async t => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const workers = Array.from({ length: 6 }, () => processHarness(t, "reserve", dir));
  const results = await Promise.all(workers.map(worker => worker.read()));
  assert.deepEqual(results.map(result => result.slot).sort((a, b) => a - b), [0, 1100, 2200, 3300, 4400, 5500]);
});

test("a live delayed owner cannot be evicted and lose its reservation", { timeout: 10000 }, async t => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "nominatim.gate.json"), '{"next":0,"cooldownUntil":0}');
  const owner = processHarness(t, "paused-owner", dir);
  assert.deepEqual(await owner.read(), { held: true });
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(path.join(dir, "nominatim.lock"), old, old);
  const successor = processHarness(t, "contender", dir);
  const result = await successor.read();
  owner.child.send("release");
  const first = await owner.read();
  assert.deepEqual(result, { error: "shared_rate_gate_busy" });
  assert.deepEqual(first, { slot: 0 });
  const gate = createSharedRateGate({ dir, name: "nominatim", intervalMs: 1100, now: () => 0 });
  assert.equal(await gate.reserve(), 1100, "the original owner commits before releasing its own lock");
});

test("a process waiting to send observes a cooldown learned after its initial check", { timeout: 10000 }, async t => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gate = createSharedRateGate({ dir, name: "nominatim", intervalMs: 1100, now: () => 0 });
  await gate.reserve();
  const worker = processHarness(t, "resolver", dir);
  assert.deepEqual(await worker.read(), { waiting: 1100 });
  await gate.noteCooldown(30000);
  worker.child.send({ now: 1100 });
  let message = await worker.read();
  if (message.waiting != null) {
    assert.equal(message.waiting, 28900);
    worker.child.send({ now: 30000 });
    message = await worker.read();
  }
  assert.deepEqual(message, { sent: 30000 });
  assert.deepEqual(await worker.read(), { done: true });
});

test("delayed wakeups from two processes cannot send in the same instant", { timeout: 10000 }, async t => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gate = createSharedRateGate({ dir, name: "nominatim", intervalMs: 1100, now: () => 0 });
  await gate.reserve();
  const first = processHarness(t, "resolver", dir), second = processHarness(t, "resolver", dir);
  assert.ok((await first.read()).waiting > 0);
  assert.ok((await second.read()).waiting > 0);
  first.child.send({ now: 4400 });
  assert.deepEqual(await first.read(), { sent: 4400 });
  assert.deepEqual(await first.read(), { done: true });
  second.child.send({ now: 4400 });
  let message = await second.read();
  if (message.waiting != null) {
    assert.equal(message.waiting, 1100);
    second.child.send({ now: 5500 });
    message = await second.read();
  }
  assert.deepEqual(message, { sent: 5500 });
  assert.deepEqual(await second.read(), { done: true });
});

test("the interval starts at actual dispatch even when the process pauses after admission", async t => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = 0;
  const calls = [];
  const options = { sharedGateDir: dir, minIntervalMs: 1100,
    now: () => clock, sleep: async ms => { clock += ms; } };
  const web = createNominatimPlaceResolver({ ...options, fetcher: async () => {
    clock = 4400;
    calls.push(clock);
    return { ok: true, status: 200, json: async () => [] };
  } });
  const worker = createNominatimPlaceResolver({ ...options, fetcher: async () => {
    calls.push(clock);
    return { ok: true, status: 200, json: async () => [] };
  } });
  await web("Fixture web");
  await worker("Fixture worker");
  assert.deepEqual(calls, [4400, 5500]);
});

test("losing lock ownership cannot overwrite state or remove a successor's lock", async t => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lock = path.join(dir, "nominatim.lock"), state = path.join(dir, "nominatim.gate.json");
  const gate = createSharedRateGate({ dir, name: "nominatim", intervalMs: 1100, now: () => 0 });
  await assert.rejects(gate.run(async () => {
    // Simulate external replacement; normal participants never steal a lock.
    fs.rmSync(lock, { recursive: true });
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, "successor.owner"), "");
    fs.writeFileSync(state, '{"next":7000,"cooldownUntil":9000}');
    return true;
  }), /shared_rate_gate_owner_lost/);
  assert.deepEqual(JSON.parse(fs.readFileSync(state)), { next: 7000, cooldownUntil: 9000 });
  assert.ok(fs.existsSync(path.join(lock, "successor.owner")));
});

test("a failed state commit after dispatch retains the lock and prevents another send", async t => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const promises = require("node:fs/promises"), rename = promises.rename;
  const state = path.join(dir, "nominatim.gate.json");
  let calls = 0;
  promises.rename = async (from, to) => {
    if (to === state) throw Object.assign(new Error("fixture disk failure"), { code: "EIO" });
    return rename(from, to);
  };
  t.after(() => { promises.rename = rename; });
  const gate = createSharedRateGate({ dir, name: "nominatim", intervalMs: 1100, maxLockWaitMs: 30 });
  await assert.rejects(gate.run(async () => { calls += 1; return true; }), /fixture disk failure/);
  await assert.rejects(gate.run(async () => { calls += 1; return true; }), /shared_rate_gate_busy/);
  assert.equal(calls, 1);
});

test("a returned Retry-After is committed before another resolver can send", async t => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = 0;
  const calls = [];
  const options = { sharedGateDir: dir, minIntervalMs: 1100,
    now: () => clock, sleep: async ms => { clock += ms; } };
  const web = createNominatimPlaceResolver({ ...options, fetcher: async () => {
    calls.push(clock);
    return { ok: false, status: 429, headers: { get: name => name.toLowerCase() === "retry-after" ? "30" : null } };
  } });
  assert.deepEqual(await web("Fixture web"), []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "nominatim.gate.json"))).cooldownUntil, 30000);
  const worker = createNominatimPlaceResolver({ ...options, fetcher: async () => {
    calls.push(clock);
    return { ok: true, status: 200, json: async () => [] };
  } });
  await worker("Fixture worker");
  assert.deepEqual(calls, [0, 30000]);
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
