// ONE NO-DAY STATE. Staging 2590f540 (12 Nov 2026): Copenhagen with
// waterside + bathing_places, Mexico City with cheap_eats and Stockholm with
// live_music each stacked four cards that contradicted each other — "couldn't
// confirm a walkable day with these interests" (Edit interests), "couldn't
// build a day here right now… sources failed" (Try again), "Places found — no
// route yet", and "No places for: waterside, bathing_places · 0 matches" with
// raw keys, although the loader had found 101 waterside records.
//
// The page now states one cause, in priority order — interests, then sources,
// then thin supply — names interests as their chips read, offers one next step,
// and never calls an interest absent that the engine found places for.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mountPlanner } from "./helpers/planner-harness.mjs";
import { PLANNER_INTEREST_GROUPS, PLANNER_PREFERENCE_KEYS, MAX_PLANNER_PREFERENCES } from "../../shared/planner-intent.mjs";
import { ANYWHERE_PREFERENCES } from "../src/lib/anywhere-payload.mjs";
import { evidencedMissingIntents, noDayState } from "../src/lib/no-day-state.mjs";

const staging = JSON.parse(readFileSync(new URL("./fixtures/no-day-staging-2590f540.json", import.meta.url)));
const terminal = JSON.parse(readFileSync(new URL("./fixtures/captured-terminal-place-snapshot.json", import.meta.url)));

const compose = (h) => h.fetchMock.calls.filter((call) => call.url.startsWith("/api/route-recommendations"));
const buttons = (h, name) => [...h.container.querySelectorAll("button")].filter((b) => b.textContent.trim() === name);
const resultRegion = (h) => h.container.querySelector('p[role="status"].sr-only');
/** What a sighted reader sees: the page's text without its screen-reader-only copy. */
function visibleText(h) {
  const copy = h.container.cloneNode(true);
  for (const node of copy.querySelectorAll(".sr-only")) node.remove();
  return copy.textContent || "";
}
const COPY = {
  en: {
    interests: "We couldn’t confirm a walkable day with these interests.",
    edit: "Edit interests", retry: "Try again",
    stacked: /couldn't build a day here right now|Places found — no route yet|Places nearby|No places for|0 matches for your picks|with your choices/,
    nearby: "Places nearby", noPlaces: "No places for:",
  },
  sv: {
    interests: "Vi kunde inte bekräfta en gångbar dag med de här intressena.",
    edit: "Ändra intressen", retry: "Försök igen",
    stacked: /kunde inte bygga en dag här just nu|Hittade platser — ingen rutt ännu|Platser i närheten|Inga platser för|0 matchningar för dina val|med dina val/,
    nearby: "Platser i närheten", noPlaces: "Inga platser för:",
  },
};

async function plan(t, { place = "Testville", prefs, lang = "en", response }) {
  const query = `place=${encodeURIComponent(place)}${prefs ? `&prefs=${prefs}` : ""}&lang=${lang}`;
  const h = await mountPlanner({ url: `http://localhost/anywhere?${query}`, props: { lang } });
  if (t) t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(compose(h)[0], structuredClone(response));
  await h.clock.advance(50);
  return h;
}

/** The single notice: one card under the controls, no other no-day surface. */
function assertOneNotice(h, lang, { message, action }) {
  const copy = COPY[lang];
  const card = h.container.querySelector('section[aria-label="Your day\'s starting point"], section[aria-label="Dagens utgångspunkt"]');
  assert.ok(card, "the anchor card holds the notice");
  assert.ok(card.textContent.includes(message), `notice in the anchor card: ${card.textContent}`);
  assert.equal(visibleText(h).split(message).length - 1, 1, "the message is shown once");
  assert.equal(resultRegion(h).textContent, message, "the page's result region announces exactly that message");
  const live = [...h.container.querySelectorAll('[role="status"], [aria-live], [role="alert"]')]
    .filter((node) => node.textContent.includes(message));
  assert.deepEqual(live, [resultRegion(h)], "one live region carries it");
  assert.equal(buttons(h, copy.edit).length, action === "edit" ? 1 : 0, "Edit interests only when it is the next step");
  assert.equal(buttons(h, copy.retry).length, action === "retry" ? 1 : 0, "Try again only for a source failure");
}

for (const lang of ["en", "sv"]) {
  for (const [name, place] of [["copenhagen", "Copenhagen"], ["mexico_city", "Mexico City"], ["stockholm", "Stockholm"]]) {
    test(`staging ${name}: unconfirmable interests are one card with Edit interests, not four (${lang})`, async (t) => {
      const capture = staging[name];
      assert.ok(capture.response.agnostic_route_output_experiment.source_status.error, "a source really failed on staging");
      const h = await plan(t, { place, prefs: capture.request.preferences.join(","), lang, response: capture.response });
      assertOneNotice(h, lang, { message: COPY[lang].interests, action: "edit" });
      assert.doesNotMatch(h.text(), COPY[lang].stacked, "no second cause, no structure card, no empty candidate card");
      for (const key of capture.request.preferences) assert.ok(!h.text().includes(key), `no raw key ${key}`);
    });
  }
}

test("Edit interests opens the interest chooser from the one notice", async (t) => {
  const h = await plan(t, { place: "Copenhagen", prefs: "waterside,bathing_places", response: staging.copenhagen.response });
  const [edit] = buttons(h, "Edit interests");
  await h.act(() => edit.click());
  assert.ok(h.container.querySelector('[aria-label="All interests"]'), "the grouped editor is open");
  assert.equal(edit.getAttribute("aria-expanded"), "true");
});

for (const lang of ["en", "sv"]) {
  test(`a failed place source, with picks the sources could test, is one card with Try again (${lang})`, async (t) => {
    const response = structuredClone(terminal);
    response.agnostic_route_output_experiment.source_status.collection.source_completion = { status: "complete", pending: 0, completed: 1, failed: 1 };
    const h = await plan(t, { prefs: "culture", lang, response });
    const message = lang === "en"
      ? "Parranda couldn't build a day here right now. One or more place sources failed."
      : "Parranda kunde inte bygga en dag här just nu. En eller flera platskällor misslyckades.";
    assertOneNotice(h, lang, { message, action: "retry" });
    assert.doesNotMatch(h.text(), lang === "en" ? /Places found — no route yet|0 matches|couldn’t confirm/ : /Hittade platser — ingen rutt ännu|0 matchningar|kunde inte bekräfta/);
    const [retry] = buttons(h, COPY[lang].retry);
    await h.act(() => retry.click());
    await h.clock.advance(50);
    assert.equal(compose(h).length, 2, "the retry asks again");
    assert.deepEqual(compose(h)[1].body.preferences, ["culture"]);
  });

  test(`a total source outage is never blamed on picks it could not test (${lang})`, async (t) => {
    const response = {
      days: [],
      agnostic_route_output_experiment: {
        intake: { status: "resolved", resolved: { label: "Testville" } },
        source_status: { status: "error_failed_closed" },
      },
    };
    const h = await plan(t, { prefs: "waterside,bathing_places", lang, response });
    const message = lang === "en"
      ? "The place sources didn't answer just now, so Parranda couldn't fetch places for Testville — nothing is invented in its place. Try again in a moment."
      : "Platskällorna svarade inte just nu, så Parranda kunde inte hämta platser för Testville — inget hittas på. Försök igen om en stund.";
    assertOneNotice(h, lang, { message, action: "retry" });
    assert.ok(!h.text().includes(COPY[lang].interests));
  });

  test(`thin supply is one card with Edit interests and no source claim (${lang})`, async (t) => {
    const response = {
      days: [],
      agnostic_route_output_experiment: {
        intake: { status: "resolved", resolved: { label: "Testville" } },
        candidate_readiness: { real_place_count: 2 },
        readiness_blockers: ["insufficient_geocoded_candidates"],
        source_status: { status: "loaded:2" },
      },
    };
    const h = await plan(t, { lang, response });
    const message = lang === "en"
      ? "Parranda found 2 real places near Testville, but not enough for a reliable day yet — nothing is invented in its place."
      : "Parranda hittade 2 riktiga platser nära Testville, men inte tillräckligt för en pålitlig dag ännu — inget hittas på.";
    assertOneNotice(h, lang, { message, action: "edit" });
    assert.doesNotMatch(h.text(), COPY[lang].stacked);
  });
}

// Places grouped, but no route: the notice states it once; the list adds only
// places, and its "No places for" line names only what the loader did not find.
function structureOnly({ prefs, covers, missing, profile, error = null }) {
  return {
    days: [],
    place_structure: {
      provenance: "agnostic_anchor",
      area_count: 1,
      areas: [{ size: 2, center: { lat: 55.68, lng: 12.57 }, dominant_types: ["park"], member_ids: ["a", "b"] }],
      district_day: {
        areas: [{
          center: { lat: 55.68, lng: 12.57 }, daypart_hint: "midday", covers, partial_covers: [],
          stops: [
            { id: "quay", name: "Fixture Quay", type: "promenade", lat: 55.68, lng: 12.57 },
            { id: "harbour", name: "Fixture Harbour", type: "promenade", lat: 55.681, lng: 12.571 },
          ],
        }],
        legs: [], covered_intents: covers, partial_intents: [], missing_intents: missing,
      },
    },
    agnostic_route_output_experiment: {
      intake: { status: "resolved", resolved: { label: "Testville" } },
      source_status: {
        status: "loaded:40", ...(error ? { error } : {}),
        collection: { requested_intents: prefs, selected_profile: profile },
      },
    },
  };
}

test("an interest the loader found places for is never listed as having none", async (t) => {
  const response = structureOnly({
    prefs: ["bathing_places", "waterside"], covers: ["waterside"], missing: ["waterside", "bathing_places"],
    profile: { record_count: 101, requested_intents_covered: ["waterside"], requested_intents_partial: [], requested_intents_missing: ["bathing_places"] },
    error: "http_non_200",
  });
  const h = await plan(t, { prefs: "waterside,bathing_places", response });
  assertOneNotice(h, "en", { message: COPY.en.interests, action: "edit" });
  const nearby = [...h.container.querySelectorAll("section")].find((s) => s.textContent.startsWith("Places nearby"));
  assert.ok(nearby, "the matching places stay listed");
  assert.match(nearby.textContent, /Fixture Quay/);
  const missingLine = [...nearby.querySelectorAll("p")].find((p) => p.textContent.startsWith("No places for:"));
  assert.equal(missingLine?.textContent, "No places for: Swimming spots", "only the pick the loader did not find");
  assert.doesNotMatch(nearby.textContent, /couldn't build a route yet/, "the notice already says it");
  assert.doesNotMatch(h.text(), /Places found — no route yet|waterside|bathing_places/);
});

test("places without a route, with nothing else wrong, are one supply notice above the places", async (t) => {
  const response = structureOnly({
    prefs: ["food"], covers: ["food"], missing: [],
    profile: { record_count: 40, requested_intents_covered: ["food"], requested_intents_partial: [], requested_intents_missing: [] },
  });
  const h = await plan(t, { prefs: "food", response });
  assertOneNotice(h, "en", { message: "Parranda found places, but couldn't build a route yet.", action: "edit" });
  assert.doesNotMatch(h.text(), /Places found — no route yet|0 matches|No places for/);
  assert.match(h.text(), /Fixture Quay/);
});

test("the cause is chosen in priority order and only a source failure retries", () => {
  const base = { settled: true, interestsUnconfirmed: false, sourcesUnanswered: false, sourceFailed: false, canRebuild: true, hasPicks: true };
  assert.equal(noDayState({ ...base, settled: false, interestsUnconfirmed: true }), null);
  assert.deepEqual(noDayState({ ...base, interestsUnconfirmed: true, sourceFailed: true }), { cause: "interests", action: "edit_interests" });
  assert.deepEqual(noDayState({ ...base, interestsUnconfirmed: true, sourcesUnanswered: true }), { cause: "sources", action: "retry" });
  assert.deepEqual(noDayState({ ...base, sourceFailed: true }), { cause: "sources", action: "retry" });
  assert.deepEqual(noDayState(base), { cause: "supply", action: "edit_interests" });
  assert.deepEqual(noDayState({ ...base, hasPicks: false }), { cause: "supply", action: null });
  assert.deepEqual(noDayState({ ...base, sourceFailed: true, canRebuild: false }), { cause: "sources", action: "restart" });
});

test("missing intents drop anything the loader covered, in either vocabulary", () => {
  const status = { collection: { selected_profile: { requested_intents_covered: ["waterside", "museums"], requested_intents_partial: ["scenic"] } } };
  assert.deepEqual(evidencedMissingIntents(["waterside", "bathing_places", "culture", "views"], status), ["bathing_places"]);
  assert.deepEqual(evidencedMissingIntents(["live_music"], { collection: { selected_profile: { requested_intents_covered: [] } } }), ["live_music"]);
  assert.deepEqual(evidencedMissingIntents(null, status), []);
  assert.deepEqual(evidencedMissingIntents(["cheap_eats"], undefined), ["cheap_eats"]);
});

// CONTRACT: no interest key the server can echo back — every pick, plus the
// loader's own vocabulary and a key this build has never seen — renders raw on
// the no-day surface, in either language. Chip labels are removed first, so a
// key inside a real label ("brunch" in "Breakfast & brunch", "museums" in
// "Art museums") is not mistaken for a raw one.
const LOADER_KEYS = ["scenic", "museums", "coffee", "bars", "vintage", "markets"];
const UNKNOWN_KEY = "sauna_spots";
const PICK_OPTIONS = [...ANYWHERE_PREFERENCES, ...PLANNER_INTEREST_GROUPS.flatMap(({ options }) => options)];
const withoutLabels = (text, lang) => PICK_OPTIONS.map((o) => o[lang]).sort((a, b) => b.length - a.length)
  .reduce((rest, name) => rest.split(name).join("·"), text);
const chunks = [];
for (let i = 0; i < PLANNER_PREFERENCE_KEYS.length; i += MAX_PLANNER_PREFERENCES) chunks.push(PLANNER_PREFERENCE_KEYS.slice(i, i + MAX_PLANNER_PREFERENCES));

for (const lang of ["en", "sv"]) {
  test(`contract: no raw interest key renders in the no-day state (${lang})`, async () => {
    for (const picks of chunks) {
      const serverKeys = [...picks, ...LOADER_KEYS, UNKNOWN_KEY];
      const response = structureOnly({
        prefs: picks, covers: serverKeys, missing: serverKeys,
        profile: { record_count: 3, requested_intents_covered: [], requested_intents_partial: [], requested_intents_missing: picks },
        error: "provider_unavailable",
      });
      response.place_structure.district_day.areas[0].partial_covers = serverKeys;
      const h = await plan(null, { prefs: picks.join(","), lang, response });
      const text = h.text();
      assert.ok(text.includes(COPY[lang].nearby), "the candidate list rendered the server's keys");
      assert.ok(text.includes(COPY[lang].noPlaces), "the missing line rendered");
      const rest = withoutLabels(text, lang);
      for (const key of serverKeys) assert.ok(!rest.includes(key), `raw key "${key}" rendered in ${lang}: ${rest}`);
      await h.unmount();
    }
  });
}
