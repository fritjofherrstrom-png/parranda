/**
 * The planner page's landmarks and its first status, as a screen reader meets
 * them (7fb8c10 accessibility audit):
 *
 * - The app bar's navigation comes before <main>, not inside it, like the
 *   landing. The page shell no longer wraps the island in a <main>.
 * - The map has one landmark: its own "Map of the day" region. The desktop
 *   column around it used to repeat that name as an <aside>.
 * - The static HTML cannot see its own link, so its status only says that the
 *   day is being prepared. It used to tell a reader with a place link to
 *   choose a place on the home page, visibly and in role="status".
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { renderAndHydrate } from "./helpers/hydration-harness.mjs";
import { mountPlanner } from "./helpers/planner-harness.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the static planner says only that the day is being prepared", async (t) => {
  const h = await renderAndHydrate({
    entry: "components/AnywherePlanner.tsx",
    props: { lang: "en" },
    url: "http://localhost/anywhere?place=Barcelona&lang=en",
  });
  t.after(() => h.cleanup());
  assert.match(h.serverHtml, /role="status"[^>]*><p>Preparing your day …<\/p>/);
  assert.doesNotMatch(h.serverHtml, /choose a place on the home page|Go to home/);
});

test("a link with no place still says where to go once it has been read", async (t) => {
  const h = await mountPlanner({ url: "http://localhost/anywhere?lang=en" });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const status = [...h.container.querySelectorAll('[role="status"]')].find((el) => /home page/.test(el.textContent));
  assert.ok(status, "the verdict is in a status region");
  assert.match(status.textContent, /If no saved day is available, choose a place on the home page/);
  assert.ok(status.querySelector('a[href="/?lang=en"]'), "and links home");
});

test("navigation sits before main, and the map is one landmark", async (t) => {
  assert.doesNotMatch(read("../src/pages/anywhere.astro"), /^\s*<main/m);
  const planner = read("../src/components/AnywherePlanner.tsx");
  assert.doesNotMatch(planner, /<aside aria-label=\{t\("Karta över dagen", "Map of the day"\)\}/);
  assert.match(read("../src/components/planner/RouteMap.tsx"), /"Map\.Title": t\("Karta över dagen", "Map of the day"\)/);

  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&lang=en" });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const main = h.container.querySelector("main");
  const nav = h.container.querySelector('nav[aria-label="Parranda"]');
  assert.ok(main && nav, "the planner draws both");
  assert.equal(main.contains(nav), false, "navigation is not main content");
  assert.ok(nav.compareDocumentPosition(main) & h.window.Node.DOCUMENT_POSITION_FOLLOWING, "navigation comes first");
  assert.equal(h.container.querySelectorAll("main").length, 1);
});
