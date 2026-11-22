'use strict';

// An offline settlement register for place suggestions when Photon cannot
// answer. Built from GeoNames `cities1000` (CC BY 4.0) by
// scripts/build-place-gazetteer.js into the cache directory; never committed
// and never fetched at runtime. A row is a point: no bounds are invented and no
// OSM identity is claimed, so a choice carries its own source and licence.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { isValidCoordinate } = require('../planner/agnostic-place-intake');

const FORMAT_VERSION = 1;
const DEFAULT_FILE_NAME = 'geonames-cities1000.v1.json';
const VISIBLE_LIMIT = 5;
const ATTRIBUTION = 'GeoNames';
const LICENSE = 'CC-BY-4.0';
// Former, destroyed and abandoned settlements are history, not a day's anchor.
const EXCLUDED_CODES = new Set(['PPLQ', 'PPLH', 'PPLW', 'PPLCH']);
const LETTERS = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', đ: 'd', ł: 'l', ı: 'i', þ: 'th' };
const fold = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[øæœßđłıþ]/g, letter => LETTERS[letter]).replace(/\s+/g, ' ').trim();

// Alternate names are for matching only. Codes (IATA, ISO, postal), links and
// numbered names are not names a person types for a city.
function usableAlternate(name) {
  const value = String(name || '').trim();
  return value.length >= 2 && value.length <= 60 && !/\d/.test(value) && !/^[A-Z]{2,5}$/.test(value) &&
    !/^[A-Z]{2,3}-[A-Z]{1,3}$/.test(value) && !/[/:@]/.test(value);
}

// One stored-entry zip (the GeoNames dump) → its single file's bytes.
function unzipSingleFile(buffer, wanted) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('zip_without_directory');
  const entries = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  for (let n = 0; n < entries; n++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('zip_bad_directory');
    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (name !== wanted) continue;
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('zip_bad_entry');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + compressed);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return zlib.inflateRawSync(data);
    throw new Error('zip_unsupported_method');
  }
  throw new Error('zip_entry_missing');
}

function parseAdmin1(text) {
  const names = {};
  for (const line of String(text || '').split('\n')) {
    const [code, name] = line.split('\t');
    if (code && name) names[code] = name.trim();
  }
  return names;
}

// A table column: repeated strings stored once, rows hold an index.
function column(values) {
  const table = [], seen = new Map();
  const index = values.map(value => {
    if (!seen.has(value)) { seen.set(value, table.length); table.push(value); }
    return seen.get(value);
  });
  return { table, index };
}

// GeoNames `geoname` table rows → a columnar register plus a name index that is
// sorted once here, so a server only parses it. Index entries hold the row
// number for the place's own name and -(row + 1) for an alternate name.
function buildGazetteer({ citiesTsv, admin1Tsv, source = {} }) {
  const admin1 = parseAdmin1(admin1Tsv);
  const rows = [];
  for (const line of String(citiesTsv || '').split('\n')) {
    const c = line.split('\t');
    if (c.length < 19 || c[6] !== 'P' || EXCLUDED_CODES.has(c[7])) continue;
    const id = Number(c[0]), lat = Number(c[4]), lng = Number(c[5]);
    const name = c[1].trim();
    if (!Number.isInteger(id) || !name || !isValidCoordinate(lat, lng)) continue;
    rows.push({ id, name, ascii: c[2].trim(), alternates: c[3].split(',').filter(usableAlternate), lat, lng, code: c[7], country: c[8],
      region: admin1[`${c[8]}.${c[10]}`] || '', population: Number(c[14]) || 0, timezone: c[17] || '' });
  }
  const entries = [];
  rows.forEach((row, index) => {
    const own = new Set([row.name, row.ascii].map(fold).filter(Boolean));
    own.forEach(key => entries.push([key, index]));
    new Set(row.alternates.map(fold).filter(key => key && !own.has(key))).forEach(key => entries.push([key, -(index + 1)]));
  });
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  const code = column(rows.map(row => row.code)), country = column(rows.map(row => row.country));
  const region = column(rows.map(row => row.region)), timezone = column(rows.map(row => row.timezone));
  return {
    v: FORMAT_VERSION, source, count: rows.length,
    ids: rows.map(row => row.id), names: rows.map(row => row.name),
    lat: rows.map(row => Math.round(row.lat * 1e5) / 1e5), lng: rows.map(row => Math.round(row.lng * 1e5) / 1e5),
    population: rows.map(row => row.population),
    codes: code.table, code: code.index, countries: country.table, country: country.index,
    regions: region.table, region: region.index, timezones: timezone.table, timezone: timezone.index,
    keys: entries.map(entry => entry[0]).join('\n'), key_rows: entries.map(entry => entry[1]),
  };
}

function countryName(code, language) {
  if (!/^[A-Z]{2}$/.test(code || '')) return '';
  for (const lang of [language, 'en']) {
    if (!/^[a-z]{2}$/.test(lang || '')) continue;
    try {
      const name = new Intl.DisplayNames([lang], { type: 'region' }).of(code);
      if (name && name !== code) return name;
    } catch (_) { /* fall through */ }
  }
  return code;
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

const MAJOR_POPULATION = 100000;
// An alternate name may be a former name ("York" for a town in Ohio) or a
// rare transliteration ("Kyoln" for Köln). It finds a major place by prefix
// only once the query says enough, and a minor place only by its exact name.
const ALTERNATE_PREFIX_MIN = 4;

const FIELDS = ['ids', 'names', 'lat', 'lng', 'population', 'codes', 'code', 'countries', 'country', 'regions', 'region', 'timezones', 'timezone', 'key_rows'];
const ROW_FIELDS = ['ids', 'names', 'lat', 'lng', 'population', 'code', 'country', 'region', 'timezone'];
function validRegister(data) {
  return Boolean(data && data.v === FORMAT_VERSION && typeof data.keys === 'string' && Number.isInteger(data.count) &&
    FIELDS.every(field => Array.isArray(data[field])) && ROW_FIELDS.every(field => data[field].length === data.count));
}

// Typed columns only, so the parsed JSON arrays are garbage once this returns.
function registerColumns(data) {
  return {
    ids: Int32Array.from(data.ids), lat: Float64Array.from(data.lat), lng: Float64Array.from(data.lng),
    population: Float64Array.from(data.population), code: Uint16Array.from(data.code), country: Uint16Array.from(data.country),
    region: Uint32Array.from(data.region), timezone: Uint16Array.from(data.timezone), keyRows: Int32Array.from(data.key_rows),
    names: data.names, codes: data.codes, countries: data.countries, regions: data.regions, timezones: data.timezones, keys: data.keys,
  };
}

function createGazetteerSearch(data) {
  return validRegister(data) ? searchColumns(registerColumns(data)) : null;
}

function searchColumns({ ids, lat, lng, population, code, country, region, timezone, keyRows, names, codes, countries, regions, timezones, keys }) {
  // Offsets of each name in the joined string; the counts must agree exactly.
  const starts = new Int32Array(keyRows.length + 1);
  let at = 0;
  for (let i = 0; i < keyRows.length; i++) {
    if (at > keys.length) return null;
    starts[i] = at;
    const next = keys.indexOf('\n', at);
    at = next < 0 ? keys.length + 1 : next + 1;
  }
  if (keyRows.length && at !== keys.length + 1) return null;
  starts[keyRows.length] = keys.length + 1;
  const key = i => keys.slice(starts[i], starts[i + 1] - 1);
  const major = row => codes[code[row]] === 'PPLC' || population[row] >= MAJOR_POPULATION;

  function toChoice(row, language) {
    const title = names[row];
    const distinct = values => [...new Map(values.filter(value => value && value.toLowerCase() !== title.toLowerCase())
      .map(value => [value.toLowerCase(), value])).values()];
    const countryCode = countries[country[row]], regionName = regions[region[row]];
    const englishCountry = countryName(countryCode, 'en');
    const query = [title, ...distinct([regionName, englishCountry])].join(', ');
    if (query.length > 200) return null;
    const candidate = {
      label: query, lat: lat[row], lng: lng[row], confidence: 'medium', provenance: 'geonames', geonames_id: ids[row],
      attribution: ATTRIBUTION, license: LICENSE,
      admin_context: { locality: null, county: null, region: regionName || null, country: englishCountry || null, country_code: countryCode ? countryCode.toLowerCase() : null },
    };
    if (timezones[timezone[row]]) candidate.timezone = timezones[timezone[row]];
    return { title, context: distinct([regionName, countryName(countryCode, language)]).join(' · '), query,
      kind: codes[code[row]] === 'PPLX' ? 'district' : 'settlement', major: major(row), candidate };
  }

  return function searchGazetteer(raw, { language, near } = {}) {
    const query = fold(raw);
    if (!query) return [];
    let low = 0, high = keyRows.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (key(mid) < query) low = mid + 1; else high = mid;
    }
    // One class per place, lower is better: exact before prefix, then the
    // place's own name (or a major place's alternate) before a minor alternate.
    const best = new Map();
    for (let i = low; i < keyRows.length; i++) {
      if (!keys.startsWith(query, starts[i])) break;
      const alternate = keyRows[i] < 0, row = alternate ? -keyRows[i] - 1 : keyRows[i];
      const exact = starts[i + 1] - 1 - starts[i] === query.length;
      if (alternate && !exact && (!major(row) || query.length < ALTERNATE_PREFIX_MIN)) continue;
      const rank = (exact ? 0 : 2) + (alternate && !major(row) ? 1 : 0);
      if (!best.has(row) || rank < best.get(row)) best.set(row, rank);
    }
    const ordered = [];
    for (const [row, rank] of best) {
      const far = near && distanceKm(near, { lat: lat[row], lng: lng[row] }) > 100 ? 1 : 0;
      ordered.push({ row, rank: rank * 2 + far });
    }
    ordered.sort((a, b) => a.rank - b.rank || population[b.row] - population[a.row] || ids[a.row] - ids[b.row]);
    // Two rows a reader cannot tell apart are one row to them; keep the larger.
    const seen = new Set(), choices = [];
    for (const { row } of ordered) {
      const choice = toChoice(row, language);
      if (!choice || seen.has(choice.query)) continue;
      seen.add(choice.query); choices.push(choice);
      if (choices.length === VISIBLE_LIMIT) break;
    }
    return choices;
  };
}

function defaultGazetteerFile(env = process.env) {
  if (env.PARRANDA_PLACE_GAZETTEER) return env.PARRANDA_PLACE_GAZETTEER;
  return env.PARRANDA_CACHE_DIR ? path.join(env.PARRANDA_CACHE_DIR, 'place-gazetteer', DEFAULT_FILE_NAME) : null;
}

// Loads once, on first need. A missing or malformed file is no fallback, never
// an error: suggestions then behave exactly as without a register.
function createLazyGazetteer(file, { readFile = fs.promises.readFile } = {}) {
  if (!file || /^(disabled|0|false)$/i.test(file)) return null;
  let loading = null;
  const load = () => (loading ||= readFile(file, 'utf8').then(text => createGazetteerSearch(JSON.parse(text))).catch(() => null));
  const search = (query, context) => load().then(found => (found ? found(query, context) : null));
  // Lets a slow provider start the read before its deadline, not after it.
  search.warm = () => { load(); };
  return search;
}

module.exports = {
  ATTRIBUTION, LICENSE, DEFAULT_FILE_NAME, FORMAT_VERSION,
  buildGazetteer, createGazetteerSearch, createLazyGazetteer, defaultGazetteerFile, unzipSingleFile, fold,
};
