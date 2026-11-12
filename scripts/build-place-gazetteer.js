#!/usr/bin/env node
'use strict';

// Builds the offline place register that keeps suggestions working when Photon
// cannot answer. Run once per machine (and whenever you want fresher data):
//
//   PARRANDA_CACHE_DIR=~/.parranda/source-cache node scripts/build-place-gazetteer.js
//
// Source: GeoNames `cities1000` + `admin1CodesASCII` (CC BY 4.0,
// https://www.geonames.org/). Writes <cache>/place-gazetteer/<file>; the server
// reads it only when Photon fails. --out <file> writes elsewhere.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { buildGazetteer, unzipSingleFile, defaultGazetteerFile } = require('../server/place-candidates/place-gazetteer');

const BASE = 'https://download.geonames.org/export/dump/';
const USER_AGENT = 'Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)';

async function download(name) {
  const response = await fetch(BASE + name, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, meta: { url: BASE + name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), last_modified: response.headers.get('last-modified') } };
}

async function main() {
  const outIndex = process.argv.indexOf('--out');
  const out = outIndex > 0 ? path.resolve(process.argv[outIndex + 1]) : defaultGazetteerFile(process.env);
  if (!out) throw new Error('Set PARRANDA_CACHE_DIR (or PARRANDA_PLACE_GAZETTEER, or pass --out <file>).');
  const cities = await download('cities1000.zip');
  const admin1 = await download('admin1CodesASCII.txt');
  const data = buildGazetteer({
    citiesTsv: unzipSingleFile(cities.bytes, 'cities1000.txt').toString('utf8'),
    admin1Tsv: admin1.bytes.toString('utf8'),
    source: { name: 'GeoNames', license: 'CC-BY-4.0', attribution: 'GeoNames', built_at: new Date().toISOString(), files: [cities.meta, admin1.meta] },
  });
  if (data.count < 100000) throw new Error(`Only ${data.count} places; refusing to replace the register.`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const temporary = `${out}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data));
  fs.renameSync(temporary, out);
  console.log(`Wrote ${data.count} places and ${data.key_rows.length} names to ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB).`);
}

main().catch(error => { console.error(error.message); process.exit(1); });
