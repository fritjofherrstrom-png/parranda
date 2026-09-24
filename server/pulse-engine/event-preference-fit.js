"use strict";

const { normalizeUserIntents } = require("../candidates/intent-vocabulary");

const STRONG_MATCH_SCORE = 3;
const PARTIAL_MATCH_SCORE = 1;
const MAX_PREFERENCE_SCORE = 6;

// Generic event-category cues. Structured provider tags/intents are preferred;
// the short factual title is only a bounded multilingual fallback for sources
// that publish no categories. Source labels, publisher names and descriptions
// are deliberately excluded so a feed cannot match itself into relevance.
const EVENT_INTENT_CUES = Object.freeze({
  second_hand: {
    strong: [
      "second hand", "secondhand", "vintage", "thrift", "flea market", "car boot sale",
      "preloved", "reuse market", "loppis", "loppmarknad", "bakluckeloppis", "aterbruk",
      "brocante", "vide grenier", "mercatino dell usato", "flohmarkt", "blesi trh",
    ],
    partial: ["antiques fair", "antique market", "antikmarknad", "collectors market", "market", "marknad"],
  },
  museums: {
    strong: [
      "concert", "gig", "recital", "opera", "ballet", "dance", "performance", "theatre",
      "theater", "exhibition", "gallery", "museum", "vernissage", "screening", "cinema",
      "festival", "workshop", "reading", "book launch", "jazz", "comedy", "art", "culture",
      "konsert", "utstallning", "forestallning", "teater", "musik", "konst", "dans", "bio",
      "sommarteater", "barnteater", "freilichttheater", "kammarmusik",
      "konsertti", "nayttely", "taide", "concerto", "mostra", "concierto", "exposicion",
      "spectacle", "ausstellung", "konzert", "koncert", "vystava", "divadlo",
      "συναυλια", "εκθεση", "φεστιβαλ", "παρασταση", "θεατρο", "μουσικη", "τεχνη",
    ],
    partial: ["heritage", "architecture", "talk", "lecture", "historia", "arkitektur", "foredrag"],
  },
  bars: {
    strong: [
      "nightlife", "night club", "nightclub", "club night", "dj set", "party", "afterwork",
      "live music", "gig", "concert", "jazz night", "bar night", "kvallsliv", "klubbkvall",
      "nattklubb", "fest", "konsert", "livemusik", "yokerho", "discoteca",
    ],
    partial: ["evening program", "kvallsprogram", "music", "musik", "cocktail", "wine tasting"],
  },
  food: {
    strong: [
      "food market", "street food", "food festival", "tasting", "wine tasting", "beer tasting",
      "culinary", "gastronomy", "matmarknad", "matfestival", "provsmakning", "vinprovning",
      "olprovning", "skordemarknad", "ruokafestivaali", "degustazione", "gastronomia",
    ],
    partial: ["farmers market", "farmers fair", "market", "marknad", "mercato", "marche"],
  },
  coffee: {
    strong: ["coffee", "coffee tasting", "coffee festival", "fika", "kaffe", "kaffeprovning", "cafe"],
    partial: ["bakery", "bageri", "pastry"],
  },
  green: {
    strong: [
      "guided walk", "nature walk", "hike", "hiking", "outdoor", "garden tour", "park walk",
      "bike ride", "vandring", "naturvandring", "guidad promenad", "friluft", "tradgard",
      "cykeltur", "luontoretki", "randonnee", "wanderung",
    ],
    partial: ["walk", "promenade", "nature", "park", "garden", "promenad", "natur"],
  },
  scenic: {
    strong: [
      "sunset", "sunrise", "viewpoint", "panorama", "photo walk", "architecture walk",
      "solnedgang", "soluppgang", "utsikt", "fotopromenad", "panoramica",
    ],
    partial: ["waterfront", "harbour walk", "coast walk", "river walk", "arkitektur", "architecture"],
  },
  markets: {
    strong: [
      "market", "farmers market", "flea market", "night market", "street market", "fair",
      "marknad", "loppis", "loppmarknad", "torghandel", "mercato", "marche", "markt",
      "trh", "αγορα", "παζαρι",
    ],
    partial: ["bazaar", "food hall", "saluhall"],
  },
  swimming: {
    strong: ["swim", "swimming", "open water", "bathing", "beach", "bad", "simning", "strand", "kallbad"],
    partial: ["coast", "seaside", "waterfront"],
  },
});

// Closed-compound heads. Swedish, Norwegian, Danish, German, Dutch and Finnish
// write compounds as one word with the defining element last: a
// "kvällskonsert" is a konsert and a "sommarutställning" an utställning.
// Whole-word matching misses that ordinary way of titling a happening, so a
// head listed here may also match as the final element of a longer word. Each
// head is already a cue above (compounds add no new meaning) and has at least
// five letters. Inflected forms ("konserten") are not matched; this is not a
// stemmer.
//
// Open heads name one kind of happening whatever precedes them: any
// "…museum" is a museum and any "…loppis" a flea market.
const OPEN_COMPOUND_HEADS = normalizedSet(["museum", "festival", "loppis", "flohmarkt", "promenad"]);
// Framed heads keep an everyday sense that a subject modifier can switch to: a
// "Kriegstheater" is a theatre of war, "bakgrundsmusik" incidental sound, a
// "hundutställning" a dog show, a "fågelkonsert" birdsong and
// "Rechnungsausstellung" the issuing of an invoice. They match only when the
// whole modifier is one of the short, explicit framing words below, each
// verified by a real compound in tests/event-preference-fit.test.js. A word
// missing from the list costs a match and never mints one.
const FRAMED_COMPOUND_HEADS = normalizedSet([
  "konsert", "koncert", "konzert", "konsertti",
  "utställning", "ausstellung", "näyttely",
  "teater", "theater", "musik",
]);
const FRAMING_MODIFIERS = normalizedSet([
  // when
  "kvälls", "lunch", "sommar", "sommer", "vår", "jul", "jule", "advents", "weihnachts", "kesä",
  // for whom
  "barn", "familje", "børne", "kinder",
  // where it is staged
  "kyrk", "kyrko", "kirchen", "frilufts", "freilicht", "kammar", "kammer",
  // art form or medium
  "jazz", "orgel", "dock", "konst", "kunst", "taide", "foto",
]);
// Other cue words never act as heads, because their compounds routinely mean
// something else: vandring/wanderung (flykting|invandring, Ein|wanderung:
// migration), marknad/markt (arbets|marknad, Super|markt), konst (kok|konst),
// utsikt (framtids|utsikt), föreställning (van|föreställning), trädgård
// (Finland-Swedish barn|trädgård: kindergarten), kaffe (Norwegian an|skaffe),
// fest (mani|fest), opera (Italian manodopera) and English concert
// (dis|concert).
// An open head still needs a real modifier, not a short prefix such as "in"/"ut"
// or a stray letter.
const MIN_COMPOUND_MODIFIER_LENGTH = 3;

// Cues normalized once, each list with the compound heads it may use.
const MATCHABLE_CUES = Object.freeze(Object.fromEntries(
  Object.entries(EVENT_INTENT_CUES).map(([intent, cues]) => [intent, {
    strong: matchableCues(cues.strong, intent),
    partial: matchableCues(cues.partial, intent),
  }]),
));

const ROLE_INTENTS = Object.freeze({
  market_stop: ["markets"],
  culture_stop: ["museums"],
  food_stop: ["food"],
  coffee_stop: ["coffee"],
  scenic_anchor: ["scenic"],
  viewpoint_anchor: ["scenic"],
  green_stop: ["green"],
  swimming_stop: ["swimming"],
  evening_anchor: ["bars"],
});

function scoreEventPreferenceFit(event, preferences = []) {
  const requested = normalizeUserIntents(Array.isArray(preferences) ? preferences : []).intents;
  if (requested.length === 0) {
    return emptyFit();
  }

  const requestedSet = new Set(requested);
  const structuredAtoms = eventSemanticAtoms(event);
  const structuredText = normalizeSearchText(structuredAtoms.join(" "));
  const titleText = normalizeSearchText([event?.title, event?.name].filter(Boolean).join(" "));
  const directIntents = new Set(normalizeUserIntents(structuredAtoms).intents);

  const role = normalizeRole(event?.route_role_hint);
  for (const intent of ROLE_INTENTS[role] || []) directIntents.add(intent);

  const matched = [];
  const partial = [];
  const reasons = [];
  for (const intent of requested) {
    if (directIntents.has(intent)) {
      matched.push(intent);
      reasons.push(`preference_${intent}_structured`);
      continue;
    }

    const cues = MATCHABLE_CUES[intent];
    if (!cues) continue;
    const strong = cueMatch([structuredText, titleText], cues.strong);
    if (strong) {
      matched.push(intent);
      reasons.push(strong === "compound" ? `preference_${intent}_compound_cue` : `preference_${intent}_cue`);
      continue;
    }
    const adjacent = cueMatch([structuredText, titleText], cues.partial);
    if (adjacent) {
      partial.push(intent);
      reasons.push(adjacent === "compound" ? `preference_${intent}_compound_adjacent` : `preference_${intent}_adjacent`);
    }
  }

  const score = Math.min(
    matched.length * STRONG_MATCH_SCORE + partial.length * PARTIAL_MATCH_SCORE,
    MAX_PREFERENCE_SCORE,
  );
  const covered = new Set([...matched, ...partial]);
  return {
    score,
    level: matched.length > 0 ? "strong" : partial.length > 0 ? "partial" : "none",
    requested_preferences: requested,
    matched_preferences: matched,
    partial_preferences: partial,
    missing_preferences: [...requestedSet].filter((intent) => !covered.has(intent)),
    reasons,
  };
}

function eventSemanticAtoms(event) {
  return [
    ...(Array.isArray(event?.tags) ? event.tags : []),
    ...(Array.isArray(event?.intents) ? event.intents : []),
    event?.route_role_hint,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function normalizedSet(values) {
  return new Set(values.map(normalizeSearchText));
}

function matchableCues(cues = [], intent = "") {
  const words = cues.map(normalizeSearchText).filter(Boolean);
  // A bare concert is already a nightlife cue. Extending that cue to every
  // compound would call a daytime family concert nightlife without evidence.
  // Keep nightlife whole-word/explicit until a narrower compound rule exists.
  if (intent === "bars") return { words, openHeads: [], framedHeads: [] };
  return {
    words,
    openHeads: words.filter((cue) => OPEN_COMPOUND_HEADS.has(cue)),
    framedHeads: words.filter((cue) => FRAMED_COMPOUND_HEADS.has(cue)),
  };
}

// "word" when a cue matches whole words, "compound" when only a curated head
// ends a longer word, otherwise null. Whole-word evidence wins.
function cueMatch(haystacks, cues) {
  if (haystacks.some((haystack) => hasCue(haystack, cues.words))) return "word";
  if (haystacks.some((haystack) => hasCompoundCue(haystack, cues))) return "compound";
  return null;
}

function hasCue(haystack, words) {
  if (!haystack) return false;
  const padded = ` ${haystack} `;
  return words.some((cue) => padded.includes(` ${cue} `));
}

function hasCompoundCue(haystack, { openHeads, framedHeads }) {
  if (!haystack || openHeads.length + framedHeads.length === 0) return false;
  return haystack.split(" ").some((word) =>
    openHeads.some((head) => endsOpenCompound(word, head)) ||
    framedHeads.some((head) => endsFramedCompound(word, head)));
}

function endsOpenCompound(word, head) {
  return word.length - head.length >= MIN_COMPOUND_MODIFIER_LENGTH && word.endsWith(head);
}

function endsFramedCompound(word, head) {
  return word.length > head.length && word.endsWith(head) &&
    FRAMING_MODIFIERS.has(word.slice(0, word.length - head.length));
}

function normalizeRole(value) {
  return normalizeSearchText(value).replace(/\s+/g, "_");
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function emptyFit() {
  return {
    score: 0,
    level: "none",
    requested_preferences: [],
    matched_preferences: [],
    partial_preferences: [],
    missing_preferences: [],
    reasons: [],
  };
}

module.exports = {
  EVENT_INTENT_CUES,
  FRAMED_COMPOUND_HEADS,
  FRAMING_MODIFIERS,
  MAX_PREFERENCE_SCORE,
  MIN_COMPOUND_MODIFIER_LENGTH,
  OPEN_COMPOUND_HEADS,
  scoreEventPreferenceFit,
};
