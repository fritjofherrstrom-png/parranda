/**
 * "Parranda chooses" — the reader asks Parranda to choose the day's interests.
 *
 * Pure helpers for the planner: the experiment flag (off by default), and the
 * server's published choice (`agnostic_route_output_experiment.parranda_chooses`)
 * turned into one short label per pick. Reasons are read from the server's
 * codes and counts; nothing here decides or adds a reason of its own.
 */
import { ANYWHERE_PREFERENCES } from "./anywhere-payload.mjs";

export const PARRANDA_CHOOSES = "parranda_chooses";

const FLAG_PARAM = "parranda_chooses";
export const PARRANDA_CHOOSES_FLAG_KEY = "parranda.experiment.parranda_chooses";

/**
 * `?parranda_chooses=1` turns the experiment on for this browser and `=0`
 * turns it off; otherwise the remembered choice applies. Storage failures
 * (private mode, blocked site data) read as off.
 */
export function readParrandaChoosesFlag({ search = "", storage = null } = {}) {
  let value = null;
  try {
    value = new URLSearchParams(search).get(FLAG_PARAM);
  } catch {
    value = null;
  }
  if (value === "1" || value === "0") {
    try {
      if (value === "1") storage?.setItem(PARRANDA_CHOOSES_FLAG_KEY, "1");
      else storage?.removeItem(PARRANDA_CHOOSES_FLAG_KEY);
    } catch {
      // Remembering is a convenience; the URL still decides this visit.
    }
    return value === "1";
  }
  try {
    return storage?.getItem(PARRANDA_CHOOSES_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

const BAND_COPY = {
  morning: ["Passar morgonen", "Suits the morning"],
  midday: ["Passar mitt på dagen", "Suits midday"],
  afternoon: ["Passar eftermiddagen", "Suits the afternoon"],
  evening: ["Passar kvällen", "Suits the evening"],
  late: ["Passar sena timmar", "Suits the late hours"],
};

// Most telling first: what only today has, then the hour, then the supply.
const REASON_ORDER = [
  "matches_live_event_today",
  "rain_favors_indoor",
  "fits_morning",
  "fits_midday",
  "fits_afternoon",
  "fits_evening",
  "fits_late",
  "pleasant_weather_favors_outdoor",
  "strong_local_supply",
  "enough_local_supply",
];

function placesCopy(evidence, lang) {
  const count = Number(evidence?.usable_count);
  if (!Number.isFinite(count) || count < 1) return null;
  // The server counts up to its survey depth; at the cap there may be more.
  const capped = Number.isFinite(Number(evidence?.counted_up_to)) && count >= Number(evidence.counted_up_to);
  const n = `${count}${capped ? "+" : ""}`;
  return lang === "en" ? `${n} places nearby` : `${n} platser i närheten`;
}

function reasonCopy(code, evidence, lang) {
  const en = lang === "en";
  if (code === "matches_live_event_today") return en ? "Fits tonight's event" : "Passar kvällens evenemang";
  if (code === "rain_favors_indoor") return en ? "Indoors while it rains" : "Inomhus när det regnar";
  if (code === "pleasant_weather_favors_outdoor") return en ? "Good weather outside" : "Fint väder ute";
  if (code.startsWith("fits_")) {
    const copy = BAND_COPY[code.slice(5)];
    return copy ? copy[en ? 1 : 0] : null;
  }
  if (code === "strong_local_supply" || code === "enough_local_supply") return placesCopy(evidence, lang);
  return null;
}

function noteCopy(status, pickCount, lang) {
  const en = lang === "en";
  if (status === "focus_fell_back_to_varied_day") {
    return en
      ? "No walkable day with Parranda's picks was found, so this is the mixed day."
      : "Ingen gångbar dag med Parrandas val hittades, så det här är den blandade dagen.";
  }
  if (pickCount === 0) {
    return en
      ? "Too few places here to choose a direction. The day mixes what there is."
      : "För få platser här för att välja en inriktning. Dagen blandar det som finns.";
  }
  if (status === "thin_supply") {
    return en
      ? "Few places here, so Parranda chose fewer directions."
      : "Få platser här, så Parranda valde färre inriktningar.";
  }
  return null;
}

/**
 * @returns {null | {
 *   status: string,
 *   picks: Array<{ key: string, label: string, reason: string | null }>,
 *   note: string | null,
 * }}
 */
export function parrandaChoiceView(block, lang = "en") {
  if (!block || typeof block !== "object" || block.mode !== PARRANDA_CHOOSES) return null;
  const status = typeof block.status === "string" ? block.status : null;
  if (!status || status === "ignored_explicit_preferences") return null;
  const known = new Map(ANYWHERE_PREFERENCES.map((pref) => [pref.key, pref]));
  const picks = (Array.isArray(block.auto_intents) ? block.auto_intents : [])
    .filter((entry) => entry && known.has(entry.intent))
    .map((entry) => {
      const pref = known.get(entry.intent);
      const codes = new Set(Array.isArray(entry.reasons) ? entry.reasons : []);
      const code = REASON_ORDER.find((candidate) => codes.has(candidate));
      return {
        key: entry.intent,
        label: lang === "en" ? pref.en : pref.sv,
        reason: code ? reasonCopy(code, entry.evidence, lang) : null,
      };
    });
  return { status, picks, note: noteCopy(status, picks.length, lang) };
}
