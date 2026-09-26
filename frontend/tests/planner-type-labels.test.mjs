/**
 * Every kind of place Parranda can publish as a stop has words in both
 * languages. The kinds come from the sources themselves — the curated catalogs'
 * `kind` and the open-data mappings' `type` — so a new kind added there without
 * a label fails here, instead of shipping as a silently missing chip.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

async function loadCopy() {
  const { outputFiles } = await esbuild.build({
    entryPoints: [resolve(HERE, "../src/components/planner/copy.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}

// Areas, not places: these structure a city and are never published as stops.
const STRUCTURAL_KINDS = new Set(["district", "district-group"]);

function publishedKinds() {
  const kinds = new Set();
  const catalogs = [
    resolve(ROOT, "server/catalog.js"),
    ...readdirSync(resolve(ROOT, "server/cities"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(ROOT, "server/cities", entry.name, "catalog.js")),
  ];
  for (const file of catalogs) {
    let source = "";
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const [, kind] of source.matchAll(/^\s+kind: "([a-z_-]+)"/gm)) kinds.add(kind);
  }
  for (const name of ["open-data-loader.js", "overture-source.js", "visit-sweden-napi-source.js"]) {
    const source = readFileSync(resolve(ROOT, "server/place-candidates", name), "utf8");
    for (const [, type] of source.matchAll(/type: "([a-z_-]+)", tags:/g)) kinds.add(type);
  }
  return [...kinds].filter((kind) => !STRUCTURAL_KINDS.has(kind)).sort();
}

test("every kind a source can publish has a type label in both languages", async () => {
  const { typeLabel } = await loadCopy();
  const kinds = publishedKinds();
  assert.ok(kinds.length > 20, "the sources were read");
  const missing = kinds.filter((kind) => !typeLabel(kind, "sv") || !typeLabel(kind, "en"));
  assert.deepEqual(missing, [], "add these kinds to TYPE_LABELS");
});

test("an unknown kind has no label rather than echoing the token", async () => {
  const { typeLabel } = await loadCopy();
  assert.equal(typeLabel("shop", "sv"), "Butik");
  assert.equal(typeLabel("church", "en"), "Church");
  assert.equal(typeLabel("some_new_engine_kind", "sv"), "");
  assert.equal(typeLabel(null, "en"), "");
});
