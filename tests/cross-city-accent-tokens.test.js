const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const test = require("node:test");

// City-accent-token contract.
//
// Parranda is a multi-city product, but the brand identity (Parranda
// logo + live Pulse dot) must look the same regardless of which city
// is being browsed, while CTAs, active states, and links may differ
// per city. This test pins the token architecture that makes that
// split possible:
//
//   --accent, --accent-deep       → city-overridable (CTAs, links, etc.)
//   --brand-accent, --brand-accent-deep → brand-locked (Parranda logo)
//   --terracotta                  → brand-locked (live Pulse dot)
//   --gold                        → brand-locked (logo gold partner)
//
// Adding a new override-able token is fine; promoting a brand-locked
// token to overridable should be a deliberate, reviewed decision —
// hence this regression guard.

const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

test("styles.css declares both brand-locked and city-overridable accent tokens", () => {
  assert.match(
    css,
    /--accent:\s*#af4d24/,
    "Default --accent must still be Rome terracotta (cities without override inherit this).",
  );
  assert.match(
    css,
    /--accent-deep:\s*#7f2d1a/,
    "Default --accent-deep must still be Rome burnt brick.",
  );
  assert.match(
    css,
    /--brand-accent:\s*#af4d24/,
    "--brand-accent must exist and match Rome terracotta (brand-locked across cities).",
  );
  assert.match(
    css,
    /--brand-accent-deep:\s*#7f2d1a/,
    "--brand-accent-deep must exist and match Rome burnt brick (brand-locked).",
  );
});

test("Barcelona overrides --accent and --accent-deep with distinct values", () => {
  const barcelonaBlock = css.match(
    /body\[data-city-key="barcelona"\]\s*\{[^}]+\}/,
  );
  assert.ok(
    barcelonaBlock,
    "Expected a body[data-city-key=\"barcelona\"] block to exist for city-accent overrides.",
  );
  assert.match(barcelonaBlock[0], /--accent:\s*#/, "Barcelona must override --accent.");
  assert.match(
    barcelonaBlock[0],
    /--accent-deep:\s*#/,
    "Barcelona must override --accent-deep.",
  );
  assert.doesNotMatch(
    barcelonaBlock[0],
    /#af4d24/i,
    "Barcelona --accent must not equal Rome's terracotta — otherwise the override has no effect.",
  );
});

test("Athens overrides --accent and --accent-deep with distinct values", () => {
  const athensBlock = css.match(/body\[data-city-key="athens"\]\s*\{[^}]+\}/);
  assert.ok(
    athensBlock,
    "Expected a body[data-city-key=\"athens\"] block to exist for city-accent overrides.",
  );
  assert.match(athensBlock[0], /--accent:\s*#/, "Athens must override --accent.");
  assert.match(
    athensBlock[0],
    /--accent-deep:\s*#/,
    "Athens must override --accent-deep.",
  );
  assert.doesNotMatch(
    athensBlock[0],
    /#af4d24/i,
    "Athens --accent must not equal Rome's terracotta — otherwise the override has no effect.",
  );
});

test("City blocks must not override brand-locked tokens", () => {
  const brandLockedTokens = [
    "--brand-accent",
    "--brand-accent-deep",
    "--terracotta",
    "--gold",
    "--paper",
    "--text",
    "--muted",
    "--olive",
  ];

  for (const cityKey of ["barcelona", "athens"]) {
    const cityBlock = css.match(
      new RegExp(`body\\[data-city-key="${cityKey}"\\]\\s*\\{([^}]+)\\}`),
    );
    if (!cityBlock) continue;
    const body = cityBlock[1];

    for (const token of brandLockedTokens) {
      assert.doesNotMatch(
        body,
        new RegExp(`\\${token}\\s*:`),
        `City block for "${cityKey}" must not override brand-locked token ${token}. ` +
          `Only --accent and --accent-deep may be overridden per city.`,
      );
    }
  }
});

test("Brand mark gradient uses brand-locked --brand-accent (not city-overridable --accent)", () => {
  // The Parranda "P" logo must stay terracotta+gold regardless of which
  // city is being browsed. If this regresses to var(--accent), Barcelona
  // and Athens will silently get a blue Parranda logo.
  const brandMarkBlock = css.match(/\.brand-mark\s*\{[^}]+\}/);
  assert.ok(brandMarkBlock, "Expected a .brand-mark rule in styles.css.");
  assert.match(
    brandMarkBlock[0],
    /var\(--brand-accent\)/,
    ".brand-mark must use var(--brand-accent), not var(--accent). " +
      "Otherwise the Parranda logo changes color per city.",
  );
  assert.doesNotMatch(
    brandMarkBlock[0],
    /var\(--accent\)[^-]/,
    ".brand-mark must not reference var(--accent) (only --brand-accent).",
  );
});
