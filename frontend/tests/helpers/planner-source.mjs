/**
 * The planner's source, for the contract tests that read it.
 *
 * The planner is one island split across files: the orchestrator
 * (components/AnywherePlanner.tsx, which owns every request, race guard and
 * commitment) and the presentational pieces it renders (components/planner/*,
 * components/shared/*). A contract about the planner SURFACE — no jargon, 44px
 * targets, no raw engine tokens — is a contract about all of them, so those
 * tests read the whole surface. A test about ONE piece (the Live sheet cannot
 * touch the day; the map draws no order without a route) reads that piece
 * alone, which is stronger than searching the concatenation.
 */
import { readdirSync, readFileSync } from "node:fs";

const COMPONENTS = new URL("../../src/components/", import.meta.url);

/** One component file, by its path under src/components/. */
export function componentSource(relativePath) {
  return readFileSync(new URL(relativePath, COMPONENTS), "utf8");
}

/** The orchestrator first, then every piece it renders, in a stable order. */
export function plannerSurfaceSource() {
  const files = ["AnywherePlanner.tsx"];
  for (const dir of ["planner", "shared"]) {
    for (const file of readdirSync(new URL(`${dir}/`, COMPONENTS)).sort()) {
      if (/\.(tsx|ts)$/.test(file)) files.push(`${dir}/${file}`);
    }
  }
  return files.map(componentSource).join("\n");
}
