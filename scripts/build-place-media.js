#!/usr/bin/env node
"use strict";

// Builds the place-media index (docs/PLACE_MEDIA.md) for the places of a
// local OpenStreetMap extract store (scripts/build-osm-extract.js).
//
//   node scripts/build-place-media.js --extract-dir <dir> --out <dir> [--limit N] [--refresh]
//
// --extract-dir is the extract store (<dir>/<region>/manifest.json + tiles) or
// one region directory. Every element with a `wikidata` tag gives a QID; its
// `wikimedia_commons=File:…` tag becomes the OSM photo candidate. Records are
// fetched in batches from Wikidata, Wikipedia and Commons (only QIDs and
// file/article titles are sent) and written to <out>/index-v1.jsonl in one
// rename. Records already in <out>/index-v1.jsonl are reused unless --refresh.
// Point PARRANDA_PLACE_MEDIA_DIR at <out> and restart the server.

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { OSM_EXTRACT_FORMAT } = require("../server/place-candidates/osm-extract-store");
const { createWikimediaClient, ENTITY_BATCH } = require("../server/place-media/wikimedia-client");
const { normalizeMediaRecord } = require("../server/place-media/record");
const { INDEX_FILE } = require("../server/place-media/index");

const QID = /^Q[1-9]\d{0,11}$/;
const TILE_KEY = /^-?\d{1,5}_-?\d{1,5}$/;

function regionDirs(extractDir) {
  if (fs.existsSync(path.join(extractDir, "manifest.json"))) return [extractDir];
  return fs.readdirSync(extractDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map(entry => path.join(extractDir, entry.name))
    .filter(dir => fs.existsSync(path.join(dir, "manifest.json")))
    .sort();
}

/**
 * Reads every tile of every region and returns qid → { osmCommons } plus
 * counts. A tile whose hash does not match its manifest is skipped.
 */
function scanExtract(extractDir, { log = () => {} } = {}) {
  const qids = new Map();
  const stats = { regions: 0, tiles: 0, broken_tiles: 0, elements: 0, with_wikidata: 0, brand_skipped: 0, commons_hints: 0, commons_conflicts: 0 };
  for (const dir of regionDirs(extractDir)) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")); } catch { manifest = null; }
    if (!manifest || manifest.format !== OSM_EXTRACT_FORMAT || !manifest.tiles || typeof manifest.tiles !== "object") {
      log(`skip ${dir}: not a ${OSM_EXTRACT_FORMAT} region`);
      continue;
    }
    stats.regions += 1;
    for (const [key, entry] of Object.entries(manifest.tiles)) {
      if (!TILE_KEY.test(key)) continue;
      let elements;
      try {
        const raw = fs.readFileSync(path.join(dir, "tiles", `${key}.json`));
        if (createHash("sha256").update(raw).digest("hex") !== entry?.sha256) throw new Error("hash");
        elements = JSON.parse(raw.toString("utf8"));
        if (!Array.isArray(elements)) throw new Error("shape");
      } catch {
        stats.broken_tiles += 1;
        log(`skip broken tile ${path.basename(dir)}/${key}`);
        continue;
      }
      stats.tiles += 1;
      for (const element of elements) {
        stats.elements += 1;
        const tags = element?.tags;
        const qid = typeof tags?.wikidata === "string" ? tags.wikidata.trim() : "";
        if (!QID.test(qid)) continue;
        stats.with_wikidata += 1;
        // The OSM wikidata tag may name the brand, not the place.
        const brands = String(tags["brand:wikidata"] || "").split(";").map(value => value.trim());
        if (brands.includes(qid)) { stats.brand_skipped += 1; continue; }
        const commons = typeof tags.wikimedia_commons === "string" && /^File:[^|#<>[\]{}]+$/.test(tags.wikimedia_commons.trim())
          ? tags.wikimedia_commons.trim() : null;
        const seen = qids.get(qid);
        if (!seen) {
          qids.set(qid, { osmCommons: commons, conflict: false });
          if (commons) stats.commons_hints += 1;
        } else if (commons && !seen.conflict && seen.osmCommons !== commons) {
          if (seen.osmCommons) {
            // Two elements disagree about the photo: trust neither.
            seen.conflict = true;
            seen.osmCommons = null;
            stats.commons_conflicts += 1;
          } else {
            seen.osmCommons = commons;
            stats.commons_hints += 1;
          }
        }
      }
    }
  }
  return { qids, stats };
}

function readExistingIndex(file) {
  const records = new Map();
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return records; }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = normalizeMediaRecord(JSON.parse(line));
      if (record) records.set(record.qid, record);
    } catch { /* a broken line is fetched again */ }
  }
  return records;
}

function writeIndexAtomically(outDir, records) {
  fs.mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, INDEX_FILE);
  const temp = path.join(outDir, `.${INDEX_FILE}.tmp-${process.pid}`);
  const lines = [...records.values()].sort((a, b) => Number(a.qid.slice(1)) - Number(b.qid.slice(1)))
    .map(record => JSON.stringify(record)).join("\n");
  fs.writeFileSync(temp, lines ? `${lines}\n` : "", "utf8");
  fs.renameSync(temp, target);
  return target;
}

function coverage(records) {
  const summary = { records: records.size, with_entity: 0, with_photo: 0, photo_via: {}, photo_license: {},
    with_subtitle: { sv: 0, en: 0 }, with_about: { sv: 0, en: 0 } };
  for (const record of records.values()) {
    if (record.entity) summary.with_entity += 1;
    if (record.photo) {
      summary.with_photo += 1;
      summary.photo_via[record.photo.via] = (summary.photo_via[record.photo.via] || 0) + 1;
      summary.photo_license[record.photo.license] = (summary.photo_license[record.photo.license] || 0) + 1;
    }
    for (const lang of ["sv", "en"]) {
      if (record.subtitle?.[lang]) summary.with_subtitle[lang] += 1;
      if (record.about?.[lang]) summary.with_about[lang] += 1;
    }
  }
  return summary;
}

/** Scan, fetch and write. Returns the summary it prints. */
async function buildPlaceMediaIndex({ extractDir, outDir, limit = Infinity, refresh = false, client, log = () => {} }) {
  const { qids, stats } = scanExtract(extractDir, { log });
  const ordered = [...qids.keys()].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const selected = Number.isFinite(limit) && limit >= 0 ? ordered.slice(0, limit) : ordered;
  const existing = refresh ? new Map() : readExistingIndex(path.join(outDir, INDEX_FILE));
  const records = new Map();
  let reused = 0;
  for (const qid of selected) if (existing.has(qid)) { records.set(qid, existing.get(qid)); reused += 1; }
  const todo = selected.filter(qid => !records.has(qid));
  log(`scan: ${stats.regions} region(s), ${stats.tiles} tile(s), ${stats.elements} element(s), ${qids.size} QID(s); ${reused} reused, ${todo.length} to fetch`);
  let fetched = 0;
  let failed = 0;
  let stopped = null;
  for (let i = 0; i < todo.length; i += ENTITY_BATCH) {
    const batch = todo.slice(i, i + ENTITY_BATCH);
    const hints = new Map(batch.map(qid => [qid, qids.get(qid).osmCommons]).filter(([, file]) => file));
    try {
      const got = await client.fetchRecords(batch, { osmCommons: hints });
      for (const qid of batch) {
        if (got.has(qid)) { records.set(qid, got.get(qid)); fetched += 1; } else failed += 1;
      }
    } catch (error) {
      failed += batch.length;
      log(`batch ${i / ENTITY_BATCH + 1} failed: ${error?.code || error?.message || error}`);
      if (error?.code === "circuit_open" || error?.code === "retry_after") { stopped = error.code; break; }
    }
    const photos = [...records.values()].filter(record => record.photo).length;
    log(`[${Math.min(i + ENTITY_BATCH, todo.length)}/${todo.length}] records ${records.size}, photos ${photos}`);
  }
  const file = writeIndexAtomically(outDir, records);
  return { file, scan: stats, qids: qids.size, selected: selected.length, reused, fetched, failed, stopped,
    coverage: coverage(records), client: typeof client.health === "function" ? client.health() : null };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const name = String(argv[i]).replace(/^--/, "");
    if (name === "refresh") { args.refresh = true; continue; }
    args[name] = argv[i + 1];
    i += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args["extract-dir"] || !args.out) {
    console.error("usage: build-place-media.js --extract-dir <osm extract store> --out <dir> [--limit N] [--refresh]");
    process.exit(2);
  }
  const limit = args.limit === undefined ? Infinity : Number(args.limit);
  if (!(limit >= 0)) { console.error("--limit must be a number >= 0"); process.exit(2); }
  const started = Date.now();
  const client = createWikimediaClient({ retryAfterMaxWaitMs: 60_000 });
  const summary = await buildPlaceMediaIndex({
    extractDir: args["extract-dir"], outDir: args.out, limit, refresh: Boolean(args.refresh), client,
    log: line => console.error(line),
  });
  console.log(JSON.stringify({ ...summary, seconds: Number(((Date.now() - started) / 1000).toFixed(1)) }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error?.message || error); process.exit(1); });

module.exports = { scanExtract, buildPlaceMediaIndex, writeIndexAtomically, readExistingIndex, coverage };
