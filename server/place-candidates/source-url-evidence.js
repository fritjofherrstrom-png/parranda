'use strict';

const { types: { isProxy, isPromise } } = require('node:util');
const nativeThen = Promise.prototype.then;
const { isPublicSourceDestination } = require('../lib/public-source-destination');
const placeWitnesses = new WeakMap();

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

// Only actual provider factories and their owned cache reads issue these
// witnesses. No published/request URL bag or JSON copy acquires authority.
function placeDestinations(record, provider) {
  const id = ownData(record, 'id');
  const sourceArray = ownData(record, 'sources');
  const sources = safeArrayValues(sourceArray, 8);
  if (typeof id !== 'string' || !sources?.length) return null;
  if (provider === 'wikidata' && !canonicalDestination(record)) return null;
  if (provider === 'osm') {
    const match = /^osm-(node|way|relation)-([1-9][0-9]*)$/.exec(id);
    if (!match || ownData(sources[0], 'provider') !== 'osm' ||
        ownData(sources[0], 'url') !== `https://www.openstreetmap.org/${match[1]}/${match[2]}` ||
        sources.slice(1).some(source => ownData(source, 'provider') !== 'wikidata' ||
          !/^https:\/\/www\.wikidata\.org\/wiki\/Q[1-9][0-9]*$/.test(ownData(source, 'url')))) return null;
  } else if (provider === 'overture') {
    if (!/^overture-[0-9a-f-]{20,64}$/i.test(id) || sources.length !== 1 ||
        ownData(sources[0], 'provider') !== 'overture' || ownData(sources[0], 'url') !== 'https://overturemaps.org/') return null;
  } else if (provider !== 'wikidata') return null;
  const sourceUrls = sources.map(source => ownData(source, 'url'));
  if (sourceUrls.some(url => !isPublicSourceDestination(url))) return null;
  const website = ownData(record, 'website');
  return { id, sourceArray, sources, sourceUrls, website,
    urls: [...sourceUrls, ...(isPublicSourceDestination(website) ? [website] : [])] };
}
function attestPublicPlaceRecords(records, provider) {
  const values = safeArrayValues(records, MAX_CONTEXT_RECORDS);
  if (!values) return records;
  for (const record of values) {
    const destination = placeDestinations(record, provider);
    if (destination) placeWitnesses.set(record, { provider, ...destination });
  }
  return records;
}
function attestWikidataRecords(records) {
  const values = safeArrayValues(records, MAX_WIKIDATA_RECORDS);
  if (!values) return records;
  for (const record of values) {
    const destination = canonicalDestination(record);
    if (destination) witnesses.set(record, { version: PUBLIC_SOURCE_URL_POLICY_VERSION, ...destination });
  }
  return attestPublicPlaceRecords(records, 'wikidata');
}

function publicSourceUrlsForRecords(records) {
  const urls = new Set();
  const values = safeArrayValues(records, MAX_CONTEXT_RECORDS);
  if (!values) return urls;
  for (const record of values) {
    const place = placeWitnesses.get(record);
    if (place) {
      const current = placeDestinations(record, place.provider);
      if (current && current.id === place.id && current.sourceArray === place.sourceArray &&
          current.website === place.website && current.sources.every((source, i) => source === place.sources[i] &&
            current.sourceUrls[i] === place.sourceUrls[i])) {
        for (const url of current.urls) urls.add(url);
      }
    }
    const witness = witnesses.get(record);
    if (witness?.version !== PUBLIC_SOURCE_URL_POLICY_VERSION) continue;
    const current = canonicalDestination(record);
    if (current && current.id === witness.id && current.url === witness.url &&
        current.sourceArray === witness.sourceArray && current.source === witness.source) urls.add(witness.url);
  }
  return urls;
}

function createAttestingCache(cache, expectedNamespace, attest) {
  if (!cache || ownData(cache, 'namespace') !== expectedNamespace) return cache;
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
        nativeThen.call(result, value => { attest(value); }, () => {});
      }
      return result;
    } },
    peek: { enumerable: true, value: function (...args) {
      return attest(Reflect.apply(ownData(cache, 'peek'), cache, args));
    } },
  });
}

function createWikidataAttestingCache(cache, namespace) {
  return namespace === 'wikidata-v2-lifecycle' ? createAttestingCache(cache, namespace, attestWikidataRecords) : cache;
}
function createOsmAttestingCache(cache) {
  return createAttestingCache(cache, 'overpass', records => attestPublicPlaceRecords(records, 'osm'));
}
module.exports = { attestPublicPlaceRecords, createOsmAttestingCache, PUBLIC_SOURCE_URL_POLICY_VERSION, attestWikidataRecords, createWikidataAttestingCache, publicSourceUrlsForRecords };
