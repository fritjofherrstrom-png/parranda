'use strict';

const { types: { isProxy, isPromise } } = require('node:util');
const nativeThen = Promise.prototype.then;

// Internal source authority, never a public request permission or record flag.
const PUBLIC_SOURCE_URL_POLICY_VERSION = 'wikidata-entity-v1';
const witnesses = new WeakMap();
const MAX_WIKIDATA_RECORDS = 60; // The configured source's existing MAX_LIMIT.
const MAX_CONTEXT_RECORDS = 4096; // Combined source context; refuse, never truncate.

function safeObject(value) {
  return value !== null && typeof value === 'object' && !isProxy(value);
}

function ownData(object, key) {
  if (!safeObject(object)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

// Do not invoke caller iterators, array index getters or Proxy reflection traps.
// Preflight every slot before issuing/returning any evidence for this array.
function safeArrayValues(array, limit) {
  if (!safeObject(array) || !Array.isArray(array) || Object.getPrototypeOf(array) !== Array.prototype ||
      Object.getOwnPropertyDescriptor(array, Symbol.iterator)) return null;
  const length = ownData(array, 'length');
  if (!Number.isInteger(length) || length < 0 || length > limit) return null;
  const values = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(array, index);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || isProxy(descriptor.value)) return null;
    values.push(descriptor.value);
  }
  return values;
}

function canonicalDestination(record) {
  const id = ownData(record, 'id');
  if (typeof id !== 'string' || id.length > 30) return null;
  const match = /^wikidata-(Q[1-9][0-9]{0,19})$/.exec(id);
  if (!match || match[0] !== id) return null;
  const sourceArray = ownData(record, 'sources');
  const sources = safeArrayValues(sourceArray, 1);
  if (!sources || sources.length !== 1) return null;
  const source = sources[0];
  const url = `https://www.wikidata.org/wiki/${match[1]}`;
  return ownData(source, 'provider') === 'wikidata' && ownData(source, 'family') === 'open_knowledge' &&
    ownData(source, 'url') === url ? { id, sourceArray, source, url } : null;
}

function attestWikidataRecords(records) {
  const values = safeArrayValues(records, MAX_WIKIDATA_RECORDS);
  if (!values) return records;
  for (const record of values) {
    const destination = canonicalDestination(record);
    if (destination) witnesses.set(record, { version: PUBLIC_SOURCE_URL_POLICY_VERSION, ...destination });
  }
  return records;
}

function publicSourceUrlsForRecords(records) {
  const urls = new Set();
  const values = safeArrayValues(records, MAX_CONTEXT_RECORDS);
  if (!values) return urls;
  for (const record of values) {
    const witness = witnesses.get(record);
    if (witness?.version !== PUBLIC_SOURCE_URL_POLICY_VERSION) continue;
    const current = canonicalDestination(record);
    if (current && current.id === witness.id && current.url === witness.url &&
        current.sourceArray === witness.sourceArray && current.source === witness.source) urls.add(witness.url);
  }
  return urls;
}

function createWikidataAttestingCache(cache, expectedNamespace) {
  if (expectedNamespace !== 'wikidata-v2-lifecycle' || ownData(cache, 'namespace') !== expectedNamespace) return cache;
  const get = ownData(cache, 'get');
  const peek = ownData(cache, 'peek');
  if (typeof get !== 'function' || isProxy(get) || typeof peek !== 'function' || isProxy(peek)) return cache;
  // Inherit the existing API and opaque metadata without evaluating accessors
  // or enumerating an unbounded object. Only these two read paths add proof.
  return Object.create(cache, {
    get: { enumerable: true, value: function (...args) {
      const result = Reflect.apply(ownData(cache, 'get'), cache, args);
      // Real source-cache.get is an async function returning a native Promise.
      // Never invoke an arbitrary thenable, Proxy or species/constructor hook
      // merely to add evidence; leave unsupported return protocols untouched.
      if (safeObject(result) && isPromise(result) && Object.getPrototypeOf(result) === Promise.prototype &&
          !Object.getOwnPropertyDescriptor(result, 'constructor')) {
        // Register before downstream consumers, but keep the original Promise.
        // Returning void avoids assimilating the source value a second time.
        nativeThen.call(result, value => { attestWikidataRecords(value); }, () => {});
      }
      return result;
    } },
    peek: { enumerable: true, value: function (...args) {
      return attestWikidataRecords(Reflect.apply(ownData(cache, 'peek'), cache, args));
    } },
  });
}

module.exports = { PUBLIC_SOURCE_URL_POLICY_VERSION, attestWikidataRecords, createWikidataAttestingCache, publicSourceUrlsForRecords };
