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

test("explicit dominance orders five selected choices with contiguous ranks before unselected options", async (t) => {
  const preferencePriority = ["nightlife", "fika", "views", "culture", "food"];
  const h = await mountCard(t, {
    selected: ["food", "culture", "views", "fika", "nightlife"],
    preferencePriority,
  });
  const buttons = choices(h);
  assert.deepEqual(buttons.map(accessibleName), [...preferencePriority, "green", "second_hand"]
    .map((key) => optionName(key)), "displayed order expresses explicit content dominance");
  preferencePriority.forEach((key, index) => {
    const button = buttons[index];
    assert.equal(button.getAttribute("aria-pressed"), "true");
    assert.equal(rankBadge(button)?.textContent, String(index + 1), `${key} has a visible rank`);
    assert.equal(accessibleName(button), optionName(key), "the rank does not become part of the choice name");
  });
  assert.ok(buttons.slice(preferencePriority.length).every((button) => !rankBadge(button)));
  assert.ok(!h.container.querySelector('button[aria-label^="Increase priority"]'), "explicit ranks can render without an editing callback");
});

test("every neutral selected choice offers its own promotion action without toggling selection", async (t) => {
  const promoted = [];
  const toggled = [];
  const h = await mountCard(t, {
    preferencePriority: [],
    onPromoteMood: (key) => promoted.push(key),
    onToggleMood: (key) => toggled.push(key),
  });
  assert.equal(choices(h).length, ANYWHERE_PREFERENCES.length);
  assert.ok(choices(h).every((button) => !rankBadge(button)), "neutral selections stay unnumbered");
  for (const pref of ANYWHERE_PREFERENCES) {
    const promote = [...h.container.querySelectorAll('button[aria-label]')]
      .find((button) => button.getAttribute("aria-label") === `Increase priority for ${pref.en}`);
    if (!defaultSelected.includes(pref.key)) {
      assert.ok(!promote, "unselected choices have no promotion action");
      continue;
    }
    assert.ok(promote, `${pref.key} can establish the first explicit priority`);
    const group = h.container.querySelector(`[data-preference-key="${pref.key}"]`);
    assert.ok(group, `${pref.key} has a stable control group`);
    assert.equal(promote.getAttribute("aria-label"), `Increase priority for ${pref.en}`);
    assert.equal(promote.disabled, false, "even the first neutral choice is promotable");
    assert.equal(group.querySelectorAll("button").length, 2);
    assert.ok(!promote.closest("button button"), "promotion is not nested in the selection button");
    await click(h, promote);
  }
  assert.deepEqual(promoted, defaultSelected, "each promotion invokes exactly its own callback once");
  assert.deepEqual(toggled, [], "promotion never deselects an interest");
  assert.equal(h.fetchMock.calls.length, 0, "AnchorCard leaves composition to its parent");
});

test("the first explicit priority cannot be promoted while lower priorities can", async (t) => {
  const promoted = [];
  const toggled = [];
  const h = await mountCard(t, {
    preferencePriority: ["views", "culture", "food"],
    onPromoteMood: (key) => promoted.push(key),
    onToggleMood: (key) => toggled.push(key),
  });
  const first = h.container.querySelector('[data-preference-key="views"] button[aria-label]');
  const second = h.container.querySelector('[data-preference-key="culture"] button[aria-label]');
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.disabled, true, "rank one has nowhere higher to go");
  await click(h, first);
  assert.deepEqual(promoted, []);
  assert.equal(second.disabled, false);
  await click(h, second);
  assert.deepEqual(promoted, ["culture"]);
  assert.deepEqual(toggled, []);
});

test("selected main buttons still deselect independently of their sibling promotion buttons", async (t) => {
  const promoted = [];
  const toggled = [];
  const h = await mountCard(t, {
    preferencePriority: ["views", "culture", "food"],
    onPromoteMood: (key) => promoted.push(key),
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
  assert.deepEqual(promoted, [], "deselection never invokes promotion");
});

for (const [lang, helpText, rankPrefix, promotionPrefix] of [
  ["sv", "Siffrorna styr innehållet, inte stoppens ordning.", "Prioritet", "Höj prioritet för"],
  ["en", "The numbers guide the content, not the order of stops.", "Priority", "Increase priority for"],
]) {
  test(`${lang}: explains content dominance outside compact buttons with accessible localized ranks`, async (t) => {
    const h = await mountCard(t, {
      lang,
      preferencePriority: ["views", "culture", "food"],
      onPromoteMood: () => {},
    });
    const help = [...h.container.querySelectorAll("p")].find((paragraph) => paragraph.textContent === helpText);
    assert.ok(help, "a short sentence distinguishes dominance from route order");
    assert.ok(!help.closest("button"), "explanations stay outside buttons");
    assert.ok(help.id);
    const preferenceGroup = h.container.querySelector(`[role="group"][aria-describedby="${help.id}"]`);
    assert.ok(preferenceGroup, "the interest group is described by the explanation");
    ["views", "culture", "food"].forEach((key, index) => {
      const group = h.container.querySelector(`[data-preference-key="${key}"]`);
      const main = group.querySelector("button[aria-pressed]");
      const promote = group.querySelector("button[aria-label]");
      assert.equal(group.getAttribute("role"), "group");
      assert.equal(group.getAttribute("aria-label"), `${rankPrefix} ${index + 1}: ${optionName(key, lang)}`);
      assert.equal(accessibleName(main), optionName(key, lang));
      assert.equal(promote.getAttribute("aria-label"), `${promotionPrefix} ${optionName(key, lang)}`);
      assert.equal(promote.textContent, "", "the visible control stays icon-only");
      assert.ok(promote.querySelector('svg[aria-hidden="true"]'), "the icon is decorative, not an unlabeled glyph");
    });
  });
}

test("partial priority uses the shared normalization contract without mutating selection or hiding other choices", async (t) => {
  const selected = Object.freeze(["views", "food", "culture"]);
  const preferencePriority = Object.freeze(["nightlife", "culture", "culture", "unknown"]);
  const h = await mountCard(t, { selected, preferencePriority });
  const buttons = choices(h);
  assert.deepEqual(buttons.map(accessibleName), ["culture", "views", "food", "fika", "nightlife", "green", "second_hand"]
    .map((key) => optionName(key)));
  assert.deepEqual(buttons.slice(0, 3).map((button) => rankBadge(button)?.textContent), ["1", "2", "3"]);
  assert.ok(buttons.slice(3).every((button) => button.getAttribute("aria-pressed") === "false" && !rankBadge(button)));
  assert.deepEqual(selected, ["views", "food", "culture"]);
  assert.deepEqual(preferencePriority, ["nightlife", "culture", "culture", "unknown"]);
});
