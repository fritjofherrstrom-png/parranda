/**
 * Candidate Intelligence Spine — intent vocabulary (v1).
 *
 * Maps the messy, bilingual real-world tokens (user preferences AND candidate
 * tags/types) into ONE clean canonical intent space the fit scorer can reason
 * over. This is deliberately a translation layer, not a rename of the legacy
 * catalog vocabulary — the catalog keeps its `utsikt`/`mat`/`second_hand` tags;
 * this module is how the new engine talks about them.
 *
 * Canonical vocabulary decisions (per the PR brief):
 *   - `viewpoint` is the place CATEGORY (it is already a catalog type).
 *   - `viewpoint_anchor` is the route ROLE a scenic place can play.
 *   - `scenic` is the broader EXPERIENCE intent.
 *   - `sunset` / `golden_hour` / `waterfront` are MODIFIERS (context tilts),
 *     never standalone intents.
 *   - `second_hand` stays its OWN intent and must not collapse into generic
 *     "shopping".
 *
 * Pure / side-effect free.
 */

const { normalizePlaceDetails } = require("../place-candidates/place-details");

// Planner's grouped interests use exact source classifications. The existing
// quick choices below still allow the same broader and adjacent matches.
const STABLE_PLACE_INTERESTS = {
  restaurants: { role: "food_anchor", types: ["restaurant", "pizza", "trattoria", "taverna", "tavern", "osteria", "bistro"], excludedKinds: ["food_establishment"] },
  brunch: { role: "food_anchor", kinds: ["brunch"] },
  cafes: { role: "coffee_fika_stop", kinds: ["cafe", "coffee_shop"], curatedTypes: ["cafe", "coffee", "coffee_shop", "coffeehouse"] },
  bakeries: { role: "coffee_fika_stop", types: ["bakery"], kinds: ["bakery"] },
  cheap_eats: { role: "food_anchor", types: ["restaurant", "pizza", "street_food", "trattoria", "taverna", "tavern", "osteria", "bistro", "fast_food"], excludedKinds: ["food_establishment"], price: "$" },
  art_museums: { role: "culture_stop", kinds: ["art_museum"] },
  history_museums: { role: "culture_stop", kinds: ["history_museum"] },
  art_galleries: { role: "culture_stop", kinds: ["art_gallery"], curatedTypes: ["gallery"] },
  historic_sites: { role: "culture_stop", types: ["historic_site", "castle", "monument"] },
  viewpoint_places: { role: "scenic_anchor", types: ["viewpoint", "lookout", "overlook"] },
  parks_gardens: { role: "green_walk_stop", types: ["park", "garden"], excludedKinds: ["nature_reserve"] },
  waterside: { role: "green_walk_stop", types: ["beach", "bathing_spot", "swimming_area", "marina", "pier"], taggedTypes: { promenade: ["waterfront"] } },
  bathing_places: { role: "swimming_coast_option", types: ["bathing_spot", "swimming_area"], kinds: ["bathing_place"] },
  marketplaces: { role: "market_stop", kinds: ["marketplace", "farmers_market", "flea_market"], curatedTypes: ["market"] },
  flea_markets: { role: "market_stop", kinds: ["flea_market"] },
  antique_shops: { role: "vintage_second_hand_option", types: ["antiques_shop"], kinds: ["antiques"] },
  wine_bars: { role: "evening_bar_option", types: ["wine_bar"], kinds: ["wine_bar"] },
  cocktail_bars: { role: "evening_bar_option", types: ["cocktail_bar"], kinds: ["cocktail_bar"] },
  beer_places: { role: "evening_bar_option", types: ["brewery", "beer_bar", "beer_garden", "biergarten", "taproom"], kinds: ["beer_place"] },
};

const STABLE_PLACE_INTEREST_ROLES = Object.freeze(Object.fromEntries(
  Object.entries(STABLE_PLACE_INTERESTS).map(([key, { role }]) => [key, role]),
));

// Canonical user intents. Each carries the catalog types/tags that strongly or
// weakly satisfy it. "strong" → the candidate clearly serves the intent; "weak"
// → adjacent/supporting only.
const CANONICAL_INTENTS = {
  second_hand: {
    label: "second hand / vintage",
    category_types: ["vintage-shop"],
    strong_types: ["vintage-shop", "thrift-shop", "charity-shop", "antiques-shop"],
    strong_tags: ["second_hand", "vintage", "antique", "antiques", "thrift", "loppis", "flea"],
    // NOTE: generic "shopping" / "shop" is intentionally absent — second hand
    // must not be diluted into generic retail.
    weak_types: [],
    weak_tags: [],
    aliases: ["second_hand", "secondhand", "second hand", "vintage", "antique", "antiques", "thrift", "loppis", "flea", "charity", "preloved"],
  },
  scenic: {
    label: "viewpoint / scenic",
    category_types: ["viewpoint"],
    route_role: "viewpoint_anchor",
    strong_types: ["viewpoint", "lookout", "overlook"],
    strong_tags: ["utsikt", "panorama", "vista"],
    weak_types: ["rooftop-bar", "promenade", "park", "garden", "bridge", "castle", "historic-site", "monument", "lighthouse"],
    weak_tags: ["coast", "dolce-vita"],
    // A bathing facility's geography does not state a scenic experience.
    // Explicit panorama/view evidence above still covers scenic at that site.
    weak_tag_excluded_types: ["beach", "bathing-spot", "swimming-area"],
    aliases: ["scenic", "viewpoint", "viewpoints", "view", "views", "utsikt", "panorama", "vista", "lookout", "overlook"],
  },
  green: {
    label: "green / walks",
    category_types: ["park", "garden", "promenade"],
    strong_types: ["park", "garden", "promenade", "nature-reserve"],
    strong_tags: ["green", "park", "garden", "promenade", "nature", "walking"],
    weak_types: ["viewpoint", "beach", "bridge"],
    weak_tags: ["waterfront", "coast"],
    aliases: [
      "green",
      "green_walk",
      "green walks",
      "green and walks",
      "parks",
      "park",
      "garden",
      "gardens",
      "promenade",
      "walk",
      "walks",
      "gront",
      "grönt",
      "promenad",
      "promenader",
    ],
  },
  food: {
    label: "food",
    category_types: ["restaurant"],
    // taverna/tavern/osteria/bistro are taverna-style eateries (Greek/Italian)
    // → food, not generic. (English "pub" stays under bars.)
    strong_types: ["restaurant", "pizza", "street-food", "trattoria", "taverna", "tavern", "osteria", "bistro", "fast-food"],
    strong_tags: ["mat", "pizza", "tapas", "meze"],
    weak_types: ["bakery", "cafe", "café"],
    weak_tags: ["aperitivo"],
    aliases: ["food", "eat", "mat", "restaurant", "dinner", "lunch", "pizza", "tapas", "trattoria", "taverna", "tavern", "osteria", "bistro", "eatery", "meze"],
  },
  coffee: {
    label: "coffee / fika / café",
    category_types: ["cafe"],
    // café / coffee / fika is its OWN intent now — no longer only a weak food
    // match. A café strongly covers `coffee`/`fika`.
    strong_types: ["cafe", "café", "coffee", "coffee-shop", "coffeehouse"],
    strong_tags: ["fika", "kaffe", "coffee", "espresso"],
    weak_types: ["bakery"],
    weak_tags: [],
    aliases: ["coffee", "fika", "cafe", "café", "kaffe", "espresso", "cappuccino", "latte", "kafferep"],
  },
  bars: {
    label: "bars / drinks",
    category_types: ["bar"],
    strong_types: ["bar", "wine-bar", "cocktail-bar", "rooftop-bar", "pub", "biergarten", "taproom"],
    strong_tags: ["öl", "vin", "cocktail", "aperitivo", "vermut", "nattliv", "party"],
    weak_types: [],
    weak_tags: ["tapas", "kväll"],
    aliases: ["bar", "bars", "drinks", "drink", "cocktail", "cocktails", "wine", "beer", "öl", "vin", "nightlife", "nattliv", "kväll", "party", "aperitivo", "vermut", "pub", "biergarten", "taproom", "evening"],
  },
  markets: {
    label: "markets",
    category_types: ["market"],
    strong_types: ["market", "event_market"],
    strong_tags: ["market", "event_market"],
    weak_types: [],
    weak_tags: [],
    aliases: ["market", "markets", "marknad", "mercato", "mercat", "loppis"],
  },
  museums: {
    label: "museums / culture",
    category_types: ["museum"],
    strong_types: ["museum"],
    strong_tags: ["museum", "kultur", "arkitektur", "klassiker", "design"],
    weak_types: ["church", "gallery", "library"],
    weak_tags: ["kyrkor"],
    aliases: ["museum", "museums", "culture", "kultur", "art", "gallery", "arkitektur", "design", "history"],
  },
  swimming: {
    label: "swimming",
    category_types: ["beach"],
    strong_types: ["beach", "bathing-spot", "swimming-area"],
    strong_tags: ["coast", "bad", "strand", "lido", "beach", "bathing", "badplats", "kallbad"],
    weak_types: ["promenade"],
    weak_tags: [],
    aliases: ["swim", "swimming", "beach", "bad", "strand", "lido", "badplats", "sea", "bathing", "kallbad", "havsbad"],
  },
  low_energy: {
    label: "low-energy",
    category_types: [],
    strong_tags: ["low-key"],
    strong_types: [],
    weak_types: ["park", "garden", "library", "cafe", "café", "promenade"],
    weak_tags: ["lokalt", "local"],
    aliases: ["low_energy", "low-energy", "low energy", "low-key", "lowkey", "relax", "chill", "calm", "lugnt", "easy"],
  },
  ...Object.fromEntries(Object.entries(STABLE_PLACE_INTERESTS).map(([key, definition]) => [
    key, { label: key.replaceAll("_", " "), aliases: [], exact_place: definition },
  ])),
  live_music: { label: "live music", aliases: [] },
};

// Context modifiers — they TILT scoring, they are never intents themselves.
// All token arrays are slugged at match time, so "golden hour" / "golden-hour"
// / "golden_hour" all match the same bucket. Do not add format-specific
// duplicates here.
const MODIFIERS = {
  sunset: { tokens: ["golden_hour", "sunset"], tilt_intents: ["scenic"] },
  golden_hour: { tokens: ["golden_hour", "sunset"], tilt_intents: ["scenic"] },
  waterfront: { tokens: ["coast", "promenade", "beach", "waterfront", "seaside"], tilt_intents: ["scenic", "swimming"] },
};

const MODIFIER_ALIASES = {
  sunset: "sunset",
  "golden-hour": "golden_hour",
  golden_hour: "golden_hour",
  goldenhour: "golden_hour",
  waterfront: "waterfront",
  coast: "waterfront",
  seaside: "waterfront",
  sea: "waterfront",
};

const STRONG_MATCH = 2.0;
const WEAK_MATCH = 0.6;

// Build a fast alias → canonical-intent index once.
const INTENT_BY_ALIAS = (() => {
  const index = Object.create(null);
  for (const [intent, def] of Object.entries(CANONICAL_INTENTS)) {
    for (const alias of def.aliases) {
      index[slug(alias)] = intent;
    }
    index[slug(intent)] = intent;
  }
  return index;
})();

/**
 * Normalize a user's requested preferences/intent_keys into the canonical
 * intent + modifier space.
 *
 * @returns {{
 *   intents: string[],        // canonical intents requested
 *   modifiers: string[],      // canonical modifiers requested
 *   unmapped: string[],       // tokens we could not map (kept honest)
 *   raw: string[],
 * }}
 */
function normalizeUserIntents(tokens = []) {
  const raw = [];
  const intents = new Set();
  const modifiers = new Set();
  const unmapped = [];

  for (const token of tokens) {
    const s = slug(token);
    if (!s) continue;
    raw.push(s);
    if (INTENT_BY_ALIAS[s]) {
      intents.add(INTENT_BY_ALIAS[s]);
      continue;
    }
    if (MODIFIER_ALIASES[s]) {
      modifiers.add(MODIFIER_ALIASES[s]);
      continue;
    }
    unmapped.push(s);
  }

  // A requested sunset/golden_hour/waterfront also implies scenic interest.
  for (const modifier of modifiers) {
    for (const tilt of MODIFIERS[modifier]?.tilt_intents || []) {
      // only imply scenic, not swimming, to avoid over-broadening
      if (tilt === "scenic") intents.add(tilt);
    }
  }

  return {
    intents: [...intents],
    modifiers: [...modifiers],
    unmapped: [...new Set(unmapped)],
    raw,
  };
}

/**
 * How strongly does a candidate satisfy a canonical intent?
 * @returns {{ strength: number, level: "strong"|"weak"|"none", reason: string|null }}
 */
function matchCandidateToIntent(candidate, intent) {
  const def = CANONICAL_INTENTS[intent];
  if (!def) return { strength: 0, level: "none", reason: null };

  const type = slug(candidate?.type);
  if (def.exact_place) return matchExactPlace(candidate, type, def.exact_place);
  const tagSlugs = slugSet(candidate?.tags);

  const strongTypeHit = (def.strong_types || []).map(slug).includes(type);
  const strongTagSlugs = (def.strong_tags || []).map(slug);
  const strongTagHit = strongTagSlugs.find((s) => tagSlugs.has(s));
  if (strongTypeHit || strongTagHit) {
    return {
      strength: STRONG_MATCH,
      level: "strong",
      reason: strongTypeHit ? `type:${type}` : `tag:${strongTagHit}`,
    };
  }

  const weakTypeHit = (def.weak_types || []).map(slug).includes(type);
  const weakTagHit = !(def.weak_tag_excluded_types || []).map(slug).includes(type) &&
    (def.weak_tags || []).map(slug).some((s) => tagSlugs.has(s));
  if (weakTypeHit || weakTagHit) {
    return {
      strength: WEAK_MATCH,
      level: "weak",
      reason: weakTypeHit ? `adjacent_type:${type}` : "adjacent_tag",
    };
  }

  return { strength: 0, level: "none", reason: null };
}

function matchExactPlace(candidate, type, definition) {
  const kind = normalizePlaceDetails(candidate?.place_details, candidate?.type)?.kind;
  if (!definition.excludedKinds?.includes(kind) &&
      (!definition.price || candidate?.source_price_level === definition.price)) {
    const kindHit = definition.kinds?.includes(kind);
    const requiredTags = Object.hasOwn(definition.taggedTypes || {}, type) ? definition.taggedTypes[type] : [];
    const typeHit = definition.types?.includes(type) ||
      (!kind && candidate?.city_pack_owned === true && definition.curatedTypes?.includes(type)) ||
      requiredTags.some(tag => slugSet(candidate?.tags).has(tag));
    if (kindHit || typeHit) {
      const reason = definition.price ? "source_price_level:lowest" : kindHit ? "source_kind:" + kind : "type:" + type;
      return { strength: STRONG_MATCH, level: "strong", reason };
    }
  }
  return { strength: 0, level: "none", reason: null };
}

// Give each represented interest one seat before a bounded depth cut. The
// caller supplies its ranked, eligible tier so this cannot admit new supply.
function exactInterestRepresentatives(entries, intents, covers) {
  const covered = new Set();
  const representatives = [];
  for (const intent of intents) {
    if (covered.has(intent)) continue;
    const match = entries.find(entry => covers(entry, intent));
    if (!match) continue;
    representatives.push(match);
    for (const key of intents) if (covers(match, key)) covered.add(key);
  }
  return representatives;
}

/**
 * Which canonical modifiers does this candidate express (golden hour, coast…)?
 * All comparisons go through slug(), so "golden hour", "golden-hour", and
 * "golden_hour" collapse to the same bucket regardless of which the source
 * happened to write.
 */
function candidateModifiers(candidate) {
  const haystack = new Set([
    slug(candidate?.type),
    ...slugSet(candidate?.tags),
    ...slugSet(candidate?.time_fit),
  ]);

  const present = new Set();
  for (const [modifier, def] of Object.entries(MODIFIERS)) {
    if ((def.tokens || []).map(slug).some((t) => haystack.has(t))) {
      present.add(modifier);
    }
  }
  return [...present];
}

function slugSet(values) {
  return new Set((values || []).map(slug).filter(Boolean));
}

/**
 * Does this candidate qualify as a scenic viewpoint_anchor route role?
 * Derived (legacy candidates never carry the role explicitly).
 */
function isViewpointAnchor(candidate) {
  const m = matchCandidateToIntent(candidate, "scenic");
  return m.level === "strong";
}

function slug(value) {
  return String(value === undefined || value === null ? "" : value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents (ö→o, é→e, å→a)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");
}

module.exports = {
  CANONICAL_INTENTS,
  STABLE_PLACE_INTEREST_ROLES,
  MODIFIERS,
  STRONG_MATCH,
  WEAK_MATCH,
  normalizeUserIntents,
  matchCandidateToIntent,
  exactInterestRepresentatives,
  candidateModifiers,
  isViewpointAnchor,
};
