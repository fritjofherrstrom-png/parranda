/**
 * Every island must hydrate into the tree the static build shipped.
 *
 * Both surfaces are `client:load`, so the browser's first paint is Astro's
 * build-time HTML and React's first client render has to agree with it. When it
 * does not, React throws away the server tree and re-renders from scratch
 * (error #418) — the page still ends up right, which is why this went unnoticed,
 * but every visitor paid for a discarded tree and the recovery is not
 * guaranteed to be invisible.
 *
 * The asymmetry that caused it is structural, not incidental: the build runs in
 * bare Node where `window` does not exist, and the browser runs with globals
 * Express injected into the document at serve time. Anything read from those
 * globals DURING RENDER is therefore a different value in the two passes.
 * The rule these tests hold: render from props and state, and adopt
 * serve-time globals in an effect, after hydration has committed.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { renderAndHydrate, hydrationComplaints } from "./helpers/hydration-harness.mjs";

/** The registry Express injects at serve time (server/app.js buildLandingCityRegistry). */
const INJECTED_CITIES = {
  rome: { key: "rome", label: "Rom", status: "public", center: { lat: 41.8933, lng: 12.4964 } },
  rom: { key: "rome", label: "Rom", status: "public", center: { lat: 41.8933, lng: 12.4964 } },
  roma: { key: "rome", label: "Rom", status: "public", center: { lat: 41.8933, lng: 12.4964 } },
  barcelona: { key: "barcelona", label: "Barcelona", status: "public", center: { lat: 41.3874, lng: 2.1686 } },
  barcelone: { key: "barcelona", label: "Barcelona", status: "public", center: { lat: 41.3874, lng: 2.1686 } },
  athens: { key: "athens", label: "Athens", status: "preview", center: { lat: 37.9838, lng: 23.7275 } },
};

// --------------------------------------------------------------------------
// The landing — the first page of every planner tab.
// --------------------------------------------------------------------------

test("the landing hydrates cleanly with the city registry the server injects", async (t) => {
  // The observed failure. The build prerenders with no registry and emits no
  // curated section; the browser renders one with two chips in it. React finds
  // a <section> that is not in the server HTML and discards the whole tree.
  const h = await renderAndHydrate({
    entry: "components/LandingHero.tsx",
    props: { lang: "en" },
    url: "http://localhost/?lang=en",
    injected: { __PARRANDA_CITIES__: INJECTED_CITIES },
  });
  t.after(() => h.cleanup());

  assert.deepEqual(
    hydrationComplaints(h),
    [],
    "the landing island's first client render must match the tree the build shipped",
  );
});

test("the landing still shows the curated cities after hydration", async (t) => {
  // The fix must not buy silence by dropping the feature: the chips are the
  // point of the registry. They arrive after hydration commits rather than
  // during it.
  const h = await renderAndHydrate({
    entry: "components/LandingHero.tsx",
    props: { lang: "en" },
    url: "http://localhost/?lang=en",
    injected: { __PARRANDA_CITIES__: INJECTED_CITIES },
  });
  t.after(() => h.cleanup());

  const text = h.text();
  assert.match(text, /Extra curated/, "the curated section is rendered");
  assert.match(text, /Barcelona/, "Barcelona is offered");
  assert.match(text, /Rom/, "Rome is offered");
  // status: "preview" is searchable by name but never advertised as a chip.
  assert.ok(!/Athens/.test(text), "a non-public city is still not advertised");
});

test("the landing hydrates cleanly when no registry was injected at all", async (t) => {
  // astro dev, or a serve path that never replaced the token. The island must
  // agree with the build in this direction too.
  const h = await renderAndHydrate({
    entry: "components/LandingHero.tsx",
    props: { lang: "en" },
    url: "http://localhost/?lang=en",
  });
  t.after(() => h.cleanup());

  assert.deepEqual(hydrationComplaints(h), [], "an absent registry must not mismatch either");
  assert.ok(!/Extra curated/.test(h.text()), "and nothing curated is claimed");
});

test("the landing hydrates cleanly when the token was left unreplaced", async (t) => {
  // The literal fallback in index.astro: window.__PARRANDA_CITIES__ is the
  // string "__PARRANDA_LANDING_REGISTRY__". It must read as an empty registry,
  // not as data.
  const h = await renderAndHydrate({
    entry: "components/LandingHero.tsx",
    props: { lang: "en" },
    url: "http://localhost/?lang=en",
    injected: { __PARRANDA_CITIES__: "__PARRANDA_LANDING_REGISTRY__" },
  });
  t.after(() => h.cleanup());

  assert.deepEqual(hydrationComplaints(h), [], "an unreplaced token must not mismatch");
  assert.ok(!/__PARRANDA_LANDING_REGISTRY__/.test(h.text()), "and the token never renders as a city");
});

test("a direct ?lang=sv load hydrates cleanly", async (t) => {
  // Static output cannot read query params, so the build always renders EN and
  // the island switches after hydration. That switch must happen in an effect,
  // never during the render React is comparing.
  const h = await renderAndHydrate({
    entry: "components/LandingHero.tsx",
    props: { lang: "en" },
    url: "http://localhost/?lang=sv",
    injected: { __PARRANDA_CITIES__: INJECTED_CITIES },
  });
  t.after(() => h.cleanup());

  assert.deepEqual(hydrationComplaints(h), [], "the language contract must not cost a mismatch");
});

// --------------------------------------------------------------------------
// The planner itself.
// --------------------------------------------------------------------------

test("the planner hydrates cleanly on a direct load", async (t) => {
  const h = await renderAndHydrate({
    entry: "components/AnywherePlanner.tsx",
    props: { lang: "en" },
    url: "http://localhost/anywhere?place=Barcelona&lang=en",
  });
  t.after(() => h.cleanup());

  assert.deepEqual(hydrationComplaints(h), [], "the planner island must hydrate into the build's tree");
});

test("the planner hydrates cleanly for a returning visitor with saved days", async (t) => {
  // Retention lives in localStorage, which the build cannot see. Reading it
  // during render would reproduce exactly the landing's defect on the planner.
  const h = await renderAndHydrate({
    entry: "components/AnywherePlanner.tsx",
    props: { lang: "en" },
    url: "http://localhost/anywhere?place=Barcelona&lang=en",
  });
  t.after(() => h.cleanup());

  assert.deepEqual(hydrationComplaints(h), [], "stored state must not leak into the hydrating render");
});

test("the planner hydrates cleanly on a shared link", async (t) => {
  const h = await renderAndHydrate({
    entry: "components/AnywherePlanner.tsx",
    props: { lang: "en" },
    url: "http://localhost/anywhere?place=Rome&prefs=food,culture&walk=balanced&lang=sv",
  });
  t.after(() => h.cleanup());

  assert.deepEqual(hydrationComplaints(h), [], "share parameters are adopted after hydration, not during it");
});

// --------------------------------------------------------------------------
// The rule itself, so a future island cannot reintroduce this quietly.
// --------------------------------------------------------------------------

test("every island in the build hydrates into the tree the build shipped", async () => {
  // The tests above name the islands and globals we already know about. This
  // one discovers them: any component added under src/components is an island
  // candidate, and it is hydrated with every serve-time global the server is
  // known to inject.
  //
  // A structural version of this rule — grep the source for an injected global
  // read inside useMemo — was written first and silently passed while the
  // landing was still broken, because `useMemo<CityRegistry>(` does not match
  // `useMemo(`. A regex that can be defeated by a type argument is not a guard,
  // so the rule is enforced by hydrating instead.
  const { readdir } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");

  const dir = fileURLToPath(new URL("../src/components", import.meta.url));
  const islands = (await readdir(dir)).filter((name) => name.endsWith(".tsx"));
  assert.ok(islands.length >= 2, `expected the known islands, found ${islands.join(", ") || "none"}`);

  for (const island of islands) {
    const h = await renderAndHydrate({
      entry: `components/${island}`,
      props: { lang: "en" },
      url: "http://localhost/?lang=en",
      // Everything the server injects, whether or not this island reads it.
      injected: { __PARRANDA_CITIES__: INJECTED_CITIES },
    });
    // Torn down inside the loop, not with t.after: each island installs its own
    // browser globals, and after-hooks run in registration order, so a deferred
    // teardown would restore "no window" before the next island unmounted.
    const complaints = hydrationComplaints(h);
    await h.cleanup();
    assert.deepEqual(
      complaints,
      [],
      `${island} renders a different tree on the client than the build prerendered`,
    );
  }
});
