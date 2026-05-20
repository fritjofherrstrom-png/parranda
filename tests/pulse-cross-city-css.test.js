const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const test = require("node:test");

const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

// Cross-city consistency regression guard.
//
// The Pulse edition surface must match Rome (dark theme) across all
// cities — Barcelona was previously rendered with a divergent cream
// theme through `.mode-city-preview .city-pulse-edition`, which forced
// a cascade of dark-text overrides downstream. Rule going forward:
//
//   Same surfaces, different signal density.
//
// `.mode-city-preview` may still style other shell surfaces (hero strip,
// teaser, planner shell), but it must not theme the full Pulse view into
// a different visual language than Rome's.

test("mode-city-preview must not theme .city-pulse-edition (cross-city consistency)", () => {
  assert.doesNotMatch(
    css,
    /\.mode-city-preview\s+\.city-pulse-edition/,
    "Re-adding `.mode-city-preview .city-pulse-edition` would re-introduce the Barcelona cream-on-cream Pulse divergence. Keep the full Pulse view themed by the base `.city-pulse-edition` rules across every city.",
  );
});

test("mode-city-preview body class still exists for other surfaces", () => {
  // Sanity: the class itself is intentionally kept around — only the
  // Pulse-edition override was removed. This pins that we did not delete
  // the class wholesale by accident.
  assert.match(css, /\.mode-city-preview\s/);
});
