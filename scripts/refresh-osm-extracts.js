#!/usr/bin/env node
"use strict";

// Rebuilds the local OpenStreetMap stores, one region at a time, so their data
// stays recent. A store keeps working however old it is; this only renews it.
//
//   node scripts/refresh-osm-extracts.js --out <store dir> [--work <dir>] \
//     [--regions sweden,spain] [--min-free-gb 2.5] [--memory-limit 2GB] [--dry-run]
//
// For each region in turn it downloads the Geofabrik extract and its boundary
// file into <work>, checks the extract against Geofabrik's MD5, builds the store
// with scripts/build-osm-extract.js, deletes the extract, and then checks the
// new store: its totals agree with its tile inventory and every listed tile is
// on disk with the listed hash.
//
// Disk: a build needs the extract plus headroom for DuckDB temporary files
// (half the extract's size). A region is skipped when that would leave less than
// --min-free-gb free, and a running build is stopped when free space falls
// below it. The extract is deleted whether the build succeeded or not.
//
// The builder writes only into an attempt-owned staging directory. The old
// region is replaced only after validation. Use an offline output generation,
// never a directory currently served by the application, then install/restart.
//
// The default region list is the one the QA sweep uses. France and Germany are
// listed as Geofabrik sub-regions; the whole countries are about 5 GB each.

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { OSM_EXTRACT_FORMAT } = require("../server/place-candidates/osm-extract-store");

const GEOFABRIK_BASE = "https://download.geofabrik.de";
const GB = 1024 ** 3;
const DEFAULT_MIN_FREE_BYTES = 2.5 * GB;
// Headroom for DuckDB temporary files beside the extract. The builder keeps
// its joins small and measured no spill on Denmark (0.5 GB); before that fix
// it spilled two to three times the extract. The watchdog still guards it.
const TEMP_FACTOR = 0.5;
const WATCH_INTERVAL_MS = 2000;
const USER_AGENT = "parranda-osm-extract-refresh";

// region: the store's directory name. geofabrik: the extract's path on
// download.geofabrik.de, without "-latest.osm.pbf".
const REGIONS = Object.freeze([
  { region: "sweden", geofabrik: "europe/sweden" },
  { region: "denmark", geofabrik: "europe/denmark" },
  { region: "norway", geofabrik: "europe/norway" },
  { region: "netherlands", geofabrik: "europe/netherlands" },
  { region: "united-kingdom", geofabrik: "europe/united-kingdom" },
  { region: "portugal", geofabrik: "europe/portugal" },
  { region: "spain", geofabrik: "europe/spain" },
  { region: "italy", geofabrik: "europe/italy" },
  { region: "slovenia", geofabrik: "europe/slovenia" },
  { region: "france-ile-de-france", geofabrik: "europe/france/ile-de-france" },
  { region: "france-rhone-alpes", geofabrik: "europe/france/rhone-alpes" },
  { region: "germany-berlin", geofabrik: "europe/germany/berlin" },
].map(Object.freeze));

function regionUrls({ geofabrik }, base = GEOFABRIK_BASE) {
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(String(geofabrik || ""))) throw new Error(`bad Geofabrik path: ${geofabrik}`);
  return {
    pbf: `${base}/${geofabrik}-latest.osm.pbf`,
    md5: `${base}/${geofabrik}-latest.osm.pbf.md5`,
    poly: `${base}/${geofabrik}.poly`,
  };
}

function selectRegions(names, regions = REGIONS) {
  if (!names) return [...regions];
  const wanted = String(names).split(",").map(name => name.trim()).filter(Boolean);
  const unknown = wanted.filter(name => !regions.some(entry => entry.region === name));
  if (unknown.length) throw new Error(`unknown region(s): ${unknown.join(", ")}`);
  return regions.filter(entry => wanted.includes(entry.region));
}

function freeBytes(dir) {
  const stats = fs.statfsSync(dir);
  return Number(stats.bavail) * Number(stats.bsize);
}

// Whether a build of an extract this size fits: the extract, DuckDB's
// temporary files and the floor that must stay free.
function diskPlan({ free, pbfBytes, minFree = DEFAULT_MIN_FREE_BYTES }) {
  const needed = Math.ceil(pbfBytes * (1 + TEMP_FACTOR)) + minFree;
  return { fits: free >= needed, needed, free };
}

// Checks a store the builder wrote: format and region, totals that agree with
// the tile inventory, and every listed tile on disk with its count and hash.
function verifyStore(regionDir, { region } = {}) {
  const problems = [];
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(regionDir, "manifest.json"), "utf8"));
  } catch (error) {
    return { ok: false, problems: [`manifest unreadable: ${error.message}`] };
  }
  if (manifest.format !== OSM_EXTRACT_FORMAT) problems.push(`format ${manifest.format}`);
  if (region && manifest.region !== region) problems.push(`region ${manifest.region}, expected ${region}`);
  if (!Number.isFinite(Date.parse(manifest.data_timestamp))) problems.push("data_timestamp is not a date");
  const inventory = manifest.tiles && typeof manifest.tiles === "object" ? manifest.tiles : {};
  const keys = Object.keys(inventory);
  let listed = 0;
  let bytes = 0;
  for (const key of keys) {
    const entry = inventory[key];
    listed += Number(entry?.n) || 0;
    let raw;
    try {
      raw = fs.readFileSync(path.join(regionDir, "tiles", `${key}.json`));
    } catch (_error) {
      problems.push(`tile ${key} missing`);
      continue;
    }
    bytes += raw.length;
    if (createHash("sha256").update(raw).digest("hex") !== entry.sha256) problems.push(`tile ${key} hash differs`);
    else if (JSON.parse(raw.toString("utf8")).length !== entry.n) problems.push(`tile ${key} count differs`);
  }
  if (manifest.tile_count !== keys.length) problems.push(`tile_count ${manifest.tile_count}, inventory ${keys.length}`);
  if (manifest.element_count !== listed) problems.push(`element_count ${manifest.element_count}, inventory ${listed}`);
  const onDisk = fs.existsSync(path.join(regionDir, "tiles")) ? fs.readdirSync(path.join(regionDir, "tiles")).length : 0;
  if (onDisk !== keys.length) problems.push(`${onDisk} tile files on disk, ${keys.length} listed`);
  return {
    ok: problems.length === 0,
    problems: problems.slice(0, 10),
    region: manifest.region,
    data_timestamp: manifest.data_timestamp,
    element_count: manifest.element_count,
    tile_count: manifest.tile_count,
    tile_bytes: bytes,
  };
}

async function download(url, file, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok || !response.body) throw new Error(`GET ${url} answered ${response.status}`);
  const hash = createHash("md5");
  const body = Readable.fromWeb(response.body);
  body.on("data", chunk => hash.update(chunk));
  await pipeline(body, fs.createWriteStream(file));
  return hash.digest("hex");
}

async function fetchText(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
  return response.text();
}

async function contentLength(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { method: "HEAD", headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`HEAD ${url} answered ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0) throw new Error(`HEAD ${url} gave no size`);
  return length;
}

// Runs the builder as a child process and stops it if free space on the store's
// disk falls below the floor.
function runBuild({ pbf, poly, region, out, memoryLimit, minFree, watchDir }) {
  return new Promise((resolve, reject) => {
    const args = [path.join(__dirname, "build-osm-extract.js"), "--pbf", pbf, "--poly", poly, "--region", region, "--out", out];
    if (memoryLimit) args.push("--memory-limit", memoryLimit);
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    let lowest = Number.POSITIVE_INFINITY;
    let stopped = null;
    child.stdout.on("data", chunk => { stdout += chunk; });
    const watch = setInterval(() => {
      const free = freeBytes(watchDir);
      lowest = Math.min(lowest, free);
      if (free < minFree && !stopped) {
        stopped = `free space fell to ${(free / GB).toFixed(2)} GB`;
        child.kill("SIGKILL");
      }
    }, WATCH_INTERVAL_MS);
    child.on("error", error => { clearInterval(watch); reject(error); });
    child.on("close", code => {
      clearInterval(watch);
      if (stopped) return reject(new Error(`build stopped: ${stopped}`));
      if (code !== 0) return reject(new Error(`build exited with ${code}`));
      try {
        resolve({ ...JSON.parse(stdout.trim().split("\n").pop()), lowest_free_gb: Number((lowest / GB).toFixed(2)) });
      } catch (_error) {
        reject(new Error("build printed no result"));
      }
    });
  });
}

// What a killed build can leave beside the stores.
function removeBuildLeftovers(out, region) {
  fs.rmSync(path.join(out, ".build-tmp"), { recursive: true, force: true });
  for (const name of fs.existsSync(out) ? fs.readdirSync(out) : []) {
    // A retired directory may be the only remaining complete generation.
    // Never delete it as an unqualified build leftover.
    if (name.startsWith(`.${region}.building-`)) {
      fs.rmSync(path.join(out, name), { recursive: true, force: true });
    }
  }
}

async function refreshRegion(entry, {
  out, work, minFree = DEFAULT_MIN_FREE_BYTES, memoryLimit = null,
  fetchImpl = fetch, build = runBuild, log = () => {},
} = {}) {
  const urls = regionUrls(entry);
  const pbfBytes = await contentLength(urls.pbf, { fetchImpl });
  const plan = diskPlan({ free: Math.min(freeBytes(work), freeBytes(out)), pbfBytes, minFree });
  if (!plan.fits) {
    return { region: entry.region, status: "skipped_disk", pbf_gb: +(pbfBytes / GB).toFixed(2),
      needed_gb: +(plan.needed / GB).toFixed(2), free_gb: +(plan.free / GB).toFixed(2) };
  }
  const regionWork = fs.mkdtempSync(path.join(work, `.${entry.region}.download-`));
  const buildOut = fs.mkdtempSync(path.join(out, `.${entry.region}.refresh-`));
  const pbf = path.join(regionWork, `${entry.region}.osm.pbf`);
  const poly = path.join(regionWork, `${entry.region}.poly`);
  const started = Date.now();
  try {
    log(`${entry.region}: downloading ${(pbfBytes / GB).toFixed(2)} GB`);
    const expectedMd5 = (await fetchText(urls.md5, { fetchImpl })).trim().split(/\s+/)[0].toLowerCase();
    fs.writeFileSync(poly, await fetchText(urls.poly, { fetchImpl }));
    const md5 = await download(urls.pbf, pbf, { fetchImpl });
    if (md5 !== expectedMd5) throw new Error(`MD5 ${md5} does not match Geofabrik's ${expectedMd5}`);
    const downloadSeconds = (Date.now() - started) / 1000;
    log(`${entry.region}: building`);
    const built = await build({ pbf, poly, region: entry.region, out: buildOut, memoryLimit, minFree, watchDir: out });
    fs.rmSync(regionWork, { recursive: true, force: true });
    const stagedRegion = path.join(buildOut, entry.region);
    const check = verifyStore(stagedRegion, { region: entry.region });
    if (check.ok) {
      const regionDir = path.join(out, entry.region);
      // Keep the previous generation outside the disposable build directory:
      // even a failed recovery must not lose it in the finally cleanup.
      const previous = `${buildOut}.previous`;
      const hadPrevious = fs.existsSync(regionDir);
      if (hadPrevious) fs.renameSync(regionDir, previous);
      try {
        fs.renameSync(stagedRegion, regionDir);
      } catch (error) {
        if (hadPrevious) {
          try { fs.renameSync(previous, regionDir); }
          catch (recovery) {
            throw new Error(`${error.message}; previous store retained at ${previous}: ${recovery.message}`);
          }
        }
        throw error;
      }
      if (hadPrevious) {
        try { fs.rmSync(previous, { recursive: true, force: true }); }
        catch (error) { check.cleanup_warning = `previous store retained at ${previous}: ${error.message}`; }
      }
    }
    return {
      region: entry.region,
      status: check.ok ? "ok" : "store_invalid",
      pbf_gb: +(pbfBytes / GB).toFixed(2),
      download_s: +downloadSeconds.toFixed(1),
      build_s: built.seconds,
      lowest_free_gb: built.lowest_free_gb ?? null,
      ...check,
    };
  } catch (error) {
    return { region: entry.region, status: "failed", error: String(error?.message || error) };
  } finally {
    fs.rmSync(regionWork, { recursive: true, force: true });
    fs.rmSync(buildOut, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const name = String(argv[i]).replace(/^--/, "");
    if (name === "dry-run") args[name] = true;
    else { args[name] = argv[i + 1]; i += 1; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    console.error("usage: refresh-osm-extracts.js --out <store dir> [--work <dir>] [--regions a,b] [--min-free-gb 2.5] [--memory-limit 2GB] [--dry-run]");
    process.exit(2);
  }
  const out = path.resolve(args.out);
  const work = path.resolve(args.work || path.join(out, "..", "osm-extract-downloads"));
  const minFreeGb = args["min-free-gb"] === undefined ? DEFAULT_MIN_FREE_BYTES / GB : Number(args["min-free-gb"]);
  if (!Number.isFinite(minFreeGb) || minFreeGb < 0) throw new Error("--min-free-gb must be a finite non-negative number");
  const minFree = minFreeGb * GB;
  const regions = selectRegions(args.regions);
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  if (args["dry-run"]) {
    for (const entry of regions) console.log(JSON.stringify({ region: entry.region, ...regionUrls(entry) }));
    return;
  }
  const results = [];
  for (const entry of regions) {
    const result = await refreshRegion(entry, {
      out, work, minFree, memoryLimit: args["memory-limit"] || null,
      log: message => console.error(`[${new Date().toISOString()}] ${message}`),
    });
    results.push(result);
    console.log(JSON.stringify(result));
  }
  if (results.some(result => result.status !== "ok")) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error?.message || error); process.exit(1); });

module.exports = { REGIONS, regionUrls, selectRegions, diskPlan, verifyStore, refreshRegion, removeBuildLeftovers };
