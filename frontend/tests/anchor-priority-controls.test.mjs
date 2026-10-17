import assert from "node:assert/strict";
import test from "node:test";

import { ANYWHERE_PREFERENCES, DAY_RHYTHMS } from "../src/lib/anywhere-payload.mjs";
import { mountPlanner } from "./helpers/planner-harness.mjs";

const defaultSelected = ["food", "culture", "views"];
const optionName = (key, lang = "en") => ANYWHERE_PREFERENCES.find((pref) => pref.key === key)[lang];
const accessibleName = (button) => {
  const content = button.cloneNode(true);
  content.querySelectorAll('[aria-hidden="true"]').forEach((element) => element.remove());
  return (button.getAttribute("aria-label") || content.textContent).trim();
};
const choices = (h, lang = "en") => [...h.container.querySelectorAll("button[aria-pressed]")]
  .filter((button) => ANYWHERE_PREFERENCES.some((pref) => pref[lang] === accessibleName(button)));
const rankBadge = (button) => button.querySelector('span[aria-hidden="true"]');
const click = (h, button) => h.act(() => button.click());

async function mountCard(t, overrides = {}) {
  const lang = overrides.lang ?? "en";
  const h = await mountPlanner({
    entry: "components/planner/AnchorCard.tsx",
    url: `http://localhost/anywhere?lang=${lang}`,
    props: {
      t: (sv, en) => lang === "en" ? en : sv,
      lang,
      anchorLabel: "Lund",
      dayOffset: 0,
      moodLabel: defaultSelected.map((key) => optionName(key, lang)).join(", "),
      walkLabel: lang === "en" ? "Balanced" : "Lagom",
      adjustOpen: true,
      setAdjustOpen: () => {},
      preferences: ANYWHERE_PREFERENCES,
      selected: [...defaultSelected],
      onToggleMood: () => {},
      onSetDay: () => {},
      rhythms: DAY_RHYTHMS,
      walkKey: "balanced",
      onSetRhythm: () => {},
      onChangePlace: () => {},
      ...overrides,
    },
  });
  t.after(() => h.unmount());
  return h;
}

test("legacy selected choices remain neutral without false priority numbers", async (t) => {
  const h = await mountCard(t);
  const buttons = choices(h);
  assert.equal(buttons.length, ANYWHERE_PREFERENCES.length);
  assert.deepEqual(buttons.filter((button) => button.getAttribute("aria-pressed") === "true")
    .map(accessibleName), defaultSelected.map((key) => optionName(key)));
  assert.ok(buttons.every((button) => !rankBadge(button)), "legacy order is not a hidden Food priority");
  assert.ok(!h.container.querySelector('button[aria-label^="Increase priority"]'), "old callers get no dead promotion controls");
});

test("explicit dominance numbers five selected choices while every chip keeps its place", async (t) => {
  const preferencePriority = ["nightlife", "fika", "views", "culture", "food"];
  const h = await mountCard(t, {
    selected: ["food", "culture", "views", "fika", "nightlife"],
    preferencePriority,
  });
  const buttons = choices(h);
  // Re-sorting by rank would move another chip under the finger.
  assert.deepEqual(buttons.map(accessibleName), ANYWHERE_PREFERENCES.map((pref) => pref.en),
    "chips stay in catalogue order; only the numbers express dominance");
  preferencePriority.forEach((key, index) => {
    const button = buttons.find((candidate) => accessibleName(candidate) === optionName(key));
    assert.equal(button.getAttribute("aria-pressed"), "true");
    assert.equal(rankBadge(button)?.textContent, String(index + 1), `${key} has a visible rank`);
    assert.equal(accessibleName(button), optionName(key), "the rank does not become part of the choice name");
  });
  assert.ok(buttons.filter((button) => button.getAttribute("aria-pressed") === "false").every((button) => !rankBadge(button)));
  assert.ok(!h.container.querySelector('button[aria-label^="Increase priority"]'), "explicit ranks can render without an editing callback");
});

test("every chip is one control: a tap toggles, and neutral explains how to rank", async (t) => {
  const toggled = [];
  const h = await mountCard(t, { preferencePriority: [], onToggleMood: (key) => toggled.push(key) });
  assert.ok(!h.container.querySelector('button[aria-label^="Increase priority"]'), "no separate promote control");
  for (const key of defaultSelected) {
    const group = h.container.querySelector(`[data-preference-key="${key}"]`);
    assert.equal(group.querySelectorAll("button").length, 1, `${key} has a single control`);
    await click(h, group.querySelector("button[aria-pressed]"));
  }
  assert.deepEqual(toggled, defaultSelected);
  assert.ok([...h.container.querySelectorAll("p")].some((paragraph) => paragraph.textContent === "Tap an interest off and on to make it weigh most."));
});

test("ranked chips still deselect with one tap", async (t) => {
  const toggled = [];
  const h = await mountCard(t, {
    preferencePriority: ["views", "culture", "food"],
    onToggleMood: (key) => toggled.push(key),
  });
  assert.ok(!h.container.querySelector("button button"), "buttons are never nested");
  for (const key of ["views", "culture"]) {
    const main = h.container.querySelector(`[data-preference-key="${key}"] button[aria-pressed]`);
    assert.equal(main.getAttribute("aria-pressed"), "true");
    assert.equal(main.disabled, false, "even rank one remains deselectable");
    await click(h, main);
  }
  assert.deepEqual(toggled, ["views", "culture"], "each choice invokes its existing toggle once");
});

for (const [lang, helpText, rankPrefix] of [
  ["sv", "Siffrorna visar ordningen du valde i. Ettan väger tyngst.", "Prioritet"],
  ["en", "Numbers show the order you picked. 1 weighs most.", "Priority"],
]) {
  test(`${lang}: explains pick order outside the chips with accessible localized ranks`, async (t) => {
    const h = await mountCard(t, { lang, preferencePriority: ["views", "culture", "food"] });
    const help = [...h.container.querySelectorAll("p")].find((paragraph) => paragraph.textContent === helpText);
    assert.ok(help, "one short sentence explains what the numbers mean");
    assert.ok(!help.closest("button"), "explanations stay outside buttons");
    const preferenceGroup = h.container.querySelector(`[role="group"][aria-describedby="${help.id}"]`);
    assert.ok(preferenceGroup, "the interest group is described by the explanation");
    ["views", "culture", "food"].forEach((key, index) => {
      const group = h.container.querySelector(`[data-preference-key="${key}"]`);
      assert.equal(group.getAttribute("aria-label"), `${rankPrefix} ${index + 1}: ${optionName(key, lang)}`);
      assert.equal(accessibleName(group.querySelector("button[aria-pressed]")), optionName(key, lang));
      assert.equal(group.querySelectorAll("button").length, 1);
    });
  });
}

test("a partial priority numbers only the picked prefix without mutating selection or hiding other choices", async (t) => {
  const selected = Object.freeze(["views", "food", "culture"]);
  const preferencePriority = Object.freeze(["nightlife", "culture", "culture", "unknown"]);
  const h = await mountCard(t, { selected, preferencePriority });
  const buttons = choices(h);
  assert.deepEqual(buttons.map(accessibleName), ANYWHERE_PREFERENCES.map((pref) => pref.en));
  assert.deepEqual(buttons.slice(0, 3).map((button) => rankBadge(button)?.textContent), [undefined, "1", undefined],
    "only the picked interest is numbered; food and views stay unranked in place");
  assert.ok(buttons.slice(3).every((button) => button.getAttribute("aria-pressed") === "false" && !rankBadge(button)));
  assert.deepEqual(selected, ["views", "food", "culture"]);
  assert.deepEqual(preferencePriority, ["nightlife", "culture", "culture", "unknown"]);
});

test("a ranking can be cleared back to neutral", async (t) => {
  let cleared = 0;
  const h = await mountCard(t, {
    preferencePriority: ["views", "culture", "food"],
    onClearPriority: () => { cleared += 1; },
  });
  const clear = [...h.container.querySelectorAll("button")].find((button) => button.textContent === "Clear the order");
  assert.ok(clear, "a ranked day offers a way back to unranked interests");
  await click(h, clear);
  assert.equal(cleared, 1);
});

test("neutral interests offer nothing to clear", async (t) => {
  const h = await mountCard(t, { preferencePriority: [], onClearPriority: () => {} });
  assert.ok(![...h.container.querySelectorAll("button")].some((button) => button.textContent === "Clear the order"));
});
