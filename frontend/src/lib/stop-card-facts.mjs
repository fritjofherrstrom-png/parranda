import { PLANNER_PREFERENCE_KEYS } from "../../../shared/planner-intent.mjs";
import { selectedDayHoursLabel } from "./selected-day-hours.mjs";

/**
 * What a route stop's card may say about the place itself: what kind of place
 * it is, and whether its source knows its hours for the selected day. Both
 * come from the server's stop; nothing here reads a name or guesses a time.
 */

// Per-stop TYPE chips ("what is this place") — the engine's vocabulary, localized.
const TYPE_LABELS = {
  museum: { sv: "Museum", en: "Museum" },
  gallery: { sv: "Galleri", en: "Gallery" },
  park: { sv: "Park", en: "Park" },
  garden: { sv: "Trädgård", en: "Garden" },
  restaurant: { sv: "Restaurang", en: "Restaurant" },
  cafe: { sv: "Café", en: "Café" },
  bar: { sv: "Bar", en: "Bar" },
  viewpoint: { sv: "Utsikt", en: "Viewpoint" },
  market: { sv: "Marknad", en: "Market" },
  "street-food": { sv: "Street food", en: "Street food" },
  beach: { sv: "Strand", en: "Beach" },
  promenade: { sv: "Promenad", en: "Promenade" },
  castle: { sv: "Slott", en: "Castle" },
};

// `vintage-shop` is a route type for every kind of second-hand trade: an
// antiques hall, a charity shop, a vintage shop, a used-games shop. The chip
// names the narrower kind only when the source's own category says so (the
// server's `source.category`); otherwise it is the broad "Second hand". It is
// never "Vintage" unless the source says vintage.
const SECOND_HAND_LABELS = {
  antiques: { sv: "Antik", en: "Antiques" },
  charity: { sv: "Second hand · välgörenhet", en: "Charity shop" },
  vintage: { sv: "Vintage", en: "Vintage" },
  second_hand: { sv: "Second hand", en: "Second hand" },
};

// Kinds of place whose visit depends on opening hours.
const HOURS_RELEVANT_TYPES = new Set([
  "museum",
  "gallery",
  "restaurant",
  "cafe",
  "bar",
  "market",
  "vintage-shop",
  "street-food",
  "castle",
]);

export function stopTypeLabel(stop, lang = "en") {
  const type = String(stop?.type || "");
  if (!type) return "";
  if (type === "vintage-shop") {
    const labels = SECOND_HAND_LABELS[String(stop?.source?.category || "")] || SECOND_HAND_LABELS.second_hand;
    return labels[lang] ?? labels.en;
  }
  return TYPE_LABELS[type]?.[lang] ?? type;
}

// True when the kind of place depends on opening hours and its source gives
// none for the selected day. Unknown is said as unknown, never filled in.
export function stopHoursUnknown(stop) {
  return HOURS_RELEVANT_TYPES.has(String(stop?.type || "")) &&
    (stop?.selected_day_hours?.status === "unknown" || !selectedDayHoursLabel(stop?.selected_day_hours, "en"));
}

// Source attribution is not a venue website. Accept only the distinct website
// atom, including on saved days, and leave unusable destinations without a link.
export function stopWebsiteUrl(stop) {
  if (typeof stop?.website !== "string") return null;
  const href = stop.website.trim();
  if (href.length > 2048 || !/^https?:\/\//i.test(href) || /[\u0000-\u0020\u007f\\]/.test(href)) return null;
  try {
    const url = new URL(href);
    return ["https:", "http:"].includes(url.protocol) && url.hostname && !url.username && !url.password && url.href.length <= 2048
      ? href : null;
  } catch {
    return null;
  }
}

// A card may explain only the fit already declared by the server. A type or
// name cannot create a match, and partial evidence must not become a full fit.
const PREFERENCE_ALIASES = { scenic: "views", museums: "culture", coffee: "fika", bars: "nightlife", vintage: "second_hand" };
const preferenceKeys = new Set(PLANNER_PREFERENCE_KEYS);
const canonicalPreferences = (values) => Array.isArray(values)
  ? values.filter((value) => typeof value === "string")
    .map((value) => PREFERENCE_ALIASES[value] || value).filter((value) => preferenceKeys.has(value))
  : [];

export function stopMatchedPreferences(stop, selected) {
  const covered = new Set(canonicalPreferences(stop?.covered_preferences));
  const partial = new Set(canonicalPreferences(stop?.partial_preferences));
  return [...new Set(canonicalPreferences(selected))].filter((key) => covered.has(key) && !partial.has(key));
}

// Closed source-kind vocabulary: these are factual labels, never generated
// descriptions of a business, its stock, quality or a promised experience.
const PLACE_KINDS = {
  antiques: { type: 'vintage-shop', sv: 'Antik', en: 'Antiques' },
  second_hand_clothing: { type: 'vintage-shop', sv: 'Begagnade kläder', en: 'Second-hand clothing' },
  coffee_shop: { type: 'cafe', sv: 'Kaffebar', en: 'Coffee shop' },
  bakery: { type: 'cafe', sv: 'Bageri', en: 'Bakery' },
  tea_room: { type: 'cafe', sv: 'Tesalong', en: 'Tea room' },
  art_museum: { type: 'museum', sv: 'Konstmuseum', en: 'Art museum' },
  history_museum: { type: 'museum', sv: 'Historiskt museum', en: 'History museum' },
  botanical_garden: { type: 'garden', sv: 'Botanisk trädgård', en: 'Botanical garden' },
  nature_reserve: { type: 'park', sv: 'Naturreservat', en: 'Nature reserve' },
  farmers_market: { type: 'market', sv: 'Bondemarknad', en: "Farmers' market" },
  flea_market: { type: 'market', sv: 'Loppmarknad', en: 'Flea market' },
};
const placeAddress = (value) => typeof value === 'string' && value.trim().length <= 160 &&
  !/[\u0000-\u001f\u007f]/.test(value) && value.trim() ? value.trim() : null;

export function stopPlaceDetails(stop, lang = 'en') {
  const details = stop?.place_details;
  const kind = details && typeof details === 'object' && !Array.isArray(details) &&
    typeof details.kind === 'string' && Object.hasOwn(PLACE_KINDS, details.kind)
    ? PLACE_KINDS[details.kind] : null;
  const kindLabel = kind && kind.type === stop?.type ? kind[lang] || kind.en : null;
  return {
    kindLabel: kindLabel === stopTypeLabel(stop, lang) ? null : kindLabel,
    address: placeAddress(details?.address) || placeAddress(stop?.address),
  };
}
