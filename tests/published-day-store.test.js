"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { isDeepStrictEqual } = require("node:util");
const SCRATCH = process.env.TMPDIR || process.env.RUNNER_TEMP || tmpdir();
let api;
try {
  api = require("../server/planner/published-day-store");
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND" || !error.message.includes("../server/planner/published-day-store")) throw error;
}

const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const publication = () => ({
  intent: { date: "2026-10-25", city: "Berlin" },
  result: { days: [{ date: "2026-10-25", stops: [{ name: "Museum" }] }] },
  language: "en",
});

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(SCRATCH, "published-day-store-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, store: api.createPublishedDayStore({ directory, clock: () => NOW, ...options }) };
}

test("put atomically persists a server-owned publication and read returns its envelope", async (t) => {
  const { directory, store } = await fixture(t);
  const input = publication();
  assert.equal(typeof store.put, "function", "store must provide persistent put");
  const outcome = await store.put(input);
  assert.equal(outcome.state, "ready");
  const { snapshot } = outcome;
  assert.equal(api.validPublishedDayRef(snapshot.ref), true);
  assert.deepEqual(Object.keys(snapshot).sort(), ["created_at", "expires_at", "ref", "version"]);
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.created_at, new Date(NOW).toISOString());
  assert.equal(snapshot.expires_at, new Date(NOW + 7 * 24 * 60 * 60 * 1000).toISOString());
  const recordPath = path.join(directory, "published-days-v1", `${snapshot.ref}.json`);
  const disk = JSON.parse(await fs.readFile(recordPath, "utf8"));
  assert.equal(isDeepStrictEqual(disk, { ...snapshot, ...input }), true, "disk must contain the exact complete envelope");
  assert.equal(isDeepStrictEqual(await store.read(snapshot.ref), { status: 200, body: disk }), true, "read must return the persisted envelope");
  assert.equal((await fs.stat(path.dirname(recordPath))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(recordPath)).mode & 0o777, 0o600);
  assert.equal((await fs.readdir(path.dirname(recordPath))).length, 1);
});

test("restart returns fresh deeply immutable envelopes without consuming caller metadata", async (t) => {
  const { directory, store } = await fixture(t);
  const input = publication();
  delete input.language;
  input.ref = "a".repeat(48);
  input.created_at = "1900-01-01T00:00:00.000Z";
  input.expires_at = "2999-01-01T00:00:00.000Z";
  const before = structuredClone(input);
  const saved = await store.put(input);
  assert.deepEqual(input, before);
  assert.notEqual(saved.snapshot.ref, input.ref);
  assert.equal(saved.snapshot.created_at, new Date(NOW).toISOString());
  const restarted = api.createPublishedDayStore({ directory, clock: () => NOW });
  const first = await restarted.read(saved.snapshot.ref);
  assert.equal(first.status, 200);
  assert.equal(first.body.language, "en");
  assert.equal(Object.isFrozen(first.body), true);
  assert.equal(Object.isFrozen(first.body.result.days[0].stops[0]), true);
  assert.throws(() => { first.body.result.days[0].stops[0].name = "changed"; }, TypeError);
  input.result.days[0].stops[0].name = "caller changed";
  const second = await restarted.read(saved.snapshot.ref);
  assert.notEqual(first.body, second.body);
  assert.equal(second.body.result.days[0].stops[0].name, "Museum");
});

test("TTL is absolute across reads and expiry physically removes owned records", async (t) => {
  let now = NOW;
  const { directory, store } = await fixture(t, { clock: () => now, ttlMs: 1000 });
  const saved = await store.put(publication());
  const ref = saved.snapshot.ref;
  now += 999;
  assert.equal((await store.read(ref)).body.expires_at, saved.snapshot.expires_at);
  now += 1;
  const expired = await store.read(ref);
  assert.equal(expired.status, 410);
  assert.deepEqual(expired, { status: 410, body: { error: "day_snapshot_expired" } });
  assert.equal((await fs.readdir(path.join(directory, "published-days-v1"))).length, 0);
  assert.deepEqual(await store.read(ref), { status: 404, body: { error: "day_snapshot_unavailable" } });
});

test("refs are exact lowercase 48-hex capabilities and malformed reads never reach disk", async (t) => {
  const { store } = await fixture(t);
  const invalid = [null, undefined, 5, {}, [], "", "a".repeat(47), "a".repeat(49), "A".repeat(48), "g".repeat(48), ` ${"a".repeat(48)}`, `${"a".repeat(48)}\n`, "../secret", new String("a".repeat(48))];
  assert.equal(api.validPublishedDayRef("0abcdef123456789".repeat(3)), true);
  for (const value of invalid) {
    assert.equal(api.validPublishedDayRef(value), false, "invalid ref must not be repaired");
    assert.deepEqual(await store.read(value), { status: 400, body: { error: "invalid_day_snapshot_ref" } });
  }
  assert.deepEqual(await store.read("f".repeat(48)), { status: 404, body: { error: "day_snapshot_unavailable" } });
});

test("unavailable or read-only storage never reports durable success or harms issued records", async (t) => {
  const { directory, store } = await fixture(t);
  const missing = api.createPublishedDayStore({ directory: path.join(directory, "missing"), clock: () => NOW });
  assert.deepEqual(await missing.put(publication()).catch(() => ({ state: "threw" })), { state: "unavailable", reason: "storage_unavailable" });
  const saved = await store.put(publication());
  const storage = path.join(directory, "published-days-v1");
  await fs.chmod(storage, 0o500);
  t.after(() => fs.chmod(storage, 0o700).catch(() => {}));
  assert.deepEqual(await store.put(publication()).catch(() => ({ state: "threw" })), { state: "unavailable", reason: "storage_unavailable" });
  assert.equal((await store.read(saved.snapshot.ref)).status, 200);
  await fs.chmod(storage, 0o700);
  const next = await store.put(publication());
  assert.equal(next.state, "ready");
  assert.equal((await store.read(saved.snapshot.ref)).status, 200);
  assert.equal((await fs.readdir(storage)).length, 2);
});

test("UTF-8 envelope byte limits are exact and oversized files are rejected before JSON parsing", async (t) => {
  const input = publication();
  input.result.label = "é🚲";
  const byteSize = Buffer.byteLength(JSON.stringify({ version: 1, ref: "a".repeat(48), created_at: new Date(NOW).toISOString(), expires_at: new Date(NOW + 1000).toISOString(), language: input.language, intent: input.intent, result: input.result }));
  const { directory, store } = await fixture(t, { ttlMs: 1000, maxEntryBytes: byteSize });
  const saved = await store.put(input);
  assert.equal(saved.state, "ready");
  assert.equal((await fs.stat(path.join(directory, "published-days-v1", `${saved.snapshot.ref}.json`))).size, byteSize);
  input.result.label += "é";
  const tooLarge = await store.put(input);
  assert.equal(tooLarge.state, "unavailable");
  assert.equal(tooLarge.reason, "entry_too_large");
  const record = path.join(directory, "published-days-v1", `${saved.snapshot.ref}.json`);
  await fs.writeFile(record, "x".repeat(byteSize + 1));
  let parses = 0;
  const parse = JSON.parse;
  const spy = t.mock.method(JSON, "parse", (...args) => { parses += 1; return parse(...args); });
  const read = await store.read(saved.snapshot.ref);
  spy.mock.restore();
  assert.equal(read.status, 404);
  assert.equal(parses, 0, "oversized disk bytes must not reach the parser");
});

test("entry quota survives restart and counts corrupt owned finals without evicting issued links", async (t) => {
  const { directory, store } = await fixture(t, { maxEntries: 1 });
  const saved = await store.put(publication());
  assert.equal(saved.state, "ready");
  const restarted = api.createPublishedDayStore({ directory, clock: () => NOW, maxEntries: 1 });
  const denied = await restarted.put(publication());
  assert.equal(denied.state, "unavailable");
  assert.equal(denied.reason, "quota_exceeded");
  assert.equal((await store.read(saved.snapshot.ref)).status, 200);
  const storage = path.join(directory, "published-days-v1");
  await fs.writeFile(path.join(storage, `${saved.snapshot.ref}.json`), "corrupt");
  assert.deepEqual(await restarted.put(publication()), { state: "unavailable", reason: "quota_exceeded" });
  assert.equal((await fs.readdir(storage)).length, 1);
});

test("aggregate byte quota survives restart and includes corrupt owned file sizes", async (t) => {
  const { directory, store } = await fixture(t);
  const saved = await store.put(publication());
  const file = path.join(directory, "published-days-v1", `${saved.snapshot.ref}.json`);
  const size = (await fs.stat(file)).size;
  const exact = api.createPublishedDayStore({ directory, clock: () => NOW, maxTotalBytes: size * 2 });
  assert.equal((await exact.put(publication())).state, "ready");
  const denied = await exact.put(publication());
  assert.equal(denied.state, "unavailable");
  assert.equal(denied.reason, "quota_exceeded");
  await fs.writeFile(file, "x".repeat(size + 1));
  const restarted = api.createPublishedDayStore({ directory, clock: () => NOW, maxTotalBytes: size * 3 });
  assert.deepEqual(await restarted.put(publication()), { state: "unavailable", reason: "quota_exceeded" });
  assert.equal((await fs.readdir(path.dirname(file))).length, 2);
});

test("concurrent puts across instances serialize the single writer and enforce both disk caps", async (t) => {
  const { directory, store } = await fixture(t, { maxEntries: 2 });
  const other = api.createPublishedDayStore({ directory, clock: () => NOW, maxEntries: 2 });
  const outcomes = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? store : other).put(publication())));
  assert.equal(outcomes.filter(outcome => outcome.state === "ready").length, 2);
  assert.equal(outcomes.filter(outcome => outcome.reason === "quota_exceeded").length, 10);
  assert.equal((await fs.readdir(path.join(directory, "published-days-v1"))).length, 2);
  for (const outcome of outcomes.filter(value => value.state === "ready")) assert.equal((await other.read(outcome.snapshot.ref)).status, 200);
});

test("admission reclaims only expired owned records and preserves unrelated namespace data", async (t) => {
  let now = NOW;
  const { directory, store } = await fixture(t, { clock: () => now, ttlMs: 1000, maxEntries: 2 });
  const expired = await store.put(publication());
  now += 500;
  const promised = await store.put(publication());
  const storage = path.join(directory, "published-days-v1");
  await fs.writeFile(path.join(storage, "unrelated.json"), "keep");
  await fs.mkdir(path.join(storage, "other-namespace"));
  await fs.writeFile(path.join(directory, "root-owned-by-caller"), "keep");
  now += 500;
  const next = await store.put(publication());
  assert.equal(next.state, "ready");
  assert.equal((await store.read(expired.snapshot.ref)).status, 404);
  assert.equal((await store.read(promised.snapshot.ref)).status, 200);
  assert.equal(await fs.readFile(path.join(storage, "unrelated.json"), "utf8"), "keep");
  assert.equal((await fs.stat(path.join(storage, "other-namespace"))).isDirectory(), true);
  assert.equal(await fs.readFile(path.join(directory, "root-owned-by-caller"), "utf8"), "keep");
  const lowerCap = api.createPublishedDayStore({ directory, clock: () => now, maxEntries: 1 });
  assert.deepEqual(await lowerCap.put(publication()), { state: "unavailable", reason: "quota_exceeded" });
  assert.equal((await store.read(promised.snapshot.ref)).status, 200);
});

test("unsafe JSON is rejected without accessors, toJSON, proxies, truncation or caller mutation", async (t) => {
  const { store } = await fixture(t);
  let invoked = 0;
  const accessor = publication();
  Object.defineProperty(accessor.result, "secret", { enumerable: true, get() { invoked += 1; return "bad"; } });
  const answer = await store.put(accessor);
  assert.equal(invoked, 0, "an accessor must never run");
  assert.deepEqual(answer, { state: "unavailable", reason: "invalid_publication" });
  const cycle = {}; cycle.self = cycle;
  const sparse = []; sparse.length = 2;
  const symbol = {}; symbol[Symbol("hidden")] = true;
  const nonEnumerable = {}; Object.defineProperty(nonEnumerable, "hidden", { value: 1 });
  const proxy = new Proxy({}, { ownKeys() { invoked += 1; return []; } });
  const values = [cycle, sparse, symbol, nonEnumerable, proxy, new Date(), new Map(), Buffer.from("x"), Object.create({ inherited: true }), { toJSON() { invoked += 1; return {}; } }, { value: undefined }, { value: NaN }, { value: Infinity }, { value: 1n }, { value: () => {} }, { value: Symbol("x") }];
  for (const value of values) {
    const input = publication(); input.result.unsafe = value;
    assert.deepEqual(await store.put(input), { state: "unavailable", reason: "invalid_publication" });
  }
  for (const input of [undefined, null, [], {}, { intent: [], result: {} }, { intent: {}, result: null }, { intent: {}, result: {}, language: 1 }]) {
    assert.deepEqual(await store.put(input), { state: "unavailable", reason: "invalid_publication" });
  }
  const top = {};
  Object.defineProperty(top, "intent", { get() { invoked += 1; return {}; } });
  assert.deepEqual(await store.put(top), { state: "unavailable", reason: "invalid_publication" });
  assert.equal(invoked, 0);
  const safe = publication();
  safe.result.literal = JSON.parse('{"__proto__":{"keep":true},"constructor":"literal"}');
  const pending = store.put(safe);
  safe.result.days[0].stops[0].name = "changed synchronously";
  const saved = await pending;
  assert.equal(saved.state, "ready");
  const read = await store.read(saved.snapshot.ref);
  assert.equal(read.body.result.days[0].stops[0].name, "Museum");
  assert.equal(Object.hasOwn(read.body.result.literal, "__proto__"), true);
  assert.equal({}.keep, undefined);
});

test("selected date bindings must be real ISO days and agree across intent and result", async (t) => {
  const { store } = await fixture(t);
  for (const date of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-00-01", "0000-01-01", "2026-1-01", "2026-10-25\n", null, 20261025]) {
    const input = publication(); input.intent.date = date; input.result.days[0].date = date;
    const outcome = await store.put(input);
    assert.equal(outcome.state, "unavailable", "invalid calendar date must not be stored");
    assert.equal(outcome.reason, "invalid_publication");
  }
  const mismatch = publication(); mismatch.result.days[0].date = "2026-10-26";
  assert.deepEqual(await store.put(mismatch), { state: "unavailable", reason: "invalid_publication" });
  for (const key of ["date", "selected_date", "selectedDate", "requested_date"]) {
    const input = publication(); input.result[key] = "2026-10-26";
    assert.deepEqual(await store.put(input), { state: "unavailable", reason: "invalid_publication" });
  }
  const leap = publication(); leap.intent.date = "2028-02-29"; leap.result.days[0].date = "2028-02-29";
  assert.equal((await store.put(leap)).state, "ready");
  assert.equal((await store.put({ intent: {}, result: {} })).state, "ready", "absent selected dates are permitted");
});

test("reads fail closed for corrupt or unsupported envelopes without deleting them", async (t) => {
  const { directory, store } = await fixture(t, { maxEntries: 1 });
  const saved = await store.put(publication());
  const file = path.join(directory, "published-days-v1", `${saved.snapshot.ref}.json`);
  const original = JSON.parse(await fs.readFile(file, "utf8"));
  const mutations = [
    record => { record.version = 2; },
    record => { record.ref = "b".repeat(48); },
    record => { record.ref = record.ref.toUpperCase(); },
    record => { delete record.language; },
    record => { record.language = 42; },
    record => { record.extra = true; },
    record => { record.created_at = "not-time"; },
    record => { record.created_at = "2026-02-30T12:00:00.000Z"; },
    record => { record.created_at = record.created_at.replace(".000Z", "Z"); },
    record => { record.expires_at = record.created_at; },
    record => { record.expires_at = "2020-01-01T00:00:00.000Z"; },
    record => { record.intent = []; },
    record => { record.result.days[0].date = "2026-10-26"; },
  ];
  for (const mutate of mutations) {
    const record = structuredClone(original); mutate(record);
    await fs.writeFile(file, JSON.stringify(record));
    const outcome = await store.read(saved.snapshot.ref);
    assert.equal(outcome.status, 404, "unsupported envelope must not be served or treated as expired");
    assert.deepEqual(outcome.body, { error: "day_snapshot_unavailable" });
    assert.equal((await fs.stat(file)).isFile(), true);
    assert.deepEqual(await store.put(publication()), { state: "unavailable", reason: "quota_exceeded" });
  }
  for (const text of ["null", "[]", "{}", "broken", JSON.stringify(original).replace('"Museum"', '1e999')]) {
    await fs.writeFile(file, text);
    assert.equal((await store.read(saved.snapshot.ref)).status, 404);
  }
  await fs.writeFile(file, JSON.stringify(original));
  const differentTtl = api.createPublishedDayStore({ directory, clock: () => NOW + 5000, ttlMs: 1 });
  assert.equal((await differentTtl.read(saved.snapshot.ref)).status, 200, "a new instance must not shorten or renew the persisted TTL");
});

test("symlinked records, storage directories and cache ancestors are never followed", async (t) => {
  const { directory, store } = await fixture(t, { maxEntries: 1 });
  const saved = await store.put(publication());
  const storage = path.join(directory, "published-days-v1");
  const file = path.join(storage, `${saved.snapshot.ref}.json`);
  const victim = path.join(directory, "outside-record");
  const text = await fs.readFile(file, "utf8");
  await fs.writeFile(victim, text);
  await fs.unlink(file);
  await fs.symlink(victim, file);
  assert.equal((await store.read(saved.snapshot.ref)).status, 404);
  assert.deepEqual(await store.put(publication()), { state: "unavailable", reason: "quota_exceeded" });
  assert.equal(await fs.readFile(victim, "utf8") === text, true);
  assert.equal((await fs.lstat(file)).isSymbolicLink(), true);
  await fs.rename(storage, path.join(directory, "real-storage"));
  await fs.symlink(path.join(directory, "real-storage"), storage);
  assert.equal((await store.read(saved.snapshot.ref)).status, 404);
  assert.deepEqual(await store.put(publication()), { state: "unavailable", reason: "storage_unavailable" });
  const alias = path.join(directory, "alias");
  const realCache = path.join(directory, "real-cache");
  await fs.mkdir(realCache);
  await fs.symlink(realCache, alias);
  for (const root of [alias, path.join(alias, "nested")]) {
    if (root !== alias) await fs.mkdir(path.join(realCache, "nested"));
    const unsafe = api.createPublishedDayStore({ directory: root, clock: () => NOW });
    assert.deepEqual(await unsafe.put(publication()), { state: "unavailable", reason: "storage_unavailable" });
  }
  assert.deepEqual(await fs.readdir(realCache), ["nested"]);
});

test("invalid configuration and invalid clock outputs fail closed without silently raising caps", async (t) => {
  const { directory } = await fixture(t);
  for (const overrides of [{ ttlMs: 0 }, { ttlMs: -1 }, { ttlMs: "1000" }, { ttlMs: Infinity }, { maxEntries: 0 }, { maxEntries: 1.5 }, { maxEntries: null }, { maxTotalBytes: 0 }, { maxTotalBytes: NaN }, { maxEntryBytes: 0 }, { maxEntryBytes: Number.MAX_SAFE_INTEGER + 1 }, { clock: null }, { directory: "" }, { directory: null }]) {
    let store;
    assert.doesNotThrow(() => { store = api.createPublishedDayStore({ directory, clock: () => NOW, ...overrides }); });
    const outcome = await store.put(publication());
    assert.equal(outcome.state, "unavailable");
    assert.equal(outcome.reason, "invalid_config");
    assert.equal((await store.read("a".repeat(48))).status, 404);
    assert.equal((await store.read("bad")).status, 400);
  }
  for (const value of [NaN, Infinity, "2026-10-24", new Date(NOW), undefined, 0.5, 8640000000000000]) {
    const store = api.createPublishedDayStore({ directory, clock: () => value });
    assert.deepEqual(await store.put(publication()), { state: "unavailable", reason: "invalid_clock" });
  }
  const throwing = api.createPublishedDayStore({ directory, clock: () => { throw new Error("private filesystem detail"); } });
  assert.deepEqual(await throwing.put(publication()), { state: "unavailable", reason: "invalid_clock" });
  const tiny = api.createPublishedDayStore({ directory, clock: () => NOW, maxTotalBytes: 1 });
  assert.deepEqual(await tiny.put(publication()), { state: "unavailable", reason: "quota_exceeded" });
  let now = NOW;
  const working = api.createPublishedDayStore({ directory, clock: () => now });
  const saved = await working.put(publication());
  now = NaN;
  assert.equal((await working.read(saved.snapshot.ref)).status, 404, "an invalid clock cannot turn expiration off");
});

test("hostile excessive namespaces fail boundedly without deleting unrelated entries", async (t) => {
  const { directory, store } = await fixture(t);
  const storage = path.join(directory, "published-days-v1");
  await fs.mkdir(storage, { mode: 0o700 });
  for (let start = 0; start < 4097; start += 64) {
    await Promise.all(Array.from({ length: Math.min(64, 4097 - start) }, (_, offset) => fs.writeFile(path.join(storage, `unrelated-${start + offset}`), "keep")));
  }
  const outcome = await store.put(publication());
  assert.equal(outcome.state, "unavailable");
  assert.equal(outcome.reason, "namespace_excessive");
  assert.equal((await fs.readdir(storage)).length, 4097);
  assert.equal(await fs.readFile(path.join(storage, "unrelated-0"), "utf8"), "keep");
});

test("abandoned exclusive temporaries count toward quotas while near-match names stay unrelated", async (t) => {
  const { directory, store } = await fixture(t, { maxEntries: 1 });
  const storage = path.join(directory, "published-days-v1");
  await fs.mkdir(storage, { mode: 0o700 });
  const temporary = path.join(storage, `.pending-${"d".repeat(48)}.tmp`);
  await fs.writeFile(temporary, "orphan", { mode: 0o600 });
  const denied = await store.put(publication());
  assert.equal(denied.state, "unavailable");
  assert.equal(denied.reason, "quota_exceeded");
  assert.equal(await fs.readFile(temporary, "utf8"), "orphan");
  const byteLimited = api.createPublishedDayStore({ directory, clock: () => NOW, maxTotalBytes: 1 });
  assert.deepEqual(await byteLimited.put(publication()), { state: "unavailable", reason: "quota_exceeded" });
  await fs.unlink(temporary); // Fixture-owned orphan only.
  const unrelated = `${"e".repeat(48)}.json\n`;
  await fs.writeFile(path.join(storage, unrelated), "keep");
  const saved = await store.put(publication());
  assert.equal(saved.state, "ready");
  assert.equal(await fs.readFile(path.join(storage, unrelated), "utf8"), "keep");
});

test("faulted commits, allocation collisions and missing disk records never become memory-only success", async (t) => {
  const { directory, store } = await fixture(t);
  const saved = await store.put(publication());
  const storage = path.join(directory, "published-days-v1");
  const originalFile = path.join(storage, `${saved.snapshot.ref}.json`);
  const originalBytes = await fs.readFile(originalFile);
  const link = fs.link;
  let temporarySeen = false;
  let temporaryMode;
  let finalsBeforeAllocation;
  const failLink = t.mock.method(fs, "link", async (from) => {
    temporarySeen = true;
    temporaryMode = (await fs.stat(from)).mode & 0o777;
    finalsBeforeAllocation = (await fs.readdir(storage)).filter(name => name.endsWith(".json")).length;
    const error = new Error("private storage detail"); error.code = "ENOSPC"; throw error;
  });
  assert.deepEqual(await store.put(publication()), { state: "unavailable", reason: "storage_unavailable" });
  failLink.mock.restore();
  assert.equal(temporarySeen, true);
  assert.equal(temporaryMode, 0o600);
  assert.equal(finalsBeforeAllocation, 1, "no new final exists before exclusive allocation");
  assert.equal((await fs.readdir(storage)).length, 1);
  assert.equal(Buffer.compare(await fs.readFile(originalFile), originalBytes), 0);
  assert.equal((await store.read(saved.snapshot.ref)).status, 200);
  // Force final allocation to collide with an issued file; real hard-link EEXIST must not replace it.
  const collide = t.mock.method(fs, "link", (from) => link(from, originalFile));
  assert.deepEqual(await store.put(publication()), { state: "unavailable", reason: "storage_unavailable" });
  collide.mock.restore();
  assert.equal(Buffer.compare(await fs.readFile(originalFile), originalBytes), 0);
  assert.equal((await fs.readdir(storage)).length, 1);
  await fs.unlink(originalFile);
  assert.equal((await store.read(saved.snapshot.ref)).status, 404);
});

test("exclusive temporary allocation never follows or removes a pre-existing symlink", async (t) => {
  const { directory, store } = await fixture(t);
  const victim = path.join(directory, "victim");
  await fs.writeFile(victim, "keep");
  const open = fs.open;
  let candidate;
  const inject = t.mock.method(fs, "open", async (target, ...args) => {
    if (typeof target === "string" && target.includes("/.pending-")) {
      candidate = path.basename(target);
      await fs.symlink(victim, target);
    }
    return open(target, ...args);
  });
  const outcome = await store.put(publication());
  inject.mock.restore();
  assert.deepEqual(outcome, { state: "unavailable", reason: "storage_unavailable" });
  assert.equal(await fs.readFile(victim, "utf8"), "keep");
  assert.equal((await fs.lstat(path.join(directory, "published-days-v1", candidate))).isSymbolicLink(), true);
});

test("parallel byte-limited puts keep both physical quota and every issued link", async (t) => {
  const { directory, store } = await fixture(t);
  const first = await store.put(publication());
  const storage = path.join(directory, "published-days-v1");
  const size = (await fs.stat(path.join(storage, `${first.snapshot.ref}.json`))).size;
  const bounded = api.createPublishedDayStore({ directory, clock: () => NOW, maxTotalBytes: size * 3 });
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => bounded.put(publication())));
  assert.equal(outcomes.filter(outcome => outcome.state === "ready").length, 2);
  assert.equal(outcomes.filter(outcome => outcome.reason === "quota_exceeded").length, 6);
  const files = await fs.readdir(storage);
  const sizes = await Promise.all(files.map(file => fs.lstat(path.join(storage, file))));
  assert.equal(sizes.reduce((sum, stat) => sum + stat.size, 0), size * 3);
  assert.equal((await bounded.read(first.snapshot.ref)).status, 200);
  for (const saved of outcomes.filter(outcome => outcome.state === "ready")) assert.equal((await bounded.read(saved.snapshot.ref)).status, 200);
});

test("JSON structural budgets reject whole entries while ordinary null-prototype JSON stays lossless", async (t) => {
  const { directory, store } = await fixture(t);
  const input = publication();
  let nested = {};
  for (let index = 0; index < 65; index += 1) nested = { nested };
  input.result.extra = nested;
  assert.deepEqual(await store.put(input), { state: "unavailable", reason: "invalid_publication" });
  input.result.extra = Array(100000).fill(0);
  assert.deepEqual(await store.put(input), { state: "unavailable", reason: "invalid_publication" });
  input.result.extra = "é".repeat(1024 * 1024);
  assert.deepEqual(await store.put(input), { state: "unavailable", reason: "entry_too_large" });
  assert.deepEqual(await fs.readdir(directory), [], "invalid entries must not leave partial records");
  const intent = Object.assign(Object.create(null), { date: "2026-10-25" });
  const result = Object.assign(Object.create(null), { days: [{ date: "2026-10-25" }], values: [null, true, false, 0, "", { preserved: "é" }] });
  const safe = { intent, result };
  Object.defineProperty(safe, "ref", { get() { throw new Error("ignored metadata must not be read"); } });
  Object.freeze(intent); Object.freeze(result); Object.freeze(safe);
  const saved = await store.put(safe);
  assert.equal(saved.state, "ready");
  const read = await store.read(saved.snapshot.ref);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.result.values, [null, true, false, 0, "", { preserved: "é" }]);
});

test("unsafe permissions, hard links and non-files stay unavailable and retain disk quota", async (t) => {
  const { directory, store } = await fixture(t, { maxEntries: 1 });
  const saved = await store.put(publication());
  const storage = path.join(directory, "published-days-v1");
  const record = path.join(storage, `${saved.snapshot.ref}.json`);
  await fs.chmod(record, 0o644);
  assert.equal((await store.read(saved.snapshot.ref)).status, 404);
  assert.deepEqual(await store.put(publication()), { state: "unavailable", reason: "quota_exceeded" });
  await fs.chmod(record, 0o600);
  await fs.link(record, path.join(directory, "outside-hard-link"));
  assert.equal((await store.read(saved.snapshot.ref)).status, 404);
  await fs.unlink(path.join(directory, "outside-hard-link"));
  assert.equal((await store.read(saved.snapshot.ref)).status, 200);
  await fs.chmod(storage, 0o755);
  assert.equal((await store.read(saved.snapshot.ref)).status, 404);
  assert.deepEqual(await store.put(publication()), { state: "unavailable", reason: "storage_unavailable" });
  await fs.chmod(storage, 0o700);
  await fs.unlink(record);
  await fs.mkdir(record);
  assert.equal((await store.read(saved.snapshot.ref)).status, 404);
  assert.deepEqual(await store.put(publication()), { state: "unavailable", reason: "quota_exceeded" });
});

// Avoid a missing-module setup error being mistaken for a behavior RED.
test("the CommonJS module exposes the two required functions", () => {
  assert.equal(typeof api?.createPublishedDayStore, "function");
  assert.equal(typeof api?.validPublishedDayRef, "function");
  assert.deepEqual(Object.keys(api).sort(), ["createPublishedDayStore", "validPublishedDayRef"]);
});
