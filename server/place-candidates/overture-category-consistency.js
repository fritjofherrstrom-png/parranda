"use strict";

// A negative consistency check, never a name-to-category mapper. Two fields
// must describe a named physical feature before an inferred food claim is
// withheld. Missing hours, a name alone or a news URL alone says no such thing.
const FOOD_TYPES = new Set(["restaurant", "cafe", "bar"]);
const FEATURES = new Set([
  "statue", "sculpture", "memorial", "monument", "staty", "skulptur",
  "denkmal", "estatua", "escultura", "monumento",
]);
const BUSINESS = /\b(?:restaurant|restaurang|restaurante|ristorante|cafe|caffe|cafeteria|coffee|bistro|brasserie|grill|kitchen|tavern|taverna|trattoria|osteria|pub|bar|pizzeria|diner|eatery)\b/;
const ARTICLES = /^(?:the|a|an|le|la|el|il|der|die|das|den|det)\s+/;
const fold = value => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "")
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function hasContradictoryFoodListing({ name, type, website } = {}) {
  if (!FOOD_TYPES.has(type) || typeof name !== "string" || name.length > 300) return false;
  const label = fold(name);
  if (BUSINESS.test(label)) return false;
  const words = label.replace(ARTICLES, "").split(" ");
  const feature = words.length >= 2 && FEATURES.has(words.at(-1)) ? words.at(-1)
    : words.length >= 3 && FEATURES.has(words[0]) && ["of", "to", "de", "van", "von", "av"].includes(words[1]) ? words[0] : null;
  if (!feature || typeof website !== "string" || website.length > 2048) return false;
  try {
    const url = new URL(website);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const pathname = decodeURIComponent(url.pathname);
    if (!/(?:^|\/)(?:news|articles?|stories|wiki)(?:\/|$)/i.test(pathname)) return false;
    return fold(pathname).split(" ").includes(feature);
  } catch (_) { return false; }
}

module.exports = { hasContradictoryFoodListing };
