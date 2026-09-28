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
  return HOURS_RELEVANT_TYPES.has(String(stop?.type || "")) && !selectedDayHoursLabel(stop?.selected_day_hours, "en");
}
