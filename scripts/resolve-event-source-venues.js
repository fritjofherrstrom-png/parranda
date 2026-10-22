#!/usr/bin/env node
"use strict";

/**
 * Operator harness: resolve the venue addresses of reviewed mapped event
 * sources once, and store the accepted points in the reviewed venue registry.
 *
 * Library calendars publish a fixed set of branch addresses without
 * coordinates. Resolving them on every Live request would spend the shared
 * Nominatim budget on the same few addresses again and again. This script
 * resolves each new address once, politely (one request per 1.1 s, stopping
 * at the first refusal), and keeps a point only when Nominatim returns exactly
 * one result with the source's own house number and postcode inside the
 * feed's reviewed bounding box. Everything else stays unresolved.
 *
 * Without --write it only prints what it would add. Never part of tests or
 * the request path.
 *
 * Usage:
 *   node scripts/resolve-event-source-venues.js
 *   node scripts/resolve-event-source-venues.js --only dpl-copenhagen-libraries --write
 */

const fs = require("node:fs");
const path = require("node:path");

const { readMappedSourceVenues } = require("../server/pulse-sources/mapped-event-source-provider");
const {
  DEFAULT_REGISTRY_PATH,
  REGISTRY_SCHEMA,
  venueRegistryKey,
} = require("../server/pulse-sources/reviewed-event-venues");

const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "Parranda/1.0 venue review (+https://github.com/fritjofherrstrom-png/parranda)";
const MIN_INTERVAL_MS = 1100;

function parseArgs(argv) {
  const args = { feeds: path.resolve(__dirname, "../config/reviewed-event-feeds.json"), venues: DEFAULT_REGISTRY_PATH, only: null, write: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") args.write = true;
    else if (arg === "--feeds") args.feeds = path.resolve(argv[++i]);
    else if (arg === "--venues") args.venues = path.resolve(argv[++i]);
    else if (arg === "--only") args.only = new Set(String(argv[++i] || "").split(",").filter(Boolean));
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function readRegistryDocument(file) {
  try {
    const document = JSON.parse(fs.readFileSync(file, "utf8"));
    if (document?.schema === REGISTRY_SCHEMA && Array.isArray(document.venues)) return document;
  } catch (_error) {
    // A missing registry starts empty.
  }
  return { schema: REGISTRY_SCHEMA, venues: [] };
}

// The street line without floor or door suffixes ("Dronningensgade 53, 1.").
function streetLine(street) {
  return String(street || "").split(",")[0].trim();
}

function houseNumber(street) {
  const match = streetLine(street).match(/\s(\d+)\s?([a-z])?$/i);
  return match ? `${match[1]}${match[2] || ""}`.toLowerCase() : null;
}

function compactPostcode(value) {
  return String(value || "").replace(/\s+/g, "");
}

function insideBbox(lat, lng, bbox) {
  return Array.isArray(bbox) && bbox.length === 4 &&
    lng >= bbox[0] && lat >= bbox[1] && lng <= bbox[2] && lat <= bbox[3];
}

let lastRequestAt = 0;
async function nominatimSearch(params) {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  const url = new URL(NOMINATIM_SEARCH);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!response.ok) {
    const error = new Error(`nominatim_http_${response.status}`);
    error.stop = true;
    throw error;
  }
  return response.json();
}

async function resolveAddress(address, bbox) {
  const number = houseNumber(address.street);
  if (!number) return { status: "unresolved", reason: "no_house_number" };
  const results = await nominatimSearch({
    street: streetLine(address.street),
    postalcode: address.postal_code,
    countrycodes: String(address.country).toLowerCase(),
    format: "jsonv2",
    addressdetails: "1",
    limit: "5",
  });
  return matchNominatimAddressResults(results, address, bbox);
}

function matchNominatimAddressResults(results, address, bbox) {
  const number = houseNumber(address.street);
  const road = value => String(value || "").normalize("NFC").toLowerCase().replace(/[\s,.]+/g, " ").trim();
  const expectedRoad = road(streetLine(address.street).replace(/\s\d+\s?[a-z]?$/i, ""));
  const matches = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    const resultNumber = String(result.address?.house_number || "").replace(/\s+/g, "").toLowerCase();
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (resultNumber !== number) continue;
    if (road(result.address?.road || result.address?.pedestrian) !== expectedRoad) continue;
    if (String(result.address?.country_code || "").toLowerCase() !== String(address.country || "").toLowerCase()) continue;
    if (compactPostcode(result.address?.postcode) !== compactPostcode(address.postal_code)) continue;
    if (!insideBbox(lat, lng, bbox)) continue;
    const ref = result.osm_type && result.osm_id ? `${result.osm_type}/${result.osm_id}` : `${lat},${lng}`;
    matches.set(`${ref}|${lat}|${lng}`, { lat, lng, osm_ref: ref });
  }
  if (matches.size === 1) return { status: "resolved", ...[...matches.values()][0] };
  return { status: "unresolved", reason: matches.size ? "ambiguous" : "no_house_level_match" };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const feeds = JSON.parse(fs.readFileSync(args.feeds, "utf8"))
    .filter((feed) => feed.adapter === "mapped_events" && (!args.only || args.only.has(feed.id)));
  const document = readRegistryDocument(args.venues);
  const known = new Map(document.venues.map((venue) => [venueRegistryKey(venue), venue]));
  const today = new Date().toISOString().slice(0, 10);
  const added = [];
  const unresolved = [];

  for (const feed of feeds) {
    const read = await readMappedSourceVenues({ endpoint: feed.endpoint, wireProfile: feed.wire_profile, fetcher: fetch, userAgent: USER_AGENT });
    if (!read.ok) {
      console.log(`${feed.id}: source not readable (${read.reason})`);
      continue;
    }
    const pending = new Map();
    for (const venue of read.venues) {
      if (venue.has_venue_pin) continue;
      const key = venueRegistryKey(venue);
      if (!key) continue;
      if (known.has(key)) {
        const sources = new Set(known.get(key).source_ids || []);
        sources.add(feed.id);
        known.get(key).source_ids = [...sources].sort();
        continue;
      }
      if (!pending.has(key)) pending.set(key, venue);
    }
    console.log(`${feed.id}: ${read.venues.length} records, ${pending.size} new venue addresses`);
    for (const [key, venue] of pending) {
      let resolution;
      try {
        resolution = await resolveAddress(venue, feed.bbox);
      } catch (error) {
        console.log(`  stopped: ${error.message}`);
        if (error.stop) return finish(args, document, known, added, unresolved);
        throw error;
      }
      if (resolution.status !== "resolved") {
        unresolved.push({ feed: feed.id, venue: venue.venue, street: venue.street, postal_code: venue.postal_code, reason: resolution.reason });
        console.log(`  - ${venue.venue || "?"}, ${venue.street} ${venue.postal_code}: ${resolution.reason}`);
        continue;
      }
      const entry = {
        country: venue.country,
        postal_code: String(venue.postal_code),
        street: venue.street,
        name: venue.venue || null,
        locality: venue.locality || null,
        lat: Number(resolution.lat.toFixed(7)),
        lng: Number(resolution.lng.toFixed(7)),
        geometry_source: "nominatim_osm",
        osm_ref: resolution.osm_ref,
        match: "street_house_number_postcode_country",
        license: "ODbL",
        attribution: "© OpenStreetMap contributors",
        resolved_at: today,
        source_ids: [feed.id],
      };
      known.set(key, entry);
      added.push(entry);
      console.log(`  + ${venue.venue || "?"}, ${venue.street} ${venue.postal_code} -> ${entry.lat},${entry.lng} (${entry.osm_ref})`);
    }
  }
  return finish(args, document, known, added, unresolved);
}

function finish(args, document, known, added, unresolved) {
  console.log(`\n${added.length} added, ${unresolved.length} unresolved`);
  if (!args.write) {
    console.log("dry run: pass --write to update the registry");
    return;
  }
  const venues = [...known.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, venue]) => venue);
  fs.writeFileSync(args.venues, `${JSON.stringify({ ...document, schema: REGISTRY_SCHEMA, venues }, null, 2)}\n`);
  console.log(`wrote ${venues.length} venues to ${path.relative(process.cwd(), args.venues)}`);
}

if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = { matchNominatimAddressResults, resolveAddress };
