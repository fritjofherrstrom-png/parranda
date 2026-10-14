"use strict";

const { normalizeOpeningHours, evaluateOpeningHoursForWindow } = require('./opening-hours');
const { normalizeSourceNameAliases } = require('./source-name-aliases');

// Only trusted acquisition/cache hydration can attach this channel. Public JSON
// cannot mint it. A shared bounded ledger travels on the array AND its records,
// so ordinary array spread/filter/snapshot boundaries cannot discard the facts.
const SOURCE_NEGATIVE_FACTS = Symbol('sourceNegativeFacts');
const NEGATIVE_FACT_WITNESS = Symbol('negativeFactWitness');
// Four already bounded Overpass passes (primary, wider, two regional buckets).
// This is a metadata bound, not an acquisition or positive-candidate allowance.
const MAX_NEGATIVE_FACTS = 4 * 152;

function text(value, max) {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
}
function projectFact(record) {
  const id = text(record?.id, 80);
  const label = text(record?.label || record?.name, 200);
  const type = text(record?.type, 64);
  if (!id || !label || !type || !Number.isFinite(record.lat) || !Number.isFinite(record.lng)) return null;
  const hours = normalizeOpeningHours(record.opening_hours);
  const inactive = record.operational_status === 'inactive';
  if (!hours && !inactive) return null;
  const fact = { id, label, type, lat: record.lat, lng: record.lng,
    ...(hours ? { opening_hours: hours } : {}),
    ...(inactive ? { operational_status: 'inactive', operational_reasons:
      (Array.isArray(record.operational_reasons) ? record.operational_reasons : [])
        .slice(0, 16).filter(value => typeof value === 'string' && /^[a-z0-9_:-]{1,80}$/.test(value)) } : {}),
  };
  const direct = text(record.wikidata_id, 32);
  const linked = (Array.isArray(record.sources) ? record.sources : []).slice(0, 8)
    .map(source => /^https?:\/\/(?:www\.)?wikidata\.org\/wiki\/(Q\d+)$/.exec(source?.url || '')?.[1]).find(Boolean);
  const entity = direct && /^Q\d+$/.test(direct) ? direct : linked;
  if (entity) fact.wikidata_id = entity;
  const address = record.source_address;
  if (text(address?.street, 120) && text(address?.house_number, 24)) {
    fact.source_address = { street: address.street.trim(), house_number: address.house_number.trim() };
  }
  const aliases = normalizeSourceNameAliases(record.source_name_aliases);
  if (aliases.length) fact.source_name_aliases = aliases;
  const website = text(record.website, 2048);
  if (website) fact.website = website;
  return fact;
}

function readSourceNegativeFacts(...values) {
  const facts = [], seenLedgers = new Set(), seenFacts = new Set();
  const take = value => {
    const ledger = value?.[SOURCE_NEGATIVE_FACTS];
    if (!Array.isArray(ledger) || seenLedgers.has(ledger)) return;
    seenLedgers.add(ledger);
    for (const fact of ledger) {
      if (facts.length >= MAX_NEGATIVE_FACTS) break;
      const key = `${fact.id}|${fact.opening_hours || ''}|${fact.operational_status || ''}`;
      if (!seenFacts.has(key)) { seenFacts.add(key); facts.push(fact); }
    }
  };
  for (const value of values) {
    take(value);
    if (Array.isArray(value)) for (const row of value) take(row);
  }
  return facts;
}

function attachSourceNegativeFacts(rows, facts) {
  if (!Array.isArray(rows) || !Array.isArray(facts) || !facts.length) return rows;
  // Clone just bounded positive record shells; never mutate independently cached
  // source rows and thereby attach Thursday's acquisition to Friday's request.
  const ledger = Object.freeze(facts.slice(0, MAX_NEGATIVE_FACTS));
  const output = rows.map(row => {
    const copy = { ...row };
    Object.defineProperty(copy, SOURCE_NEGATIVE_FACTS, { value: ledger });
    return copy;
  });
  for (const key of Reflect.ownKeys(rows)) {
    if (key === SOURCE_NEGATIVE_FACTS || key === 'length' || /^\d+$/.test(String(key))) continue;
    Object.defineProperty(output, key, Object.getOwnPropertyDescriptor(rows, key));
  }
  Object.defineProperty(output, SOURCE_NEGATIVE_FACTS, { value: ledger });
  return output;
}

function retainSourceNegativeFacts(rows, acquired, window) {
  const facts = readSourceNegativeFacts(acquired);
  const seen = new Set(facts.map(fact => `${fact.id}|${fact.opening_hours || ''}|${fact.operational_status || ''}`));
  for (const record of Array.isArray(acquired) ? acquired : []) {
    if (facts.length >= MAX_NEGATIVE_FACTS) break;
    if (record.operational_status !== 'inactive' &&
        (!window || evaluateOpeningHoursForWindow(record.opening_hours, window).eligible !== false)) continue;
    const fact = projectFact(record);
    if (!fact) continue;
    const key = `${fact.id}|${fact.opening_hours || ''}|${fact.operational_status || ''}`;
    if (!seen.has(key)) { seen.add(key); facts.push(fact); }
  }
  return attachSourceNegativeFacts(rows, facts);
}

// Only the source cache's private envelope is passed here, never public records.
function hydrateSourceNegativeFacts(rows, persisted) {
  const facts = [];
  for (const value of Array.isArray(persisted) ? persisted.slice(0, MAX_NEGATIVE_FACTS) : []) {
    const fact = projectFact(value);
    if (fact) facts.push(fact);
  }
  return attachSourceNegativeFacts(rows, facts);
}

function transferSourceNegativeFacts(target, source) {
  const ledger = source?.[SOURCE_NEGATIVE_FACTS];
  if (Array.isArray(ledger)) Object.defineProperty(target, SOURCE_NEGATIVE_FACTS, { value: ledger });
  return target;
}
function negativeFactWitnesses(candidates) {
  const ids = new Set(candidates.map(candidate => candidate.id));
  return readSourceNegativeFacts(candidates).filter(fact => !ids.has(fact.id)).map(fact => {
    const witness = { ...fact, city_pack_owned: false, evidence: [] };
    Object.defineProperty(witness, NEGATIVE_FACT_WITNESS, { value: true });
    return witness;
  });
}

module.exports = {
  MAX_NEGATIVE_FACTS, NEGATIVE_FACT_WITNESS,
  readSourceNegativeFacts, attachSourceNegativeFacts, retainSourceNegativeFacts,
  hydrateSourceNegativeFacts, transferSourceNegativeFacts, negativeFactWitnesses,
};
