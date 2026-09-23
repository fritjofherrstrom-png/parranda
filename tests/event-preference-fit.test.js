const assert = require("node:assert/strict");
const test = require("node:test");

const {
  COMPOUND_CUE_HEADS,
  EVENT_INTENT_CUES,
  MIN_COMPOUND_MODIFIER_LENGTH,
  scoreEventPreferenceFit,
} = require("../server/pulse-engine/event-preference-fit");

test("structured provider semantics match canonical planner preferences", () => {
  const fit = scoreEventPreferenceFit(
    {
      title: "Saturday programme",
      tags: ["second_hand", "market"],
      intents: ["nightlife"],
      route_role_hint: "market_stop",
    },
    ["second_hand", "nightlife", "food"],
  );

  assert.equal(fit.level, "strong");
  assert.deepEqual(fit.matched_preferences.sort(), ["bars", "second_hand"]);
  assert.deepEqual(fit.partial_preferences, ["food"], "a generic market is only adjacent to food");
  assert.deepEqual(fit.missing_preferences, []);
  assert.ok(fit.reasons.includes("preference_second_hand_structured"));
  assert.ok(fit.reasons.includes("preference_bars_structured"));
});

test("local-language factual titles provide a bounded reusable fallback", () => {
  const flea = scoreEventPreferenceFit(
    { title: "Bakluckeloppis och antikmarknad", tags: [] },
    ["second_hand", "food"],
  );
  assert.deepEqual(flea.matched_preferences, ["second_hand"]);
  assert.equal(flea.score, 3);

  const culture = scoreEventPreferenceFit(
    { title: "Konsert och klubbkväll", tags: [] },
    ["culture", "nightlife"],
  );
  assert.deepEqual(culture.matched_preferences.sort(), ["bars", "museums"]);
  assert.equal(culture.score, 6);
});

test("every public planner interest has a reusable event-semantic path", () => {
  const cases = [
    ["food", "Street food tasting", "food"],
    ["fika", "Kaffeprovning i rosteriet", "coffee"],
    ["green", "Guidad naturvandring", "green"],
    ["views", "Sunset photo walk", "scenic"],
    ["culture", "Vernissage och utstallning", "museums"],
    ["nightlife", "DJ set and club night", "bars"],
    ["second_hand", "Loppmarknad och vintage", "second_hand"],
  ];

  for (const [preference, title, canonical] of cases) {
    const fit = scoreEventPreferenceFit({ title }, [preference]);
    assert.equal(fit.level, "strong", `${preference} should strongly match ${title}`);
    assert.deepEqual(fit.matched_preferences, [canonical]);
  }
});

test("a generic market is only adjacent to second hand, not a fabricated full match", () => {
  const fit = scoreEventPreferenceFit(
    { title: "Sunday market", tags: ["market"] },
    ["second_hand"],
  );
  assert.equal(fit.level, "partial");
  assert.deepEqual(fit.matched_preferences, []);
  assert.deepEqual(fit.partial_preferences, ["second_hand"]);
  assert.equal(fit.score, 1);
});

test("source and publisher labels never mint preference relevance", () => {
  const fit = scoreEventPreferenceFit(
    {
      title: "Open house",
      source_label: "Vintage Flea Market Network",
      provenance: { attribution: "Nightlife and culture publisher" },
    },
    ["second_hand", "nightlife", "culture"],
  );
  assert.equal(fit.level, "none");
  assert.equal(fit.score, 0);
  assert.deepEqual(fit.matched_preferences, []);
});

test("a closed compound matches through its curated head", () => {
  // The reviewed Live fixture: a music-tagged "kvällskonsert" was ranked as if
  // it had nothing to do with culture.
  const fixture = scoreEventPreferenceFit(
    { title: "Fixture: kvällskonsert", tags: ["music", "Music"] },
    ["food", "culture", "views"],
  );
  assert.equal(fixture.level, "strong");
  assert.deepEqual(fixture.matched_preferences, ["museums"]);
  assert.deepEqual(fixture.missing_preferences, ["food", "scenic"]);
  assert.deepEqual(fixture.reasons, ["preference_museums_compound_cue"]);
  assert.equal(fixture.score, 3);

  for (const title of ["Jazzkonsert på kajen", "Sommarutställning"]) {
    const fit = scoreEventPreferenceFit({ title }, ["culture"]);
    assert.deepEqual(fit.matched_preferences, ["museums"], title);
  }

  // A cultural concert compound alone does not establish a nightlife event.
  const evening = scoreEventPreferenceFit({ title: "Kvällskonsert" }, ["culture", "nightlife"]);
  assert.deepEqual(evening.matched_preferences, ["museums"]);
  assert.deepEqual(evening.missing_preferences, ["bars"]);
});

test("closed compounds and reviewed exact forms cover the cue languages safely", () => {
  const cases = [
    ["Barnloppis i parken", "second_hand", "second_hand"],
    ["Kinderflohmarkt", "second_hand", "second_hand"],
    ["Julekoncert i kirken", "culture", "museums"],
    ["Weihnachtskonzert", "culture", "museums"],
    ["Kesäkonsertti", "culture", "museums"],
    ["Taidenäyttely", "culture", "museums"],
    ["Kunstausstellung", "culture", "museums"],
    ["Jazzfestival", "culture", "museums"],
    ["Sommarteater", "culture", "museums"],
    ["Freilichttheater", "culture", "museums"],
    ["Kammarmusik", "culture", "museums"],
    ["Kvällsöppet på Sjöfartsmuseum", "culture", "museums"],
    ["Visning av skolträdgård", "green", "green"],
  ];
  for (const [title, preference, canonical] of cases) {
    const fit = scoreEventPreferenceFit({ title }, [preference]);
    assert.equal(fit.level, "strong", `${title} should strongly match ${preference}`);
    assert.deepEqual(fit.matched_preferences, [canonical], title);
    const exact = ["Sommarteater", "Freilichttheater", "Kammarmusik"]
      .some((cue) => title.toLowerCase().includes(cue.toLowerCase()));
    assert.deepEqual(fit.reasons, [`preference_${canonical}_${exact ? "cue" : "compound_cue"}`], title);
  }

  // A partial cue stays partial when it ends a compound.
  const walk = scoreEventPreferenceFit({ title: "Kvällspromenad" }, ["green"]);
  assert.equal(walk.level, "partial");
  assert.deepEqual(walk.partial_preferences, ["green"]);
  assert.deepEqual(walk.reasons, ["preference_green_compound_adjacent"]);
});

test("an incidental or metaphorical suffix does not become a cultural event", () => {
  for (const title of [
    "Bakgrundsmusik vid budgetmöte",
    "Kriegstheater 1914–1918: ein historischer Vortrag",
  ]) {
    const fit = scoreEventPreferenceFit({ title }, ["culture"]);
    assert.equal(fit.level, "none", title);
    assert.equal(fit.score, 0, title);
  }
  for (const title of ["Sommarteater", "Freilichttheater", "Kammarmusik"]) {
    assert.equal(scoreEventPreferenceFit({ title }, ["culture"]).level, "strong", title);
  }
});

test("a daytime family concert is culture, not a new nightlife match", () => {
  const fit = scoreEventPreferenceFit({ title: "Familjekonsert kl 11" }, ["culture", "nightlife"]);
  assert.deepEqual(fit.matched_preferences, ["museums"]);
  assert.deepEqual(fit.missing_preferences, ["bars"]);
  assert.deepEqual(fit.reasons, ["preference_museums_compound_cue"]);
  const liveMusic = scoreEventPreferenceFit({ title: "Livemusik kl 21" }, ["nightlife"]);
  assert.deepEqual(liveMusic.matched_preferences, ["bars"], "explicit live music still counts");
});

test("whole-word evidence keeps its reason and structured compounds match too", () => {
  const whole = scoreEventPreferenceFit({ title: "Konsert på kajen" }, ["culture"]);
  assert.deepEqual(whole.reasons, ["preference_museums_cue"]);

  const both = scoreEventPreferenceFit({ title: "Jazzkonsert och konsert" }, ["culture"]);
  assert.deepEqual(both.reasons, ["preference_museums_cue"], "a whole-word match is the stronger evidence");

  const tagged = scoreEventPreferenceFit({ title: "Saturday programme", tags: ["Barnteater"] }, ["culture"]);
  assert.deepEqual(tagged.matched_preferences, ["museums"]);
  assert.deepEqual(tagged.reasons, ["preference_museums_cue"]);
});

test("false friends of rejected heads never mint relevance", () => {
  // Each title ends a word in a cue that is deliberately NOT a compound head,
  // because the word means something else.
  const cases = [
    ["Flyktinginvandring – seminarium", ["green"]],
    ["Einwanderung und Arbeit", ["green"]],
    ["Arbetsmarknad och integration", ["food", "second_hand", "markets"]],
    ["Supermarkt-Eröffnung", ["food", "second_hand", "markets"]],
    ["Fransk kokkonst", ["culture"]],
    ["Framtidsutsikt för stadskärnan", ["views"]],
    ["Vanföreställning eller verklighet", ["culture"]],
    ["Manifest för staden", ["nightlife"]],
    ["Anskaffe nytt utstyr", ["fika"]],
    ["Specifika behov", ["fika"]],
    ["Incontro sulla manodopera", ["culture"]],
    ["Disconcert", ["culture", "nightlife"]],
  ];
  for (const [title, preferences] of cases) {
    const fit = scoreEventPreferenceFit({ title }, preferences);
    assert.equal(fit.level, "none", `${title} must not match ${preferences.join("/")}`);
    assert.equal(fit.score, 0, title);
    assert.deepEqual(fit.reasons, [], title);
  }
});

test("a compound needs a real modifier and must end in its head", () => {
  const boundary = scoreEventPreferenceFit({ title: "Julkonsert" }, ["culture"]);
  assert.equal(boundary.level, "strong", "a three-letter modifier qualifies");

  for (const title of [
    "Ölfestival", // a two-letter modifier is too short to trust
    "Julkonserten", // inflected forms are not stemmed
    "Konserthuset öppnar", // the head must be the final element
  ]) {
    assert.equal(scoreEventPreferenceFit({ title }, ["culture"]).level, "none", title);
  }
});

test("compound heads are existing single-word cues, at least five letters long", () => {
  const cueWords = new Set(
    Object.values(EVENT_INTENT_CUES)
      .flatMap((cues) => [...cues.strong, ...cues.partial])
      .map((cue) => cue.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()),
  );
  for (const head of COMPOUND_CUE_HEADS) {
    assert.match(head, /^[a-z]{5,}$/, `${head} is a normalized word of at least five letters`);
    assert.ok(cueWords.has(head), `${head} adds no meaning beyond an existing cue`);
  }
  assert.ok(MIN_COMPOUND_MODIFIER_LENGTH >= 3);
  for (const rejected of [
    "vandring", "wanderung", "marknad", "markt", "konst", "utsikt", "forestallning",
    "kaffe", "fika", "fest", "opera", "concert", "dans", "bio", "bad", "strand",
  ]) {
    assert.equal(COMPOUND_CUE_HEADS.has(rejected), false, `${rejected} stays whole-word only`);
  }
});

test("no requested preferences is byte-neutral ranking context", () => {
  const fit = scoreEventPreferenceFit(
    { title: "Loppis and concert", tags: ["second_hand", "music"] },
    [],
  );
  assert.deepEqual(fit, {
    score: 0,
    level: "none",
    requested_preferences: [],
    matched_preferences: [],
    partial_preferences: [],
    missing_preferences: [],
    reasons: [],
  });
});
