const assert = require("node:assert/strict");
const test = require("node:test");

const {
  EVENT_INTENT_CUES,
  FRAMED_COMPOUND_HEADS,
  FRAMING_MODIFIERS,
  MIN_COMPOUND_MODIFIER_LENGTH,
  OPEN_COMPOUND_HEADS,
  scoreEventPreferenceFit,
} = require("../server/pulse-engine/event-preference-fit");

const normalize = (value) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

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

test("a subject modifier never gives a framed head a strong score or a match reason", () => {
  // The seven false hits found on 2e2675d, plus the two from the #508 review
  // and two more of the same kind.
  const cases = [
    ["Nationell hundutställning", "culture"], // a dog show
    ["Veteranbilsutställning på torget", "culture"], // a car show
    ["Koiranäyttely", "culture"], // Finnish dog show
    ["Rechnungsausstellung: Schulung", "culture"], // issuing invoices
    ["Fågelkonsert i gryningen", "culture"], // birdsong
    ["Hupkonzert gegen Fluglärm", "culture"], // a honking protest
    ["Barnträdgård Solstrålen: föräldramöte", "green"], // Finland-Swedish kindergarten
    ["Kriegstheater 1914–1918: ein historischer Vortrag", "culture"], // theatre of war
    ["Bakgrundsmusik vid budgetmöte", "culture"], // incidental sound
    ["Affentheater im Rathaus", "culture"], // a farce, a fuss
    ["Hissmusik och kaffe", "culture"],
  ];
  for (const [title, preference] of cases) {
    const fit = scoreEventPreferenceFit({ title }, [preference]);
    assert.equal(fit.level, "none", `${title} must not match ${preference}`);
    assert.equal(fit.score, 0, title);
    assert.deepEqual(fit.reasons, [], title);
  }
});

test("the three legitimate new compound matches stay", () => {
  const cases = [
    ["Bakluckeloppis", "markets", "strong", "preference_markets_compound_cue"],
    ["Matfestival", "culture", "strong", "preference_museums_compound_cue"],
    ["Fotopromenad", "green", "partial", "preference_green_compound_adjacent"],
  ];
  for (const [title, preference, level, reason] of cases) {
    const fit = scoreEventPreferenceFit({ title }, [preference]);
    assert.equal(fit.level, level, title);
    assert.deepEqual(fit.reasons, [reason], title);
  }
});

test("every framing modifier is verified by a real compound", () => {
  const verified = [
    ["kvälls", "Fixture: kvällskonsert"],
    ["lunch", "Lunchkonsert"],
    ["sommar", "Sommarutställning"],
    ["sommer", "Sommerkonzert im Park"],
    ["vår", "Vårkonsert med kören"],
    ["jul", "Julkonsert"],
    ["jule", "Julekoncert i kirken"],
    ["advents", "Adventskonsert"],
    ["weihnachts", "Weihnachtskonzert"],
    ["kesä", "Kesäkonsertti"],
    ["barn", "Barnkonsert"],
    ["familje", "Familjekonsert kl 11"],
    ["børne", "Børneteater"],
    ["kinder", "Kindertheater"],
    ["kyrk", "Kyrkkonsert"],
    ["kyrko", "Kyrkomusik"],
    ["kirchen", "Kirchenkonzert"],
    ["frilufts", "Friluftsteater"],
    ["freilicht", "Freilichtkonzert"],
    ["kammar", "Kammarkonsert"],
    ["kammer", "Kammermusik"],
    ["jazz", "Jazzkonsert på kajen"],
    ["orgel", "Orgelkonsert"],
    ["dock", "Dockteater"],
    ["konst", "Konstutställning"],
    ["kunst", "Kunstausstellung"],
    ["taide", "Taidenäyttely"],
    ["foto", "Fotoutställning"],
  ];
  for (const [, title] of verified) {
    assert.deepEqual(scoreEventPreferenceFit({ title }, ["culture"]).reasons, ["preference_museums_compound_cue"], title);
  }
  assert.deepEqual(
    verified.map(([modifier]) => normalize(modifier)).sort(),
    [...FRAMING_MODIFIERS].sort(),
    "the list holds exactly the verified modifiers",
  );
});

test("the short framing list deliberately misses these reasonable compounds", () => {
  // Measured against 2e2675d, where concert, exhibition and garden heads were
  // open: these legitimate titles matched there and do not match now. Adding a
  // verified modifier moves a title from here to the table above.
  const culture = [
    "Luciakonsert", "Nyårskonsert", "Midsommarkonsert", "Höstkonsert", "Välgörenhetskonsert",
    "Skolkonsert", "Pianokonsert", "Rockkonsert", "Popkonsert", "Gospelkonsert", "Operakonsert",
    "Körkonsert", "Utomhuskonsert", "Abendkonzert", "Benefizkonzert", "Neujahrskonzert",
    "Frühlingskonzert", "Klavierkonzert", "Chorkonzert", "Kirkekoncert", "Kveldskonsert",
    "Joulukonsertti", "Kirkkokonsertti", "Urkukonsertti", "Lastenkonsertti", "Iltakonsertti",
    "Separatutställning", "Samlingsutställning", "Jubileumsutställning", "Vandringsutställning",
    "Höstutställning", "Grafikutställning", "Keramikutställning", "Textilutställning",
    "Skulpturutställning", "Sonderausstellung", "Dauerausstellung", "Wanderausstellung",
    "Valokuvanäyttely",
  ];
  for (const title of culture) {
    assert.equal(scoreEventPreferenceFit({ title }, ["culture"]).level, "none", title);
  }
  for (const title of ["Skolträdgård", "Köksträdgård", "Kryddträdgård"]) {
    assert.equal(scoreEventPreferenceFit({ title }, ["green"]).level, "none", title);
  }
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

test("an open head needs a real modifier and every compound must end in its head", () => {
  const boundary = scoreEventPreferenceFit({ title: "Bokloppis" }, ["second_hand"]);
  assert.equal(boundary.level, "strong", "a three-letter modifier qualifies for an open head");

  for (const title of [
    "Ölfestival", // a two-letter modifier is too short to trust
    "Julkonserten", // inflected forms are not stemmed
    "Konserthuset öppnar", // the head must be the final element
  ]) {
    assert.equal(scoreEventPreferenceFit({ title }, ["culture"]).level, "none", title);
  }
});

test("compound heads are existing cues and framing modifiers are whole words", () => {
  const cueWords = new Set(
    Object.values(EVENT_INTENT_CUES)
      .flatMap((cues) => [...cues.strong, ...cues.partial])
      .map(normalize),
  );
  for (const head of [...OPEN_COMPOUND_HEADS, ...FRAMED_COMPOUND_HEADS]) {
    assert.match(head, /^[a-z]{5,}$/, `${head} is a normalized word of at least five letters`);
    assert.ok(cueWords.has(head), `${head} adds no meaning beyond an existing cue`);
    assert.equal(OPEN_COMPOUND_HEADS.has(head) && FRAMED_COMPOUND_HEADS.has(head), false, head);
  }
  for (const modifier of FRAMING_MODIFIERS) {
    assert.match(modifier, /^\p{L}{3,}$/u, `${modifier} is one normalized word of at least three letters`);
  }
  assert.ok(MIN_COMPOUND_MODIFIER_LENGTH >= 3);
  for (const rejected of [
    "vandring", "wanderung", "marknad", "markt", "konst", "utsikt", "forestallning", "tradgard",
    "kaffe", "fika", "fest", "opera", "concert", "dans", "bio", "bad", "strand",
  ]) {
    assert.equal(OPEN_COMPOUND_HEADS.has(rejected) || FRAMED_COMPOUND_HEADS.has(rejected), false,
      `${rejected} never acts as a head`);
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
