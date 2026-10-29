"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { isProxy } = require("node:util").types;
const writers = new Map();

class StoreError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

function reject(reason) {
  throw new StoreError(reason);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function copyJson(value, maxBytes) {
  const active = new Set();
  let bytes = 0;
  let nodes = 0;
  function charge(size) {
    bytes += size;
    if (bytes > maxBytes) reject("entry_too_large");
  }
  function copy(item, depth) {
    if (++nodes > 100000 || depth > 64) reject("invalid_publication");
    if (item === null || typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) {
      if (typeof item === "string" && Buffer.byteLength(item) > maxBytes) reject("entry_too_large");
      charge(Buffer.byteLength(JSON.stringify(item)));
      return item;
    }
    if (!item || typeof item !== "object" || isProxy(item) || active.has(item)) reject("invalid_publication");
    const array = Array.isArray(item);
    if (array ? Object.getPrototypeOf(item) !== Array.prototype : !isPlainObject(item)) reject("invalid_publication");
    const keys = Reflect.ownKeys(item);
    if (keys.length > 100000 - nodes + (array ? 1 : 0)) reject("invalid_publication");
    if (array && keys.length !== Object.getOwnPropertyDescriptor(item, "length").value + 1) reject("invalid_publication");
    const output = array ? [] : {};
    active.add(item);
    charge(2);
    let index = 0;
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") || (array && key !== String(index))) reject("invalid_publication");
      if (index++) charge(1);
      if (!array) {
        if (Buffer.byteLength(key) > maxBytes) reject("entry_too_large");
        charge(Buffer.byteLength(JSON.stringify(key)) + 1);
      }
      Object.defineProperty(output, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    active.delete(item);
    return output;
  }
  return copy(value, 0);
}

function copyPublication(input, maxBytes) {
  if (!isPlainObject(input)) reject("invalid_publication");
  function field(key, fallback) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor) return fallback;
    if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable) reject("invalid_publication");
    return descriptor.value === undefined ? fallback : descriptor.value;
  }
  const intent = field("intent");
  const result = field("result");
  const language = field("language", "en");
  if (!isPlainObject(intent) || !isPlainObject(result) || typeof language !== "string" || language.length === 0 || Buffer.byteLength(language) > 64) reject("invalid_publication");
  const copied = { language, intent: copyJson(intent, maxBytes), result: copyJson(result, maxBytes) };
  validateDates(copied.intent, copied.result);
  return copied;
}

function validateDates(intent, result) {
  let selected;
  function bind(value) {
    if (typeof value !== "string" || value.length !== 10 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith("0000-")) reject("invalid_publication");
    const epoch = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value || (selected !== undefined && selected !== value)) reject("invalid_publication");
    selected = value;
  }
  for (const object of [intent, result]) {
    for (const key of ["date", "selected_date", "selectedDate", "requested_date"]) if (Object.hasOwn(object, key)) bind(object[key]);
  }
  if (Object.hasOwn(result, "days")) {
    if (!Array.isArray(result.days)) reject("invalid_publication");
    for (const day of result.days) {
      if (!isPlainObject(day)) reject("invalid_publication");
      if (Object.hasOwn(day, "date")) bind(day.date);
    }
  }
}

function serialize(directory, work) {
  const next = (writers.get(directory) || Promise.resolve()).then(work);
  const tail = next.then(() => {}, () => {});
  writers.set(directory, tail);
  void tail.then(() => { if (writers.get(directory) === tail) writers.delete(directory); });
  return next;
}

/**
 * Validate an unlisted read capability literally, without coercion or repair.
 * @param {*} value
 * @returns {boolean} True only for exactly 48 lowercase hexadecimal characters.
 */
function validPublishedDayRef(value) {
  return typeof value === "string" && value.length === 48 && /^[a-f0-9]{48}$/.test(value);
}

function freezeJson(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function validateEnvelope(body, ref, maxBytes) {
  const keys = ["version", "ref", "created_at", "expires_at", "language", "intent", "result"];
  if (!isPlainObject(body) || Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key)) || body.version !== 1 || !validPublishedDayRef(body.ref) || body.ref !== ref) reject("invalid_publication");
  for (const timestamp of [body.created_at, body.expires_at]) {
    if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) reject("invalid_publication");
  }
  if (Date.parse(body.expires_at) <= Date.parse(body.created_at)) reject("invalid_publication");
  copyPublication(body, maxBytes);
}

const { constants: FS } = require("node:fs");
const DIR_FLAGS = FS.O_RDONLY | FS.O_DIRECTORY | FS.O_NOFOLLOW;
const READ_FLAGS = FS.O_RDONLY | FS.O_NOFOLLOW | FS.O_NONBLOCK;
const CREATE_FLAGS = FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW;
const anchor = handle => `/proc/self/fd/${handle.fd}`;
const unavailableRead = () => ({ status: 404, body: { error: "day_snapshot_unavailable" } });
const MAX_NAMESPACE_ENTRIES = 4096;

async function boundedNames(storage) {
  const names = [];
  const directory = await fs.opendir(anchor(storage));
  for await (const entry of directory) {
    if (names.length === MAX_NAMESPACE_ENTRIES) reject("namespace_excessive");
    names.push(entry.name);
  }
  return names;
}

function finalRef(name) {
  const ref = name.slice(0, -5);
  return name.endsWith(".json") && validPublishedDayRef(ref) ? ref : null;
}

function ownedTemporary(name) {
  return name.startsWith(".pending-") && name.endsWith(".tmp") && validPublishedDayRef(name.slice(".pending-".length, -4));
}

// Linux descriptor-relative paths pin each opened directory against path swaps.
async function openStorage(directory, create) {
  let current = await fs.open(path.parse(directory).root, DIR_FLAGS);
  try {
    for (const component of directory.split(path.sep).filter(Boolean)) {
      const previous = current;
      current = await fs.open(`${anchor(previous)}/${component}`, DIR_FLAGS);
      await previous.close();
    }
    if (create) {
      await fs.mkdir(`${anchor(current)}/published-days-v1`, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
      await current.sync();
    }
    const storage = await fs.open(`${anchor(current)}/published-days-v1`, DIR_FLAGS);
    try {
      const stat = await storage.stat();
      if ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) reject("storage_unavailable");
      return storage;
    } catch (error) {
      await storage.close();
      throw error;
    }
  } finally {
    await current.close();
  }
}

async function loadRecord(storage, ref, maxBytes) {
  const handle = await fs.open(`${anchor(storage)}/${ref}.json`, READ_FLAGS);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid() || stat.size < 1 || stat.size > maxBytes) reject("invalid_publication");
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== stat.size || (await handle.stat()).size !== stat.size) reject("invalid_publication");
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset)));
    validateEnvelope(body, ref, maxBytes);
    return { body, stat };
  } finally {
    await handle.close();
  }
}

async function removeRecord(storage, name, expected) {
  const target = `${anchor(storage)}/${name}`;
  const current = await fs.lstat(target);
  if (!current.isFile() || current.dev !== expected.dev || current.ino !== expected.ino) reject("storage_unavailable");
  await fs.unlink(target);
}

function resolveConfig(options) {
  if (!isPlainObject(options)) reject("invalid_config");
  const defaults = { clock: () => Date.now(), ttlMs: 7 * 24 * 60 * 60 * 1000, maxEntries: 256, maxTotalBytes: 64 * 1024 * 1024, maxEntryBytes: 1024 * 1024 };
  const config = {};
  for (const key of ["directory", ...Object.keys(defaults)]) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (descriptor && !Object.hasOwn(descriptor, "value")) reject("invalid_config");
    config[key] = descriptor?.value === undefined ? defaults[key] : descriptor.value;
  }
  if (typeof config.directory !== "string" || config.directory.length === 0 || config.directory.includes("\0") || typeof config.clock !== "function" || isProxy(config.clock)) reject("invalid_config");
  for (const key of ["ttlMs", "maxEntries", "maxTotalBytes", "maxEntryBytes"]) {
    if (!Number.isSafeInteger(config[key]) || config[key] <= 0) reject("invalid_config");
  }
  return config;
}

function clockMs(clock, ttlMs = 0) {
  try {
    const now = clock();
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(now + ttlMs) || !Number.isFinite(new Date(now).getTime()) || !Number.isFinite(new Date(now + ttlMs).getTime())) reject("invalid_clock");
    return now;
  } catch {
    reject("invalid_clock");
  }
}

/**
 * A bounded Linux filesystem store for SERVER-OWNED, already-projected days.
 * This is not a source/privacy projector and must not receive a public request
 * body. It performs no acquisition, network access, background work or logging.
 *
 * `directory` is the caller's EXISTING cache root. The store creates only its
 * private `published-days-v1` child (0700), never the root. Configured components
 * are opened without following symlinks; operations are pinned to directory file
 * descriptors via Linux /proc/self/fd. Records are 0600. The cache root must
 * remain service-controlled and stable. Filesystem hard links and directory
 * fsync must be supported; unsupported/unavailable storage fails closed.
 *
 * put({intent, result, language='en'}) copies its arguments synchronously, then
 * mints randomBytes(24).toString('hex') internally. Caller ref/version/timestamps
 * and all other top-level metadata are ignored, never read or mutated. Intent
 * and result must be plain JSON objects (Object.prototype or null prototype),
 * with dense ordinary arrays, finite JSON scalars and enumerable data fields.
 * Accessors, proxies, custom prototypes, cycles and non-JSON values are rejected,
 * never invoked or silently truncated. Each payload permits depth <=64 and
 * <=100000 values. Language must be a nonempty string of <=64 UTF-8 bytes.
 * Selected-date aliases (date, selected_date, selectedDate, requested_date) on
 * intent/result and result.days[*].date, when present, must be real YYYY-MM-DD
 * calendar days (years 0001..9999) and all agree. No dates are inferred.
 *
 * put resolves {state:'ready', snapshot:{version:1,ref,created_at,expires_at}}
 * ONLY after an exclusive temporary write, file fsync, exclusive hard-link final
 * allocation, temporary unlink and directory fsync. It otherwise resolves
 * {state:'unavailable', reason}, where reason is one of: invalid_config,
 * invalid_clock, invalid_publication, entry_too_large, quota_exceeded,
 * namespace_excessive, storage_unavailable. Collisions never replace a record.
 * A post-allocation I/O failure may leave an unissued final consuming quota.
 *
 * Disk/read envelopes are exactly {version:1,ref,created_at,expires_at,language,
 * intent,result}. Timestamp strings are canonical Date.toISOString() values;
 * expiry must be later than creation. read(ref) resolves {status:200,body} with
 * a fresh deeply frozen envelope, 400/{error:'invalid_day_snapshot_ref'} for a
 * malformed ref, 404/{error:'day_snapshot_unavailable'} for absent/corrupt/
 * unsupported/oversized/unreadable data, or 410/{error:'day_snapshot_expired'}
 * for a still-present expired record. Expired records are physically removed
 * when possible; subsequent reads may therefore be 404. Reads never renew TTL.
 *
 * Serialized operations support ONE web-writer process using the same resolved
 * cache-root path; there is no cross-process/mount-alias coordination or lock
 * stealing. Every put rescans disk, so final count/bytes survive restarts.
 * Corrupt owned finals and abandoned .pending-<ref>.tmp files consume quotas;
 * only valid expired finals are removed, never unexpired or unrelated entries.
 * At most 4096 namespace entries are scanned; excess fails closed before any
 * cleanup. Unrelated files count toward this scan bound but not owned quotas.
 * Abandoned temporaries/corruption may require operator cleanup. There is no
 * memory cache, fallback, TTL renewal, timer, process or listener.
 *
 * Numeric options are positive safe integers, without coercion or clamping.
 * Entry bytes include the complete UTF-8 envelope; aggregate bytes count all
 * owned disk entries conservatively, including hard links. The smaller bound
 * always governs; maxEntryBytes > maxTotalBytes never raises the total cap.
 *
 * @param {object} options
 * @param {string} options.directory Existing cache root, not the namespace child.
 * @param {function(): number} [options.clock=Date.now] Epoch MILLISECONDS as a
 *   safe integer, not a Date/string. Throwing/invalid clocks fail closed.
 * @param {number} [options.ttlMs=604800000] Absolute lifetime from creation.
 * @param {number} [options.maxEntries=256] Owned finals and abandoned temporaries.
 * @param {number} [options.maxTotalBytes=67108864] Aggregate owned disk bytes.
 * @param {number} [options.maxEntryBytes=1048576] Full serialized envelope bytes.
 * @returns {{put: function(object): Promise<object>, read: function(*): Promise<object>}}
 */
function createPublishedDayStore(options = {}) {
  let config;
  try { config = resolveConfig(options); } catch {
    return {
      async put() { return { state: "unavailable", reason: "invalid_config" }; },
      async read(ref) { return validPublishedDayRef(ref) ? unavailableRead() : { status: 400, body: { error: "invalid_day_snapshot_ref" } }; },
    };
  }
  const { directory, clock, ttlMs, maxEntryBytes, maxEntries, maxTotalBytes } = config;
  const root = path.resolve(directory);
  async function persist(copied) {
    let storage;
    let temporary;
    try {
      const ref = randomBytes(24).toString("hex");
      const now = clockMs(clock, ttlMs);
      const snapshot = { version: 1, ref, created_at: new Date(now).toISOString(), expires_at: new Date(now + ttlMs).toISOString() };
      const bytes = JSON.stringify({ ...snapshot, ...copied });
      if (Buffer.byteLength(bytes) > maxEntryBytes) return { state: "unavailable", reason: "entry_too_large" };
      storage = await openStorage(root, true);
      const names = await boundedNames(storage);
      let count = 0;
      let totalBytes = 0n;
      let removed = 0;
      for (const name of names) {
        const existingRef = finalRef(name);
        if (!existingRef && !ownedTemporary(name)) continue;
        const stat = await fs.lstat(`${anchor(storage)}/${name}`);
        let loaded;
        if (existingRef) {
          try { loaded = await loadRecord(storage, existingRef, maxEntryBytes); } catch {}
        }
        if (loaded && Date.parse(loaded.body.expires_at) <= now) {
          await removeRecord(storage, name, loaded.stat);
          removed += 1;
          continue;
        }
        count += 1;
        if (!Number.isSafeInteger(stat.size)) reject("storage_unavailable");
        totalBytes += BigInt(stat.size);
      }
      if (count >= maxEntries || totalBytes + BigInt(Buffer.byteLength(bytes)) > BigInt(maxTotalBytes)) return { state: "unavailable", reason: "quota_exceeded" };
      if (names.length - removed >= MAX_NAMESPACE_ENTRIES) reject("namespace_excessive");
      const candidate = `${anchor(storage)}/.pending-${ref}.tmp`;
      const handle = await fs.open(candidate, CREATE_FLAGS, 0o600);
      temporary = candidate; // Only clean up a temporary that this invocation created.
      try {
        await handle.chmod(0o600);
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.link(temporary, `${anchor(storage)}/${ref}.json`);
      await fs.unlink(temporary);
      temporary = undefined;
      await storage.sync();
      return { state: "ready", snapshot };
    } catch (error) {
      return { state: "unavailable", reason: error instanceof StoreError ? error.reason : "storage_unavailable" };
    } finally {
      if (temporary) await fs.unlink(temporary).catch(() => {});
      if (storage) await storage.close().catch(() => {});
    }
  }
  async function read(ref) {
    if (!validPublishedDayRef(ref)) return { status: 400, body: { error: "invalid_day_snapshot_ref" } };
    return serialize(root, async () => {
      let storage;
      try {
        const now = clockMs(clock);
        storage = await openStorage(root, false);
        const loaded = await loadRecord(storage, ref, maxEntryBytes);
        if (Date.parse(loaded.body.expires_at) <= now) {
          await removeRecord(storage, `${ref}.json`, loaded.stat).catch(() => {});
          return { status: 410, body: { error: "day_snapshot_expired" } };
        }
        return { status: 200, body: freezeJson(loaded.body) };
      } catch {
        return unavailableRead();
      } finally {
        if (storage) await storage.close().catch(() => {});
      }
    });
  }
  return {
    async put(publication) {
      let copied;
      try { copied = copyPublication(publication, maxEntryBytes); }
      catch (error) { return { state: "unavailable", reason: error instanceof StoreError ? error.reason : "invalid_publication" }; }
      return serialize(root, () => persist(copied));
    },
    read,
  };
}

module.exports = { createPublishedDayStore, validPublishedDayRef };
