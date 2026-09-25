/**
 * The planner's vocabulary: engine tokens mapped to words a reader recognises,
 * and the few sentences that are pure functions of server evidence.
 *
 * Nothing here reads a title, guesses a reason, or derives a fact the server did
 * not state. A token without a mapping falls back to itself in `label`, and a
 * reason this build does not know falls back to the plain sentence.
 */
import { ANYWHERE_PREFERENCES } from "../../lib/anywhere-payload.mjs";
import type { LiveEventRelevance } from "../../lib/pulse-view.mjs";

export type Lang = "sv" | "en";
export type Translate = (sv: string, en: string) => string;
type LabelMap = Record<string, { sv: string; en: string }>;

export const DAYPART_LABELS: LabelMap = {
  morning: { sv: "Morgon", en: "Morning" },
  midday: { sv: "Mitt på dagen", en: "Midday" },
  afternoon: { sv: "Eftermiddag", en: "Afternoon" },
  evening: { sv: "Kväll", en: "Evening" },
};

export const INTENT_LABELS: LabelMap = {
  food: { sv: "Mat", en: "Food" },
  culture: { sv: "Kultur", en: "Culture" },
  views: { sv: "Utsikt", en: "Views" },
  fika: { sv: "Fika", en: "Coffee" },
  nightlife: { sv: "Kvällsliv", en: "Nightlife" },
  green: { sv: "Grönt", en: "Green" },
  second_hand: { sv: "Second hand", en: "Second hand" },
  market: { sv: "Marknad", en: "Market" },
  // The candidate spine's preference axes (#369 covered_preferences) use the
  // loader's category vocabulary — aliases so raw engine tokens never render.
  scenic: { sv: "Utsikt", en: "Views" },
  museums: { sv: "Kultur", en: "Culture" },
  coffee: { sv: "Fika", en: "Coffee" },
  bars: { sv: "Bar", en: "Bars" },
  swimming: { sv: "Bad", en: "Swimming" },
  vintage: { sv: "Second hand", en: "Vintage" },
};

// Per-stop TYPE chips ("what is this place") — the engine's vocabulary, localized.
export const TYPE_LABELS: LabelMap = {
  museum: { sv: "Museum", en: "Museum" },
  gallery: { sv: "Galleri", en: "Gallery" },
  park: { sv: "Park", en: "Park" },
  garden: { sv: "Trädgård", en: "Garden" },
  restaurant: { sv: "Restaurang", en: "Restaurant" },
  cafe: { sv: "Café", en: "Café" },
  bar: { sv: "Bar", en: "Bar" },
  viewpoint: { sv: "Utsikt", en: "Viewpoint" },
  market: { sv: "Marknad", en: "Market" },
  "vintage-shop": { sv: "Second hand", en: "Vintage" },
  "street-food": { sv: "Street food", en: "Street food" },
  beach: { sv: "Strand", en: "Beach" },
  promenade: { sv: "Promenad", en: "Promenade" },
  castle: { sv: "Slott", en: "Castle" },
};

export function label(map: LabelMap, key: string | null | undefined, lang: Lang): string {
  if (!key) return "";
  return map[key]?.[lang] ?? key;
}

export const PLANNER_INTENT_ALIASES: Record<string, string> = {
  scenic: "views",
  museums: "culture",
  coffee: "fika",
  bars: "nightlife",
  vintage: "second_hand",
};

/** The pick exactly as its chip reads ("Food & drink"), or the intent label. */
export function pickLabel(key: string, lang: Lang): string {
  const chip = ANYWHERE_PREFERENCES.find((pref: { key: string }) => pref.key === key);
  return chip ? (lang === "en" ? chip.en : chip.sv) : label(INTENT_LABELS, key, lang);
}

export const HOURS_RELEVANT_TYPES = new Set([
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

export function partialPreferenceLabels(stop: any, selected: string[], lang: Lang): string[] {
  const requested = new Set(selected.map((value) => PLANNER_INTENT_ALIASES[value] || value));
  const labels: string[] =
    (Array.isArray(stop?.partial_preferences) ? stop.partial_preferences : [])
      .map((value: string) => PLANNER_INTENT_ALIASES[value] || value)
      .filter((value: string) => requested.has(value))
      .map((value: string) => label(INTENT_LABELS, value, lang));
  return [...new Set<string>(labels)];
}

/**
 * WHY a Live row is shown, in the user's language. The kind and the picks come
 * from the server's fit (`liveEventRelevance`); nothing here reads the title or
 * guesses. A row without an established reason gets no line at all. Picks are
 * named exactly as their chips read.
 */
export function liveRelevanceSentence(
  relevance: LiveEventRelevance | null,
  lang: Lang,
  t: Translate,
): string | null {
  if (!relevance) return null;
  const picks = relevance.preferences.map((key) => pickLabel(key, lang)).join(", ");
  switch (relevance.kind) {
    case "match":
      return t(`Matchar: ${picks}`, `Matches: ${picks}`);
    case "looser_match":
      return t(`Lösare träff för: ${picks}`, `A looser match for: ${picks}`);
    case "local_discovery":
      return t("Lokal upptäckt utanför dina val", "A local discovery beyond your picks");
    default:
      return null;
  }
}

/** "3.2 km away" for a nearby-fallback Live row; nothing for a local one. */
export function nearbyDistanceLabel(
  event: { live_proximity?: string; anchor_distance_km?: number },
  lang: Lang,
): string | null {
  if (event.live_proximity !== "nearby" || !Number.isFinite(event.anchor_distance_km)) return null;
  const distance = Number(event.anchor_distance_km).toLocaleString(lang === "sv" ? "sv-SE" : "en-US", {
    maximumFractionDigits: 1,
  });
  return lang === "sv" ? `${distance} km bort` : `${distance} km away`;
}

/**
 * WHY a kept place did not make it, in the user's language.
 *
 * The reason is READ from the server, never derived here. A client can see that
 * a stop is absent; it cannot see whether the reservoir ever held the place, or
 * whether the walking budget shed it — and guessing between those would be a
 * fabrication dressed as an explanation.
 *
 * Anything unrecognised — a reason from a newer server, or none at all — falls
 * back to the plain sentence this surface has always shown. A day is allowed to
 * say only that it could not fit something; it is never allowed to invent why.
 */
export function unkeptReasonSentence(entry: { label: string; reason: string | null }, t: Translate): string {
  const name = entry.label || t("En plats du valde", "A place you kept");
  switch (entry.reason) {
    case "walking_budget":
      return t(
        `${name} ligger för långt bort för den promenad du bad om.`,
        `${name} is too far for the walk you asked for.`,
      );
    case "unknown_candidate":
      // Deliberately says what the server actually knows — that nothing
      // routable matched the id — rather than guessing WHY nothing did. Seen
      // on staging: a place still listed as a nearby idea, whose id is another
      // provider's name for a stop already in the day. "No longer in the
      // evidence" contradicted the list the user was looking at.
      return t(
        `${name} är inget Parranda kan lägga in i rutten här.`,
        `${name} isn't something Parranda can route to here.`,
      );
    case "not_offered_to_route":
      return t(
        `${name} finns här, men passade ingen roll i den här dagen.`,
        `${name} is here, but did not fit any role in this day.`,
      );
    case "not_selected":
      return t(
        `${name} kunde ha varit med, men dagen byggdes utan den.`,
        `${name} could have been included, but the day was built without it.`,
      );
    case "day_not_published":
      return t(
        `${name} kom inte med — Parranda kunde inte stå för den dag som höll den.`,
        `${name} did not make it — Parranda could not stand behind the day that held it.`,
      );
    default:
      // No reason given, or one this build does not know.
      return t(
        `${name} kunde inte få plats i dagen.`,
        `${name} could not fit in this day.`,
      );
  }
}
