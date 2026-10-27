'use strict';

// Policy wix-public-event-catalog-v1, revision 1. Application-owned closed
// declaration, independently approved from unchanged wikidata-entity-v1.
// Syntax is never authority: only a bound collector's actual public catalog and
// exact completed detail response can create the private raw-record witness.
const { createHash } = require('node:crypto');
const { types: { isProxy, isPromise } } = require('node:util');
const { isPublicSourceDestination: publicEventDestination } = require('../lib/public-source-destination');
const NativePromise = Promise;
const nativePromisePrototype = Promise.prototype;
const nativeThen = Promise.prototype.then;
const nativeSpecies = Object.getOwnPropertyDescriptor(Promise, Symbol.species);
const ROOT = 'https://www.visitystadosterlen.se/sitemap.xml';
const FEED = 'visit-ystad-osterlen-calendar';
const INPUTS = '_live_destination_inputs';
const MAX_CLAIMS = 512;
const MAX_INPUT_BYTES = 128 * 1024;
const configurations = new WeakMap();
const originalLocs = new WeakMap();
const sitemapDocuments = new WeakMap();
const factories = new WeakMap();
const publicFactories = new WeakMap();
const details = new WeakMap();
const frames = new WeakMap();
const issuedWitnesses = new WeakMap();
const terminalWitnesses = new WeakMap();
const ownedCaches = new WeakSet();
const hash = value => createHash('sha256').update(value).digest('hex');
const claimHash = (...parts) => hash(JSON.stringify(parts));

// Approved general sharing contract: carry already-public event output from
// the actual configured structured provider. This grants no event/route trust
// and never authorizes URLs merely found in the final publication or an upload.
const PUBLIC_EVENT_ADAPTERS = new Set(['linked_events', 'localized_events_api',
  'tourism_listing', 'ckan_agenda', 'datatourisme', 'public_holidays',
  'osm_market_schedules', 'schema_org', 'schema_org_html', 'rss_atom_event_detail', 'sitevision_calendar',
  'html_venue_calendar', 'events_calendar', 'mapped_events', 'ical',
  'scheduled_event_cards', 'embedded_program_rsc', 'official_program_article']);
function data(object, key) {
  if (!object || typeof object !== 'object' || isProxy(object)) return undefined;
  return Object.getOwnPropertyDescriptor(object, key)?.value;
}
function publicProviderSource(source) {
  return configurations.has(source) && PUBLIC_EVENT_ADAPTERS.has(source.adapter) ||
    source?.kind === 'global' && source.id === 'ticketmaster-global' && source.source_identity === 'ticketmaster.com';
}
function bindConfiguredPublicProvider(provider, source) {
  if (provider && publicProviderSource(source)) publicFactories.set(provider, fingerprint(source));
  return provider;
}
function attestPublicProviderOutput(provider, source, result) {
  const sourceHash = fingerprint(source);
  if (!sourceHash || publicFactories.get(provider) !== sourceHash) return result;
  const rows = data(result, 'time_sensitive_events');
  if (!Array.isArray(rows) || isProxy(rows) || rows.length > MAX_CLAIMS) return result;
  for (let i = 0; i < rows.length; i++) {
    const row = data(rows, String(i));
    const loc = data(row, 'source_url') || data(row, 'url');
    const id = data(row, 'id') || data(row, 'source_event_id') || data(row, 'provider_id') || loc;
    if (publicEventDestination(loc) && typeof id === 'string' && id.length <= 1000 && id === id.trim())
      details.set(row, Object.freeze({ kind: 'public_event_output_v1', source: sourceHash, loc, id, source_url: loc }));
  }
  return result;
}

function eventDestination(value) {
  if (typeof value !== 'string' || value.length > 1000) return false;
  const match = /^https:\/\/www\.visitystadosterlen\.se\/evenemang-1\/([^/]+)\/([1-9][0-9]{0,19})$/.exec(value);
  if (!match || match[1].length > 700) return false;
  try {
    const slug = decodeURIComponent(match[1]);
    return /^[\p{L}\p{N}][\p{L}\p{N}\p{M}-]*$/u.test(slug) && encodeURIComponent(slug) === match[1];
  } catch (_) { return false; }
}
function childDestination(value) {
  return typeof value === 'string' && /^https:\/\/www\.visitystadosterlen\.se\/dynamic-evenemang-1_[A-Za-z0-9_-]{1,160}-sitemap\.xml$/.test(value);
}
function rememberConfiguredEventSource(original, normalized) {
  configurations.set(normalized, { original: fingerprint(original), literal: original?.id === FEED &&
    original.adapter === 'wix_event_sitemap' && original.endpoint === ROOT &&
    (original.base == null || original.base === ROOT) && original.source_identity === 'visitystadosterlen.se' &&
    original.event_path_prefix === '/evenemang-1/' });
  return normalized;
}
function bindSelectedEventSource(selected, configured) {
  const binding = configurations.get(configured);
  if (binding) configurations.set(selected, binding);
  return selected;
}
function rememberWixSitemapLoc(row, original) { originalLocs.set(row, original); return row; }
function rememberWixSitemapDocument(document, rows) { sitemapDocuments.set(document, rows); return document; }
function declared(source) {
  return configurations.get(source)?.literal === true && /^[a-f0-9]{64}$/.test(configurations.get(source)?.original) && source?.id === FEED && source.adapter === 'wix_event_sitemap' &&
    source.endpoint === ROOT && source.base === ROOT &&
    source.source_identity === 'visitystadosterlen.se' && source.event_path_prefix === '/evenemang-1/';
}
function fingerprint(source) {
  // Complete selected JSON configuration plus its original configured row.
  // Reject non-JSON aliases/accessors rather than expanding a DAG to hash it.
  try {
    const bounded = require('../planner/live-route-upgrade').retainComposition(source);
    if (!bounded) return null;
    const seen = new Set();
    let bytes = 0;
    const canonical = value => {
      if (typeof value === 'string') {
        bytes += Buffer.byteLength(value) + 8;
        if (bytes > MAX_INPUT_BYTES) throw new Error('source_configuration_bound');
        return value;
      }
      if (!value || typeof value !== 'object') return value;
      if (seen.has(value)) throw new Error('source_configuration_alias');
      seen.add(value);
      bytes += Reflect.ownKeys(value).length * 16;
      if (bytes > MAX_INPUT_BYTES) throw new Error('source_configuration_bound');
      return Array.isArray(value) ? value.map(canonical)
        : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    };
    return hash(JSON.stringify([canonical(bounded), configurations.get(source)?.original || null]));
  } catch (_) { return null; }
}
function bindConfiguredWixProvider(provider, source) {
  if (declared(source)) factories.set(provider, fingerprint(source));
  return provider;
}
function literalLoc(xml, loc, kind) {
  if (typeof xml !== 'string' || /<!/.test(xml)) return false;
  // A conservative source-specific XML envelope, not an HTML/comment substring.
  // Unsupported XML constructs stay ordinary Live data but cannot mint proof.
  const document = /^(?:<\?xml\s[^?]*\?>\s*)?<(sitemapindex|urlset)(\s[^>]*)?>([\s\S]*)<\/\1>$/.exec(xml.trim());
  if (!document || document[1] !== (kind === 'index' ? 'sitemapindex' : 'urlset')) return false;
  const attributes = document[2] || '';
  let end = 0, wix = false;
  const names = new Set();
  for (const match of attributes.matchAll(/\s+([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*("[^"<]*"|'[^'<]*')/g)) {
    if (attributes.slice(end, match.index).trim() || names.has(match[1])) return false;
    names.add(match[1]); end = match.index + match[0].length;
    if (match[1] === 'generatedBy' && match[2].slice(1,-1) === 'WIX') wix = true;
  }
  if (!wix || attributes.slice(end).trim()) return false;
  const tag = kind === 'index' ? 'sitemap' : 'url';
  const pattern = new RegExp(`<${tag}>\\s*<loc>([^<]*)<\\/loc>(?:\\s*<(lastmod|changefreq|priority)>[^<]*<\\/\\2>)*\\s*<\\/${tag}>`, 'g');
  end = 0; let found = false;
  for (const match of document[3].matchAll(pattern)) {
    if (document[3].slice(end, match.index).trim()) return false;
    end = match.index + match[0].length;
    if (match[1] === loc) found = true;
  }
  return found && !document[3].slice(end).trim();
}
function beginWixCatalogCollection(provider, rootResponse, root) {
  const source = factories.get(provider);
  if (!source || rootResponse?.originalResponseUrl !== ROOT) return null;
  // Reuse bounded acquisition arrays, rather than allocating an authority map
  // for every catalog page. Only actually selected detail records get a witness.
  const catalogs = [{ rows: root.eventUrls, response: rootResponse, child: null }];
  const children = (sitemapDocuments.get(root) || []).filter(row => root.sitemapUrls.includes(row.url));
  let childIndex = 0;
  return {
    child(url, response, rows) {
      const original = children[childIndex++];
      if (childIndex <= 2 && originalLocs.get(original) === url && childDestination(url) &&
          response?.originalResponseUrl === url && literalLoc(rootResponse.text, url, 'index'))
        catalogs.push({ rows, response, child: url });
    },
    detail(event, row, response) {
      const requestedUrl = originalLocs.get(row);
      if (!eventDestination(requestedUrl) || requestedUrl !== row.url ||
          response?.originalResponseUrl !== requestedUrl || event?.id !== requestedUrl || event?.source_url !== requestedUrl) return;
      const catalog = catalogs.find(value => value.rows.includes(row) && literalLoc(value.response.text, requestedUrl, 'events'));
      if (!catalog) return;
      details.set(event, Object.freeze({ source, root: ROOT, child: catalog.child,
        loc: requestedUrl, response: response.originalResponseUrl, id: event.id, source_url: event.source_url }));
    },
  };
}
function carryWixDetail(from, to) {
  const input = details.get(from);
  if (input && to?.id === from.id && to?.source_url === from.source_url) details.set(to, input);
  return to;
}
function inputValid(input, source) {
  if (input?.kind === 'public_event_output_v1') return publicProviderSource(source) &&
    input.source === fingerprint(source) && publicEventDestination(input.loc) &&
    input.source_url === input.loc && typeof input.id === 'string' && input.id.length <= 1000;
  return input && declared(source) && input.source === fingerprint(source) && input.root === ROOT &&
    (input.child === null || childDestination(input.child)) && eventDestination(input.loc) &&
    input.response === input.loc && input.id === input.loc && input.source_url === input.loc;
}
function rawIdentity(raw, source) {
  for (const value of [raw.source_url, raw.url, raw.id, raw.source_event_id, raw.provider_id, raw.source_occurrence_id, source.id, source.source_identity])
    if (typeof value === 'string' && value.length > 1000) return null;
  const text = value => typeof value === 'string' ? value.trim() : '';
  const url = text(raw.source_url || raw.url);
  const id = text(raw.id || raw.source_event_id || raw.provider_id || url);
  return { atom: claimHash(source.id, source.source_identity, url, text(raw.source_occurrence_id)),
    record: claimHash(source.id, id) };
}
function captureLiveCollectionInputs(collections) {
  const claims = [];
  let bytes = 0;
  for (const collection of collections) {
    for (const raw of collection.raw) {
      if (claims.length >= MAX_CLAIMS) return null;
      const input = details.get(raw);
      const identity = rawIdentity(raw, collection.source);
      if (!identity) return null;
      // Refusals carry only nonauthorizing hashes: do not duplicate arbitrary
      // booking/capability/credential-looking raw strings into new provenance.
      const sameOriginal = input?.kind !== 'public_event_output_v1' ||
        input.loc === (data(raw, 'source_url') || data(raw, 'url')) &&
        input.id === (data(raw, 'id') || data(raw, 'source_event_id') || data(raw, 'provider_id') || input.loc);
      const claim = { ...identity, source: fingerprint(collection.source),
        input: sameOriginal && inputValid(input, collection.source) ? input : null };
      bytes += Buffer.byteLength(JSON.stringify(claim));
      if (bytes > MAX_INPUT_BYTES) return null;
      claims.push(claim);
    }
  }
  return Object.freeze({ version: 1, claims: Object.freeze(claims) });
}
function bindLiveCollection(result, inputs) {
  if (!inputs) return result;
  frames.set(result, inputs);
  Object.defineProperty(result, INPUTS, { value: inputs, enumerable: true, configurable: true });
  return result;
}
function bindLiveCacheProducer(original, result) {
  // JSON copied into a collector is ordinary Live data, not original inputs.
  // Only a frame already privately issued by collectAnchorEvents may enter
  // newly persisted provenance; disk revalidation is a separate owned read.
  const { [INPUTS]: _untrustedInputs, ...ordinary } = result;
  return bindLiveCollection(ordinary, frames.get(original));
}
function carryLiveDestinationEvidence(from, to) {
  const frame = frames.get(from);
  if (frame && to && typeof to === 'object') frames.set(to, frame);
  return to;
}
function ownLiveDestinationCache(cache) { ownedCaches.add(cache); return cache; }
function originalInputsFit(input) {
  const dataOnly = (object, keys) => object && typeof object === 'object' && !isProxy(object) &&
    Reflect.ownKeys(object).length === keys.length && keys.every(key =>
      Object.hasOwn(Object.getOwnPropertyDescriptor(object, key) || {}, 'value'));
  if (!dataOnly(input, ['version','claims']) || input.version !== 1 ||
      !Array.isArray(input.claims) || isProxy(input.claims) || input.claims.length > MAX_CLAIMS) return false;
  let bytes = 32;
  for (let index = 0; index < input.claims.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input.claims, String(index));
    if (!descriptor || !('value' in descriptor)) return false;
    const claim = descriptor.value;
    if (!dataOnly(claim, ['atom','record','source','input'])) return false;
    for (const key of ['atom','record','source']) {
      if (typeof claim[key] !== 'string' || !/^[a-f0-9]{64}$/.test(claim[key])) return false;
      bytes += 80;
    }
    if (claim.input !== null) {
      const keys = data(claim.input, 'kind') === 'public_event_output_v1'
        ? ['kind','source','loc','id','source_url'] : ['source','root','child','loc','response','id','source_url'];
      if (!dataOnly(claim.input, keys)) return false;
      for (const key of keys) {
        const value = claim.input[key];
        if (key === 'child' && value === null) continue;
        if (typeof value !== 'string' || value.length > 1000) return false;
        bytes += Buffer.byteLength(value) + 32;
      }
    }
    if (bytes > MAX_INPUT_BYTES) return false;
  }
  return true;
}
function revalidateLiveCache(cache, result, sources) {
  if (!result || isProxy(result) || !ownedCaches.has(cache)) return null;
  try {
    const input = Object.getOwnPropertyDescriptor(result, INPUTS)?.value;
    if (!originalInputsFit(input)) return null;
    // Bound before cloning or serialization. No acquire/set/expiry/health write.
    const bounded = require('../planner/live-route-upgrade').retainComposition(input);
    if (!bounded) return null;
    const current = new Map(sources.map(source => [fingerprint(source), source]));
    for (const claim of bounded.claims) {
      if (!/^[a-f0-9]{64}$/.test(claim.atom) || !/^[a-f0-9]{64}$/.test(claim.record)) return null;
      if (claim.input && (!current.has(claim.source) || !inputValid(claim.input, current.get(claim.source)))) return null;
    }
    return bounded;
  } catch (_) { return null; /* Legacy originals stay usable, without proof. */ }
}
function readLiveDestinationCache(cache, sources) {
  // Per-read validation, not a cross-request URL bag or mutation of a shared
  // original producer result. A different-config cache read cannot alter A.
  const validated = new WeakMap();
  const observe = value => {
    if (value && typeof value === 'object') validated.set(value, revalidateLiveCache(cache, value, sources));
  };
  const get = (...args) => {
    const original = cache.get.apply(cache, args);
    // Observe a genuine native Promise without replacing it or assimilating a
    // thenable twice. Preserve receiver, options, rejection and cancellation.
    try {
      const species = Object.getOwnPropertyDescriptor(NativePromise, Symbol.species);
      if (!isProxy(original) && isPromise(original) && Object.getPrototypeOf(original) === nativePromisePrototype &&
          !Object.getOwnPropertyDescriptor(original, 'constructor') &&
          Object.getOwnPropertyDescriptor(nativePromisePrototype, 'constructor')?.value === NativePromise &&
          species?.get === nativeSpecies?.get && species?.value === nativeSpecies?.value)
        nativeThen.call(original, observe, () => {});
    } catch (_) { /* unsupported protocols are unchanged and gain no authority */ }
    return original;
  };
  return {
    get,
    peek(...args) { const value = cache.peek.apply(cache, args); observe(value); return value; },
    warm(...args) {
      if (!ownedCaches.has(cache)) return cache.warm.apply(cache, args);
      // Same source-cache warm protocol, with the actual get observed above.
      Promise.resolve(get(...args)).catch(() => {});
    },
    carry(from, to) {
      frames.delete(to);
      const input = validated.get(from);
      if (input) frames.set(to, input);
      return to;
    },
  };
}
function retainedRows(live) {
  const arrays = [live?.tonight || [], live?.this_week || [],
    live?.browse?.tonight?.more || [], live?.browse?.this_week?.more || []];
  let count = 0;
  for (const rows of arrays) {
    if (!Array.isArray(rows) || (count += rows.length) > MAX_CLAIMS) return null;
  }
  return arrays.flat();
}
// An integrity seal is not source evidence. It only binds a terminal DTO to
// the private witness captured before JSON cloning. Walk bounded data without
// invoking accessors/Proxies, copying the graph, or expanding aliases as JSON.
function terminalBinding(value) {
  try {
    const digest = createHash('sha256'), pending = [value], seen = new Map();
    let bytes = 0;
    const debit = amount => { if ((bytes += amount) > 2 * 1024 * 1024) throw new Error('terminal_binding_bound'); };
    const text = value => {
      if (value.length > 2 * 1024 * 1024) throw new Error('terminal_binding_bound');
      debit(Buffer.byteLength(value) + 8);
      // UTF-16 code units distinguish lone surrogates from replacement chars.
      digest.update(`${value.length}:`).update(value, 'utf16le');
    };
    while (pending.length) {
      const item = pending.pop();
      if (item === null) { debit(8); digest.update('null;'); continue; }
      if (typeof item === 'string') { digest.update('string:'); text(item); continue; }
      if (typeof item === 'number' && Number.isFinite(item)) {
        debit(16); digest.update(`number:${Object.is(item, -0) ? '-0' : item};`); continue;
      }
      if (typeof item === 'boolean' || typeof item === 'undefined') { debit(8); digest.update(`${typeof item}:${item};`); continue; }
      if (!item || typeof item !== 'object' || isProxy(item)) return null;
      debit(8);
      if (seen.has(item)) { digest.update(`ref:${seen.get(item)};`); continue; }
      const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
      if (prototype !== (array ? Array.prototype : Object.prototype) && (array || prototype !== null)) return null;
      const keys = Reflect.ownKeys(item), children = [];
      debit(keys.length * 16);
      digest.update(`${array ? 'array' : 'object'}:${seen.size}:${keys.length};`);
      seen.set(item, seen.size);
      for (const key of keys) {
        if (typeof key !== 'string') return null;
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !('value' in descriptor)) return null;
        text(key); digest.update(descriptor.enumerable ? 'enumerable;' : 'hidden;');
        children.push(descriptor.value);
      }
      for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
    }
    return digest.digest('hex');
  } catch (_) { return null; }
}
function publicLiveSourceUrls(live) {
  try {
    // A terminal clone cannot mint evidence from its URLs. Its complete data
    // must still match the private seal; readers get isolated native Set copies.
    const terminal = terminalWitnesses.get(live);
    if (terminal) return terminal.binding && terminalBinding(live) === terminal.binding
      ? new Set(Set.prototype.values.call(terminal.urls)) : null;
    const rows = retainedRows(live);
    const frame = frames.get(live);
    if (!rows) return null;
    if (rows.length && !frame) return null;
    const urls = new Set();
    const pending = [...rows], seen = new Set();
    let count = 0;
    while (pending.length) {
      const row = pending.pop();
      if (!row || typeof row !== 'object' || seen.has(row)) continue;
      seen.add(row);
      if (++count > MAX_CLAIMS) return null;
      if (!Array.isArray(row.sources) || !row.sources.length || row.sources.length > MAX_CLAIMS) return null;
      for (const atom of row.sources) {
        const key = claimHash(atom.provider_id, atom.identity, atom.url || '', atom.occurrence_id || '');
        const claims = frame.claims.filter(claim => claim.atom === key);
        if (!claims.length || claims.some(claim => !claim.input)) return null;
        for (const claim of claims) urls.add(claim.input.loc);
      }
      const records = frame.claims.filter(claim => claim.record === claimHash(row.source_provider_id, row.id));
      if (!records.length || records.some(claim => !claim.input)) return null;
      if (!urls.has(row.source_url) || records.some(claim => claim.input.loc !== row.source_url)) return null;
      // URL-valued IDs are permitted only as this exact raw detail ID. Never
      // infer series/occurrence authority from a matching URL elsewhere.
      for (const id of [row.id, row.source_series_id, row.source_occurrence_id]) {
        if (typeof id === 'string' && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(id) &&
            records.some(claim => claim.input.id !== id)) return null;
      }
      if (Array.isArray(row.occurrences)) {
        if (pending.length + row.occurrences.length > MAX_CLAIMS) return null;
        pending.push(...row.occurrences);
      }
    }
    issuedWitnesses.set(urls, { original: live, frame, urls: Object.freeze([...urls]) });
    return urls;
  } catch (_) { return null; }
}
function associateTerminalLiveEvidence(original, clone, witness) {
  const issued = issuedWitnesses.get(witness);
  if (!issued || issued.original !== original || issued.frame !== frames.get(original) ||
      !clone || typeof clone !== 'object' || isProxy(clone) || terminalWitnesses.has(clone)) return clone;
  // Consume once; a failed association stays a terminal refusal and cannot
  // fall back to freshly scanning the clone or a modified caller-owned Set.
  issuedWitnesses.delete(witness);
  terminalWitnesses.set(clone, { binding: null });
  let index = 0;
  for (const url of Set.prototype.values.call(witness)) {
    if (index >= issued.urls.length || url !== issued.urls[index++]) return clone;
  }
  if (index !== issued.urls.length) return clone;
  const binding = terminalBinding(clone);
  if (!binding) return clone;
  if (issued.frame) frames.set(clone, issued.frame);
  // Copy original source authority, never derive it from terminal URL fields.
  terminalWitnesses.set(clone, { binding, urls: new Set(issued.urls) });
  return clone;
}
function liveDestinationRetention(live) { return frames.get(live) || null; }
module.exports = { rememberConfiguredEventSource, bindSelectedEventSource, rememberWixSitemapLoc, rememberWixSitemapDocument, bindConfiguredWixProvider, beginWixCatalogCollection, carryWixDetail,
  bindConfiguredPublicProvider, attestPublicProviderOutput,
  captureLiveCollectionInputs, bindLiveCollection, bindLiveCacheProducer, carryLiveDestinationEvidence,
  ownLiveDestinationCache, readLiveDestinationCache, publicLiveSourceUrls, associateTerminalLiveEvidence, liveDestinationRetention };
